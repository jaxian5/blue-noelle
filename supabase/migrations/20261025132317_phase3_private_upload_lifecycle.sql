-- Phase 3: private submission lifecycle, server-issued object names, immutable versions.
-- All privileged operations validate auth.uid against ACTIVE class membership.
INSERT INTO storage.buckets (id,name,public,file_size_limit)
VALUES ('bn-submissions','bn-submissions',false,41943040)
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=41943040;

ALTER TABLE public."File"
 ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public."User"(id),
 ADD COLUMN IF NOT EXISTS upload_state text NOT NULL DEFAULT 'PENDING'
 CHECK (upload_state IN ('PENDING','READY'));
ALTER TABLE public."SubmissionVersion"
 ADD COLUMN IF NOT EXISTS upload_state text NOT NULL DEFAULT 'UPLOADING'
 CHECK (upload_state IN ('UPLOADING','READY'));
CREATE UNIQUE INDEX IF NOT EXISTS bn_p3_one_student_submission
 ON public."Submission"(assignment_id,student_id)
 WHERE student_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bn_p3_one_group_submission
 ON public."Submission"(assignment_id,group_id)
 WHERE group_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bn_p3_active_group_member_once
 ON public."GroupMembership"(group_id,user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS bn_p3_file_lookup ON public."File"(version_id,upload_state);
CREATE INDEX IF NOT EXISTS bn_p3_submission_assignment ON public."Submission"(assignment_id,status);

-- Helper is deliberately in the non-exposed schema. Only used inside storage
-- RLS, where the current JWT subject must remain authoritative.
CREATE OR REPLACE FUNCTION bn_private.bn_p3_can_object(p_key text,p_upload boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 SELECT EXISTS(
 SELECT 1
 FROM public."File" f
 JOIN public."SubmissionVersion" v ON v.id=f.version_id
 JOIN public."Submission" sub ON sub.id=v.submission_id
 JOIN public."Assignment" a ON a.id=sub.assignment_id
 JOIN public."Subject" s ON s.id=a.subject_id
 JOIN public."ClassMembership" cm ON cm.class_id=s.class_id AND cm.user_id=auth.uid()
 WHERE f.storage_key=p_key AND f.deleted_at IS NULL
   AND sub.deleted_at IS NULL AND a.deleted_at IS NULL AND s.deleted_at IS NULL
   AND cm.status='ACTIVE'
   AND (
     (p_upload AND cm.role='Student' AND sub.status='DRAFT'
      AND a.status='OPEN' AND f.upload_state='PENDING'
      AND f.uploaded_by=auth.uid()
      AND (sub.student_id=auth.uid() OR EXISTS(
       SELECT 1 FROM public."GroupMembership" gm
       WHERE gm.group_id=sub.group_id AND gm.user_id=auth.uid()
         AND gm.removed_at IS NULL)))
    OR
     (NOT p_upload AND f.upload_state='READY' AND (
        cm.role IN ('Admin','Moderator') OR
        (cm.role='Student' AND (sub.student_id=auth.uid() OR EXISTS(
          SELECT 1 FROM public."GroupMembership" gm
          WHERE gm.group_id=sub.group_id AND gm.user_id=auth.uid()
          AND gm.removed_at IS NULL)))
     ))
   )
 ) $fn$;
REVOKE ALL ON FUNCTION bn_private.bn_p3_can_object(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_can_object(text,boolean) TO authenticated;

DROP POLICY IF EXISTS bn_p3_upload_private ON storage.objects;
DROP POLICY IF EXISTS bn_p3_read_private ON storage.objects;
DROP POLICY IF EXISTS bn_p3_remove_unfinished ON storage.objects;
CREATE POLICY bn_p3_upload_private ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='bn-submissions' AND bn_private.bn_p3_can_object(name,true));
CREATE POLICY bn_p3_read_private ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='bn-submissions' AND bn_private.bn_p3_can_object(name,false));
-- No direct UPDATE/UPSERT or DELETE. Versions are immutable after upload.

CREATE OR REPLACE FUNCTION bn_private.bn_p3_prepare_impl(
 p_assignment uuid,p_filename text,p_mime text,p_bytes bigint,p_version uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=auth.uid(); sid uuid; cid uuid; is_group boolean;
 gr uuid; sub public."Submission"%ROWTYPE; ver public."SubmissionVersion"%ROWTYPE;
 fid uuid:=gen_random_uuid(); key text; v_no int;
 max_bytes bigint; permitted text[]; filename text:=btrim(coalesce(p_filename,''));
 mime text:=lower(btrim(coalesce(p_mime,'')));
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT s.class_id,a.is_group,a.max_file_size_bytes,a.required_file_types
 INTO cid,is_group,max_bytes,permitted
 FROM public."Assignment" a JOIN public."Subject" s ON s.id=a.subject_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND a.status='OPEN' AND s.deleted_at IS NULL;
 IF cid IS NULL THEN RAISE EXCEPTION 'Assignment is unavailable for submission' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE class_id=cid AND user_id=actor AND status='ACTIVE' AND role='Student') THEN
  RAISE EXCEPTION 'An ACTIVE Student membership is required' USING ERRCODE='42501';
 END IF;
 IF p_bytes IS NULL OR p_bytes<1 OR p_bytes>least(coalesce(max_bytes,41943040),41943040) THEN
  RAISE EXCEPTION 'File exceeds permitted size or is empty';
 END IF;
 IF length(filename)<1 OR length(filename)>255 OR position('/' IN filename)>0 OR position(chr(92) IN filename)>0 THEN
  RAISE EXCEPTION 'Invalid filename';
 END IF;
 IF length(mime)<3 OR length(mime)>120 OR mime !~ '^[a-z0-9][a-z0-9.+_-]*/[a-z0-9.+_-]+$' THEN
  RAISE EXCEPTION 'Invalid content type';
 END IF;
 IF cardinality(permitted)>0 AND NOT mime=ANY(permitted) THEN
  RAISE EXCEPTION 'File type is not permitted for this assignment';
 END IF;
 IF is_group THEN
   SELECT g.id INTO gr
   FROM public."Group" g
   JOIN public."GroupMembership" gm ON gm.group_id=g.id AND gm.user_id=actor AND gm.removed_at IS NULL
   WHERE g.assignment_id=p_assignment AND g.deleted_at IS NULL LIMIT 1;
   IF gr IS NULL THEN RAISE EXCEPTION 'You are not a member of an assigned group' USING ERRCODE='42501'; END IF;
 END IF;
 -- Advisory lock serializes submission/version creation for the owner and assignment.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_assignment::text||coalesce(gr::text,actor::text),0));
 SELECT * INTO sub FROM public."Submission"
 WHERE assignment_id=p_assignment AND deleted_at IS NULL
  AND ((is_group AND group_id=gr) OR (NOT is_group AND student_id=actor))
 FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO public."Submission"(assignment_id,student_id,group_id,status)
  VALUES(p_assignment,CASE WHEN is_group THEN NULL ELSE actor END,
    CASE WHEN is_group THEN gr ELSE NULL END,'DRAFT')
  RETURNING * INTO sub;
 END IF;
 IF sub.status='DELETED' THEN RAISE EXCEPTION 'Submission is no longer available'; END IF;
 IF p_version IS NULL THEN
  SELECT coalesce(max(version_number),0)+1 INTO v_no FROM public."SubmissionVersion" WHERE submission_id=sub.id;
  IF v_no>40 THEN RAISE EXCEPTION 'Maximum 40 submission versions reached'; END IF;
  INSERT INTO public."SubmissionVersion"(submission_id,version_number,uploaded_by,upload_state)
  VALUES(sub.id,v_no,actor,'UPLOADING') RETURNING * INTO ver;
  IF sub.status='SUBMITTED' THEN
   UPDATE public."Submission" SET status='DRAFT',submitted_at=NULL,deadline_at_submission=NULL,updated_at=now()
   WHERE id=sub.id;
  END IF;
 ELSE
  SELECT * INTO ver FROM public."SubmissionVersion"
  WHERE id=p_version AND submission_id=sub.id AND upload_state='UPLOADING';
  IF NOT FOUND OR sub.status<>'DRAFT' THEN RAISE EXCEPTION 'This upload version is unavailable'; END IF;
 END IF;
 IF (SELECT count(*) FROM public."File" WHERE version_id=ver.id AND deleted_at IS NULL)>=12 THEN
  RAISE EXCEPTION 'Maximum 12 files per version reached';
 END IF;
 key:=cid::text||'/'||p_assignment::text||'/'||sub.id::text||'/'||ver.id::text||'/'||fid::text;
 INSERT INTO public."File"(id,version_id,original_filename,storage_key,mime_type,size_bytes,uploaded_by,upload_state)
 VALUES(fid,ver.id,filename,key,mime,p_bytes,actor,'PENDING');
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,'Student',cid,'SUBMISSION_UPLOAD_PREPARED','File',fid,jsonb_build_object('submission',sub.id,'version',ver.id,'filename',filename));
 RETURN jsonb_build_object('submission_id',sub.id,'version_id',ver.id,'file_id',fid,
  'storage_key',key,'bucket','bn-submissions','max_bytes',least(coalesce(max_bytes,41943040),41943040));
END $fn$;

CREATE OR REPLACE FUNCTION bn_private.bn_p3_finish_file_impl(p_file uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=auth.uid(); f public."File"%ROWTYPE; sub public."Submission"%ROWTYPE;
 ver public."SubmissionVersion"%ROWTYPE; cid uuid; a public."Assignment"%ROWTYPE;
 object_row storage.objects%ROWTYPE; actual_size bigint; actual_mime text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public."File" WHERE id=p_file AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR f.upload_state<>'PENDING' OR f.uploaded_by IS DISTINCT FROM actor THEN
  RAISE EXCEPTION 'You cannot finalize this upload' USING ERRCODE='42501'; END IF;
 SELECT * INTO ver FROM public."SubmissionVersion" WHERE id=f.version_id;
 SELECT * INTO sub FROM public."Submission" WHERE id=ver.submission_id FOR UPDATE;
 SELECT a.* INTO a FROM public."Assignment" a WHERE a.id=sub.assignment_id;
 SELECT s.class_id INTO cid FROM public."Subject" s WHERE s.id=a.subject_id;
 IF sub.status<>'DRAFT' OR a.status<>'OPEN' OR
  NOT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE class_id=cid AND user_id=actor AND status='ACTIVE' AND role='Student')
  OR NOT (sub.student_id=actor OR EXISTS(SELECT 1 FROM public."GroupMembership" WHERE group_id=sub.group_id AND user_id=actor AND removed_at IS NULL))
 THEN RAISE EXCEPTION 'Upload authorization expired' USING ERRCODE='42501'; END IF;
 SELECT * INTO object_row FROM storage.objects WHERE bucket_id='bn-submissions' AND name=f.storage_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'File is not yet uploaded to private Storage'; END IF;
 actual_size:=nullif(object_row.metadata->>'size','')::bigint;
 actual_mime:=lower(coalesce(object_row.metadata->>'mimetype',''));
 IF actual_size IS NULL OR actual_size<>f.size_bytes OR actual_size>41943040
  OR actual_size>coalesce(a.max_file_size_bytes,41943040)
  OR actual_mime IS DISTINCT FROM f.mime_type
  OR (cardinality(a.required_file_types)>0 AND NOT actual_mime=ANY(a.required_file_types))
 THEN RAISE EXCEPTION 'Uploaded file metadata does not match the permitted file' USING ERRCODE='22023'; END IF;
 UPDATE public."File" SET upload_state='READY' WHERE id=f.id;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,'Student',cid,'SUBMISSION_FILE_READY','File',f.id,jsonb_build_object('submission',sub.id,'version',ver.id));
 RETURN jsonb_build_object('file_id',f.id,'version_id',ver.id,'ready',true);
END $fn$;

CREATE OR REPLACE FUNCTION bn_private.bn_p3_submit_impl(p_submission uuid,p_version uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=auth.uid(); sub public."Submission"%ROWTYPE; ver public."SubmissionVersion"%ROWTYPE;
 cid uuid; a public."Assignment"%ROWTYPE; n int;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO sub FROM public."Submission" WHERE id=p_submission AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR sub.status<>'DRAFT' THEN RAISE EXCEPTION 'Draft submission not found'; END IF;
 SELECT a.* INTO a FROM public."Assignment" a WHERE a.id=sub.assignment_id AND a.status='OPEN' AND a.deleted_at IS NULL;
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
 UPDATE public."SubmissionVersion" SET upload_state='READY' WHERE id=ver.id;
 UPDATE public."Submission" SET status='SUBMITTED',current_version_id=ver.id,
  submitted_at=now(),deadline_at_submission=a.deadline,updated_at=now()
 WHERE id=sub.id;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,'Student',cid,'SUBMISSION_SUBMITTED','Submission',sub.id,
   jsonb_build_object('version',ver.version_number,'files',n,'late',a.deadline IS NOT NULL AND now()>a.deadline));
 RETURN jsonb_build_object('id',sub.id,'status','SUBMITTED','version_id',ver.id,
   'version',ver.version_number,'submitted_at',now(),'late',a.deadline IS NOT NULL AND now()>a.deadline);
END $fn$;

CREATE OR REPLACE FUNCTION public.bn_p3_prepare(p_assignment uuid,p_filename text,p_mime text,p_bytes bigint,p_version uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $fn$ SELECT bn_private.bn_p3_prepare_impl(p_assignment,p_filename,p_mime,p_bytes,p_version) $fn$;
CREATE OR REPLACE FUNCTION public.bn_p3_finish_file(p_file uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $fn$ SELECT bn_private.bn_p3_finish_file_impl(p_file) $fn$;
CREATE OR REPLACE FUNCTION public.bn_p3_submit(p_submission uuid,p_version uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $fn$ SELECT bn_private.bn_p3_submit_impl(p_submission,p_version) $fn$;

REVOKE ALL ON FUNCTION public.bn_p3_prepare(uuid,text,text,bigint,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p3_finish_file(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p3_submit(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION bn_private.bn_p3_prepare_impl(uuid,text,text,bigint,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION bn_private.bn_p3_finish_file_impl(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION bn_private.bn_p3_submit_impl(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p3_prepare(uuid,text,text,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p3_finish_file(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p3_submit(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_prepare_impl(uuid,text,text,bigint,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_finish_file_impl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_submit_impl(uuid,uuid) TO authenticated;
REVOKE ALL ON public."Submission",public."SubmissionVersion",public."File" FROM PUBLIC,anon,authenticated;
