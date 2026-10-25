-- Phase 3: each submitted version owns its immutable timestamp and deadline snapshot.
-- Submission's timestamp columns represent the *current* submission and may only be
-- reset on SUBMITTED -> DRAFT after the previous READY version has persisted its snapshot.
ALTER TABLE public."SubmissionVersion"
 ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
 ADD COLUMN IF NOT EXISTS deadline_at_submission timestamptz;

-- Backfill any previously accepted submission before enabling the new guards.
UPDATE public."SubmissionVersion" v
SET submitted_at=s.submitted_at,deadline_at_submission=s.deadline_at_submission
FROM public."Submission" s
WHERE s.current_version_id=v.id AND s.status='SUBMITTED'
  AND s.submitted_at IS NOT NULL AND v.submitted_at IS NULL;

CREATE OR REPLACE FUNCTION bn_private.guard_version_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $guard$
BEGIN
 IF (OLD.upload_state='READY' AND
      (NEW.upload_state IS DISTINCT FROM OLD.upload_state
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.deadline_at_submission IS DISTINCT FROM OLD.deadline_at_submission))
    OR (OLD.submitted_at IS NOT NULL
        AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
    OR (OLD.deadline_at_submission IS NOT NULL
        AND NEW.deadline_at_submission IS DISTINCT FROM OLD.deadline_at_submission)
 THEN RAISE EXCEPTION 'Submitted version history is immutable';
 END IF;
 IF NEW.upload_state='READY' AND NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION 'A READY version requires its submission timestamp';
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION bn_private.guard_version_submission_snapshot() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bn_version_submission_snapshot_guard ON public."SubmissionVersion";
CREATE TRIGGER bn_version_submission_snapshot_guard
 BEFORE UPDATE ON public."SubmissionVersion" FOR EACH ROW
 EXECUTE FUNCTION bn_private.guard_version_submission_snapshot();

CREATE OR REPLACE FUNCTION bn_private.guard_submission_timestamp()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $guard$
BEGIN
 IF OLD.submitted_at IS DISTINCT FROM NEW.submitted_at
    OR OLD.deadline_at_submission IS DISTINCT FROM NEW.deadline_at_submission THEN
   -- The only previously recorded timestamp that may be cleared is the
   -- current snapshot when a new DRAFT starts. Require an immutable READY
   -- historical version matching *both* old values before allowing this.
   IF NOT (
      OLD.status='SUBMITTED' AND NEW.status='DRAFT'
      AND NEW.submitted_at IS NULL AND NEW.deadline_at_submission IS NULL
      AND NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id
      AND EXISTS (
        SELECT 1 FROM public."SubmissionVersion" v
        WHERE v.id=OLD.current_version_id AND v.submission_id=OLD.id
          AND v.upload_state='READY'
          AND v.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
          AND v.deadline_at_submission IS NOT DISTINCT FROM OLD.deadline_at_submission
      )
   ) AND NOT (
      OLD.status='DRAFT' AND NEW.status='SUBMITTED'
      AND OLD.submitted_at IS NULL AND OLD.deadline_at_submission IS NULL
      AND NEW.submitted_at IS NOT NULL
   ) THEN
      RAISE EXCEPTION 'Submission timestamp change must preserve version history';
   END IF;
 END IF;
 RETURN NEW;
END $guard$;

-- Preserve the private guards and authenticated-only public invoker wrappers.
CREATE OR REPLACE FUNCTION bn_private.bn_p3_submit_impl(p_submission uuid, p_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); sub public."Submission"%ROWTYPE; ver public."SubmissionVersion"%ROWTYPE;
 cid uuid; a public."Assignment"%ROWTYPE; n int;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO sub FROM public."Submission" WHERE id=p_submission AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR sub.status<>'DRAFT' THEN RAISE EXCEPTION 'Draft submission not found'; END IF;
 SELECT ass.* INTO a FROM public."Assignment" ass WHERE ass.id=sub.assignment_id AND ass.status='OPEN' AND ass.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'This assignment is closed for submissions'; END IF;
 SELECT s.class_id INTO cid FROM public."Subject" s WHERE s.id=a.subject_id AND s.deleted_at IS NULL;
 IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM public."ClassMembership"
  WHERE class_id=cid AND user_id=actor AND status='ACTIVE' AND role='Student')
  OR NOT (sub.student_id=actor OR EXISTS(SELECT 1 FROM public."GroupMembership"
      WHERE group_id=sub.group_id AND user_id=actor AND removed_at IS NULL))
 THEN RAISE EXCEPTION 'Submission is not yours' USING ERRCODE='42501'; END IF;
 SELECT * INTO ver FROM public."SubmissionVersion"
 WHERE id=p_version AND submission_id=sub.id AND upload_state='UPLOADING' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Upload version not found'; END IF;
 SELECT count(*) INTO n FROM public."File" WHERE version_id=ver.id AND deleted_at IS NULL;
 IF n<1 OR EXISTS(SELECT 1 FROM public."File" WHERE version_id=ver.id
   AND deleted_at IS NULL AND upload_state<>'READY') THEN
  RAISE EXCEPTION 'All uploaded files must finish before submission';
 END IF;
 UPDATE public."SubmissionVersion" SET upload_state='READY',
  submitted_at=now(),deadline_at_submission=a.deadline WHERE id=ver.id;
 UPDATE public."Submission" SET status='SUBMITTED',current_version_id=ver.id,
  submitted_at=now(),deadline_at_submission=a.deadline,updated_at=now()
 WHERE id=sub.id;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,'Student',cid,'SUBMISSION_SUBMITTED','Submission',sub.id,
   jsonb_build_object('version',ver.version_number,'files',n,'late',a.deadline IS NOT NULL AND now()>a.deadline));
 RETURN jsonb_build_object('id',sub.id,'status','SUBMITTED','version_id',ver.id,
   'version',ver.version_number,'submitted_at',now(),'late',a.deadline IS NOT NULL AND now()>a.deadline);
END $function$;

CREATE OR REPLACE FUNCTION bn_private.bn_p3_details_impl(p_assignment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); cid uuid; staff boolean; stud boolean; result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT s.class_id INTO cid
 FROM public."Assignment" a JOIN public."Subject" s ON s.id=a.subject_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND s.deleted_at IS NULL;
 IF cid IS NULL THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE user_id=actor AND class_id=cid
    AND role IN('Admin','Moderator') AND status='ACTIVE') INTO staff;
 SELECT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE user_id=actor AND class_id=cid
    AND role='Student' AND status='ACTIVE') INTO stud;
 IF NOT staff AND NOT stud THEN RAISE EXCEPTION 'No access to this classroom' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'created_at'), '[]'::jsonb) INTO result
 FROM (
   SELECT jsonb_build_object(
    'id',sub.id,'assignment_id',sub.assignment_id,
    'student_id',sub.student_id,'group_id',sub.group_id,
    'student_name',(SELECT u.full_name FROM public."User" u WHERE u.id=sub.student_id),
    'group_name',(SELECT g.name FROM public."Group" g WHERE g.id=sub.group_id),
    'status',sub.status,'current_version_id',sub.current_version_id,
    'created_at',sub.created_at,'submitted_at',sub.submitted_at,
    'deadline_at_submission',sub.deadline_at_submission,
    'versions',(
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'number',v.version_number,
       'state',v.upload_state,'submitted_at',v.submitted_at,
       'deadline_at_submission',v.deadline_at_submission,'created_at',v.created_at,'uploaded_by',v.uploaded_by,
       'files',(
         SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,
          'name',f.original_filename,'size',f.size_bytes,'mime',f.mime_type,
          'state',f.upload_state,'key',CASE WHEN f.upload_state='READY' OR (f.upload_state='PENDING' AND f.uploaded_by=actor) THEN f.storage_key ELSE NULL END,
          'created_at',f.created_at) ORDER BY f.created_at),'[]'::jsonb)
         FROM public."File" f WHERE f.version_id=v.id AND f.deleted_at IS NULL
       )) ORDER BY v.version_number DESC),'[]'::jsonb)
      FROM public."SubmissionVersion" v
      WHERE v.submission_id=sub.id
    )
   ) AS entry
   FROM public."Submission" sub
   WHERE sub.assignment_id=p_assignment AND sub.deleted_at IS NULL AND sub.status<>'DELETED'
    AND (staff OR (stud AND (sub.student_id=actor OR EXISTS (
      SELECT 1 FROM public."GroupMembership" gm
      WHERE gm.group_id=sub.group_id AND gm.user_id=actor AND gm.removed_at IS NULL
    ))))
 ) v;
 RETURN coalesce(result,'[]'::jsonb);
END $function$;
