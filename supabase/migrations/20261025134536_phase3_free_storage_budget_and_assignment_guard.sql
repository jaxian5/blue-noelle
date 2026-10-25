-- Final Phase 2 ownership protection and Phase 3 Free Plan storage budgets.
CREATE OR REPLACE FUNCTION bn_private.bn_classwork_manage_impl(p_class uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_actor uuid := auth.uid();
 v_name text;
 v_subject_id uuid;
 v_target uuid;
 v_subject public."Subject"%ROWTYPE;
 v_assignment public."Assignment"%ROWTYPE;
 v_before public."Assignment"%ROWTYPE;
 v_types text[] := '{}';
 v_max bigint;
 v_deadline timestamptz;
 v_new_status text;
 v_group boolean;
 v_description text;
 v_instructions text;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF p_class IS NULL OR NOT EXISTS (
   SELECT 1 FROM public."ClassMembership" m
   WHERE m.user_id=v_actor AND m.class_id=p_class
     AND m.role='Admin' AND m.status='ACTIVE'
 ) THEN RAISE EXCEPTION 'Active class Admin membership required' USING ERRCODE='42501'; END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' THEN
   RAISE EXCEPTION 'Invalid classwork payload';
 END IF;
 IF p_action IN ('subject.create','subject.rename') THEN
   v_name:=btrim(coalesce(p_data->>'name',''));
   IF length(v_name)<1 OR length(v_name)>160 THEN RAISE EXCEPTION 'Subject name must contain 1 to 160 characters'; END IF;
   IF p_action='subject.create' THEN
     INSERT INTO public."Subject"(class_id,name,created_by)
       VALUES(p_class,v_name,v_actor) RETURNING * INTO v_subject;
     INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
       VALUES(v_actor,'Admin',p_class,'SUBJECT_CREATED','Subject',v_subject.id,jsonb_build_object('name',v_name));
   ELSE
     v_target := (p_data->>'id')::uuid;
     UPDATE public."Subject" SET name=v_name
      WHERE id=v_target AND class_id=p_class AND deleted_at IS NULL
      RETURNING * INTO v_subject;
     IF NOT FOUND THEN RAISE EXCEPTION 'Subject not found in this class' USING ERRCODE='42501'; END IF;
     INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
       VALUES(v_actor,'Admin',p_class,'SUBJECT_RENAMED','Subject',v_subject.id,jsonb_build_object('name',v_name));
   END IF;
   RETURN jsonb_build_object('id',v_subject.id,'name',v_subject.name,'class_id',p_class);
 ELSIF p_action IN ('assignment.create','assignment.update','assignment.status') THEN
   IF p_action='assignment.create' THEN
     v_subject_id:=(p_data->>'subject_id')::uuid;
   ELSE
     v_target:=(p_data->>'id')::uuid;
     SELECT a.* INTO v_assignment FROM public."Assignment" a
       JOIN public."Subject" s ON s.id=a.subject_id
       WHERE a.id=v_target AND s.class_id=p_class
        AND s.deleted_at IS NULL AND a.deleted_at IS NULL
       FOR UPDATE OF a;
     IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found in this class' USING ERRCODE='42501'; END IF;
     v_before:=v_assignment;
     v_subject_id:=v_assignment.subject_id;
     IF p_action='assignment.update' AND p_data ? 'subject_id' THEN
       v_subject_id:=(p_data->>'subject_id')::uuid;
     END IF;
   END IF;
   IF p_action='assignment.status' THEN
     v_new_status:=upper(btrim(coalesce(p_data->>'status','')));
     IF v_new_status NOT IN ('OPEN','CLOSED','ARCHIVED') THEN
       RAISE EXCEPTION 'Invalid assignment status';
     END IF;
     IF v_before.status=v_new_status THEN
       RETURN jsonb_build_object('id',v_before.id,'status',v_before.status);
     END IF;
     UPDATE public."Assignment" SET status=v_new_status,updated_at=now()
        WHERE id=v_before.id RETURNING * INTO v_assignment;
     INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
       VALUES(v_actor,'Admin',p_class,'ASSIGNMENT_STATUS_CHANGED','Assignment',v_assignment.id,
         jsonb_build_object('before',v_before.status,'after',v_assignment.status));
     RETURN jsonb_build_object('id',v_assignment.id,'status',v_assignment.status);
   END IF;
   SELECT * INTO v_subject FROM public."Subject"
      WHERE id=v_subject_id AND class_id=p_class AND deleted_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Subject not found in this class' USING ERRCODE='42501'; END IF;
   v_name:=btrim(coalesce(p_data->>'name',''));
   IF length(v_name)<1 OR length(v_name)>180 THEN RAISE EXCEPTION 'Assignment name must contain 1 to 180 characters'; END IF;
   v_description:=coalesce(p_data->>'description','');
   v_instructions:=coalesce(p_data->>'instructions','');
   IF length(v_description)>20000 OR length(v_instructions)>20000 THEN
     RAISE EXCEPTION 'Assignment description or instructions too long';
   END IF;
   IF p_data ? 'required_file_types' AND jsonb_typeof(p_data->'required_file_types') <> 'array' THEN
     RAISE EXCEPTION 'File types must be an array';
   END IF;
   SELECT coalesce(array_agg(btrim(t)),ARRAY[]::text[]) INTO v_types
     FROM jsonb_array_elements_text(coalesce(p_data->'required_file_types','[]'::jsonb)) AS t;
   IF coalesce(array_length(v_types,1),0)>12
      OR EXISTS(SELECT 1 FROM unnest(v_types) AS t WHERE length(t)>100 OR length(t)=0) THEN
     RAISE EXCEPTION 'Invalid required file types';
   END IF;
   v_max:=nullif(p_data->>'max_file_size_bytes','')::bigint;
   IF v_max IS NOT NULL AND (v_max<1 OR v_max>41943040) THEN
     RAISE EXCEPTION 'File size limit must be between 1 byte and 40 MiB';
   END IF;
   v_deadline:=nullif(p_data->>'deadline','')::timestamptz;
   v_group:=coalesce((p_data->>'is_group')::boolean,false);
   IF p_action='assignment.update'
     AND v_group IS DISTINCT FROM v_before.is_group
     AND (EXISTS(SELECT 1 FROM public."Submission" sub WHERE sub.assignment_id=v_before.id AND sub.deleted_at IS NULL)
       OR EXISTS(SELECT 1 FROM public."Group" grp WHERE grp.assignment_id=v_before.id AND grp.deleted_at IS NULL))
   THEN RAISE EXCEPTION 'Cannot change Individual/Group ownership after groups or submissions exist'; END IF;
   IF p_action='assignment.create' THEN
     INSERT INTO public."Assignment"(subject_id,name,description,instructions,deadline,
       is_group,required_file_types,max_file_size_bytes,created_by,status)
     VALUES(v_subject_id,v_name,v_description,v_instructions,v_deadline,v_group,
       v_types,v_max,v_actor,'OPEN') RETURNING * INTO v_assignment;
     INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
       VALUES(v_actor,'Admin',p_class,'ASSIGNMENT_CREATED','Assignment',v_assignment.id,
         jsonb_build_object('subject_id',v_subject_id,'name',v_name,'is_group',v_group));
   ELSE
     UPDATE public."Assignment" SET subject_id=v_subject_id,name=v_name,
       description=v_description,instructions=v_instructions,deadline=v_deadline,
       is_group=v_group,required_file_types=v_types,max_file_size_bytes=v_max,updated_at=now()
     WHERE id=v_before.id RETURNING * INTO v_assignment;
     INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
       VALUES(v_actor,'Admin',p_class,'ASSIGNMENT_UPDATED','Assignment',v_assignment.id,
         jsonb_build_object('name_before',v_before.name,'name_after',v_assignment.name,
                            'subject_before',v_before.subject_id,'subject_after',v_subject_id));
     IF v_before.deadline IS DISTINCT FROM v_assignment.deadline THEN
       INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
       VALUES(v_actor,'Admin',p_class,'DEADLINE_CHANGED','Assignment',v_assignment.id,
         jsonb_build_object('before',v_before.deadline,'after',v_assignment.deadline));
     END IF;
   END IF;
   RETURN jsonb_build_object('id',v_assignment.id,'subject_id',v_assignment.subject_id,
     'name',v_assignment.name,'status',v_assignment.status,'deadline',v_assignment.deadline);
 ELSE
   RAISE EXCEPTION 'Unknown classwork action';
 END IF;
END $function$;
CREATE OR REPLACE FUNCTION bn_private.bn_p3_prepare_impl(p_assignment uuid, p_filename text, p_mime text, p_bytes bigint, p_version uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 -- Enforce free-plan storage budgets transactionally across all verified students.
 PERFORM pg_advisory_xact_lock(hashtextextended('bn-p3-global-free-budget',0));
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,0));
 IF (SELECT coalesce(sum(f.size_bytes),0) FROM public."File" f WHERE f.deleted_at IS NULL)
     + p_bytes > 786432000 THEN
    RAISE EXCEPTION 'Blue Noelle storage budget is nearly full. Contact your Admin.';
 END IF;
 IF (SELECT coalesce(sum(f.size_bytes),0) FROM public."File" f
       WHERE f.uploaded_by=actor AND f.deleted_at IS NULL) + p_bytes > 209715200 THEN
    RAISE EXCEPTION 'You have reached your 200 MiB personal upload budget.';
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
END $function$;
