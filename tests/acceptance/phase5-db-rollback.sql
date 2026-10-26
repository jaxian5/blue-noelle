-- Phase 5 live database acceptance, explicitly rollback-only.
-- Uses currently approved Admin, Student, Class and Subject. No persisted records.
BEGIN;
DO $qa$
DECLARE
  admin_id uuid;student_id uuid;v_class uuid;subject_id uuid;
  assignment_id uuid;group_id uuid;submission_id uuid;
  result jsonb;failed boolean;logs_before int;logs_after int;
BEGIN
 SELECT admin.user_id, student.user_id,admin.class_id,s.id
 INTO admin_id,student_id,v_class,subject_id
 FROM public."ClassMembership" admin
 JOIN public."ClassMembership" student
   ON student.class_id=admin.class_id
  AND student.role='Student' AND student.status='ACTIVE'
 JOIN public."Subject" s ON s.class_id=admin.class_id AND s.deleted_at IS NULL
 WHERE admin.role='Admin' AND admin.status='ACTIVE'
 LIMIT 1;
 IF admin_id IS NULL OR student_id IS NULL OR subject_id IS NULL THEN
  RAISE EXCEPTION 'Acceptance needs ACTIVE Admin and Student in class with a Subject';
 END IF;
 IF has_table_privilege('authenticated','public."Compilation"','SELECT')
  OR has_table_privilege('authenticated','public."Group"','INSERT')
  OR has_table_privilege('authenticated','public."GroupMembership"','UPDATE')
 THEN RAISE EXCEPTION 'Phase 5 tables are directly accessible';END IF;

 INSERT INTO public."Assignment"(subject_id,name,is_group,status,created_by)
 VALUES(subject_id,'Phase 5 rollback only',true,'OPEN',admin_id)
 RETURNING id INTO assignment_id;
 SELECT count(*) INTO logs_before FROM public."AuditLog"
 WHERE class_id=v_class AND action='COMPILATION_MANIFEST_EXPORTED';
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('role','authenticated',true);
 result:=public.bn_p3_groups(assignment_id,'create',NULL,NULL,'QA Test Team');
 group_id:=(result->0->>'id')::uuid;
 IF group_id IS NULL THEN RAISE EXCEPTION 'Audited group RPC did not create group';END IF;
 result:=public.bn_p3_groups(assignment_id,'add_member',group_id,student_id,NULL);
 IF jsonb_array_length(result->0->'members')<>1 THEN
  RAISE EXCEPTION 'Group membership was not assigned';
 END IF;
 result:=public.bn_p5_compilation(assignment_id,false);
 IF result->>'format'<>'metadata-only' OR (result->>'count')::int<>0
  OR result->>'contains_private_file_urls'<>'false'
 THEN RAISE EXCEPTION 'Unexpected compilation manifest structure';END IF;
 result:=public.bn_p5_compilation(assignment_id,true);

 PERFORM set_config('role','postgres',true);
 INSERT INTO public."Submission"(assignment_id,group_id,status)
 VALUES(assignment_id,group_id,'DRAFT') RETURNING id INTO submission_id;
 PERFORM set_config('role','authenticated',true);
 failed:=false;
 BEGIN
  PERFORM public.bn_p3_groups(assignment_id,'remove_member',group_id,student_id,NULL);
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%membership is locked%' THEN failed:=true;
  ELSE RAISE;END IF;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Group membership changed after draft';END IF;

 PERFORM set_config('request.jwt.claim.sub',student_id::text,true);
 failed:=false;
 BEGIN
  PERFORM public.bn_p5_compilation(assignment_id,false);
 EXCEPTION WHEN insufficient_privilege THEN failed:=true;
 END;
 IF NOT failed THEN RAISE EXCEPTION 'Student accessed staff compilation manifest';END IF;

 PERFORM set_config('role','postgres',true);
 SELECT count(*) INTO logs_after FROM public."AuditLog"
 WHERE class_id=v_class AND action='COMPILATION_MANIFEST_EXPORTED';
 IF logs_after-logs_before<>1 THEN RAISE EXCEPTION 'Manifest export was not audited';END IF;
 RAISE NOTICE 'PASS: Admin group, member, metadata manifest, audit, Student denial, draft freeze';
END $qa$;
ROLLBACK;
