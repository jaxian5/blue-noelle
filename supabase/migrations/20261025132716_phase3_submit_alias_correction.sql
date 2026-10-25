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
 UPDATE public."SubmissionVersion" SET upload_state='READY' WHERE id=ver.id;
 UPDATE public."Submission" SET status='SUBMITTED',current_version_id=ver.id,
  submitted_at=now(),deadline_at_submission=a.deadline,updated_at=now()
 WHERE id=sub.id;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,'Student',cid,'SUBMISSION_SUBMITTED','Submission',sub.id,
   jsonb_build_object('version',ver.version_number,'files',n,'late',a.deadline IS NOT NULL AND now()>a.deadline));
 RETURN jsonb_build_object('id',sub.id,'status','SUBMITTED','version_id',ver.id,
   'version',ver.version_number,'submitted_at',now(),'late',a.deadline IS NOT NULL AND now()>a.deadline);
END $function$
