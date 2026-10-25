-- Phase 2: class-scoped audited writes only; no public raw table writes.
-- Backend decides authorization via ACTIVE Admin ClassMembership in every request.
CREATE OR REPLACE FUNCTION bn_private.bn_classwork_manage_impl(
  p_class uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $body$
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
   IF v_max IS NOT NULL AND (v_max<1 OR v_max>104857600) THEN
     RAISE EXCEPTION 'File size limit must be between 1 byte and 100 MiB';
   END IF;
   v_deadline:=nullif(p_data->>'deadline','')::timestamptz;
   v_group:=coalesce((p_data->>'is_group')::boolean,false);
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
END $body$;

-- This exposed RPC uses the caller role and delegates to a private guarded definer.
CREATE OR REPLACE FUNCTION public.bn_manage_classwork(
 p_class uuid,p_action text,p_data jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $body$ SELECT bn_private.bn_classwork_manage_impl(p_class,p_action,p_data) $body$;

REVOKE ALL ON FUNCTION bn_private.bn_classwork_manage_impl(uuid,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_manage_classwork(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_classwork_manage_impl(uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_manage_classwork(uuid,text,jsonb) TO authenticated;

-- Audit is mandatory. Raw browser inserts would bypass it.
REVOKE INSERT,UPDATE,DELETE ON public."Subject",public."Assignment" FROM authenticated;
