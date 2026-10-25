CREATE OR REPLACE FUNCTION bn_private.bn_p3_finish_file_impl(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 SELECT ass.* INTO a FROM public."Assignment" ass WHERE ass.id=sub.assignment_id;
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
END $function$;