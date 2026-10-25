-- Rollback-only QA: requires one existing ACTIVE Admin and Student in the same class.
-- No credentials, permanent subjects, assignments or audit rows are created.
BEGIN;
DO $qa$
DECLARE
  v_admin uuid; v_student uuid; v_class uuid; v_subject uuid; v_assignment uuid;
  r jsonb; v_deadline timestamptz;
BEGIN
  SELECT a.user_id,s.user_id,a.class_id INTO v_admin,v_student,v_class
  FROM public."ClassMembership" a
  JOIN public."ClassMembership" s ON s.class_id=a.class_id
  WHERE a.role='Admin' AND a.status='ACTIVE'
    AND s.role='Student' AND s.status='ACTIVE'
  LIMIT 1;
  IF v_admin IS NULL OR v_student IS NULL THEN
    RAISE EXCEPTION 'QA fixture requires real ACTIVE Admin and Student in one class';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  r:=public.bn_manage_classwork(v_class,'subject.create','{"name":"QA transient subject"}'::jsonb);
  v_subject:=(r->>'id')::uuid;
  r:=public.bn_manage_classwork(v_class,'subject.rename',jsonb_build_object('id',v_subject,'name','QA renamed subject'));
  IF r->>'name'<>'QA renamed subject' THEN RAISE EXCEPTION 'Subject rename failed'; END IF;
  r:=public.bn_manage_classwork(v_class,'assignment.create',jsonb_build_object(
      'subject_id',v_subject,'name','QA classwork','description','Temporary rollback fixture',
      'deadline','2026-11-03T14:00:00Z','is_group',false,'required_file_types',jsonb_build_array('application/pdf')));
  v_assignment:=(r->>'id')::uuid;
  SELECT deadline INTO v_deadline FROM public."Assignment" WHERE id=v_assignment;
  IF (v_deadline AT TIME ZONE 'Asia/Manila') <> timestamp '2026-11-03 22:00:00'
  THEN RAISE EXCEPTION 'Manila deadline conversion incorrect'; END IF;
  r:=public.bn_manage_classwork(v_class,'assignment.update',jsonb_build_object(
       'id',v_assignment,'subject_id',v_subject,'name','QA classwork revised',
       'description','Edited','instructions','Test editing',
       'deadline','2026-11-04T14:00:00Z','is_group',false,
       'required_file_types',jsonb_build_array('application/pdf')));
  IF r->>'name'<>'QA classwork revised' THEN RAISE EXCEPTION 'Assignment edit failed'; END IF;
  r:=public.bn_manage_classwork(v_class,'assignment.status',jsonb_build_object('id',v_assignment,'status','CLOSED'));
  IF r->>'status'<>'CLOSED' THEN RAISE EXCEPTION 'Assignment status change failed'; END IF;
  IF (SELECT count(*) FROM public."AuditLog" WHERE target_id IN (v_assignment,v_subject)
       AND class_id=v_class AND actor_id=v_admin AND actor_role_at_time='Admin'
       AND action IN ('SUBJECT_CREATED','SUBJECT_RENAMED','ASSIGNMENT_CREATED',
            'ASSIGNMENT_UPDATED','DEADLINE_CHANGED','ASSIGNMENT_STATUS_CHANGED'))<>6
  THEN RAISE EXCEPTION 'Phase 2 audit actions missing'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  BEGIN
    PERFORM public.bn_manage_classwork(v_class,'subject.create','{"name":"Not allowed"}'::jsonb);
    RAISE EXCEPTION 'Student was allowed to write classwork';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  BEGIN
    PERFORM public.bn_manage_classwork(v_class,'subject.create','{"name":"Not allowed"}'::jsonb);
    RAISE EXCEPTION 'Outsider was allowed to write classwork';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- Test the actual authenticated PostgreSQL role's RLS, not only RPC checks.
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  PERFORM set_config('role','authenticated',true);
  IF NOT EXISTS(SELECT 1 FROM public."Assignment" WHERE id=v_assignment)
  THEN RAISE EXCEPTION 'ACTIVE student cannot read own class assignment'; END IF;
  BEGIN
    UPDATE public."Assignment" SET name='not allowed' WHERE id=v_assignment;
    RAISE EXCEPTION 'Student unexpectedly received direct UPDATE rights';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  IF EXISTS(SELECT 1 FROM public."Assignment" WHERE id=v_assignment)
  THEN RAISE EXCEPTION 'Outsider can read class assignment'; END IF;
  PERFORM set_config('role','postgres',true);
  RAISE NOTICE 'Phase 2 rollback QA passed: CRUD, audit, Manila timezone, Student and outsider denial';
END $qa$;
ROLLBACK;