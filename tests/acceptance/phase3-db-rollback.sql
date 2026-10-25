-- Phase 3: repeatable DB-only lifecycle and authorization regression.
-- Real Storage *metadata* is emulated in a transaction; file bytes are NOT uploaded.
-- All fixtures, including storage.objects, are removed by ROLLBACK.
BEGIN;
DO $qa$
DECLARE
  v_admin uuid; v_student uuid; v_class uuid;
  v_subject uuid; v_assignment uuid; v_group_assignment uuid;
  v_group uuid; v_submission uuid; v_v1 uuid; v_v2 uuid;
  v_v1_time timestamptz; v_v1_due timestamptz; v_v2_time timestamptz;
  v_path text; v_file uuid; r jsonb; v_group_sub uuid;
BEGIN
  SELECT a.user_id,s.user_id,a.class_id INTO v_admin,v_student,v_class
  FROM public."ClassMembership" a
  JOIN public."ClassMembership" s ON s.class_id=a.class_id
  WHERE a.role='Admin' AND a.status='ACTIVE'
    AND s.role='Student' AND s.status='ACTIVE' LIMIT 1;
  IF v_student IS NULL THEN RAISE EXCEPTION 'QA needs an ACTIVE Admin and Student in one class'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  r:=public.bn_manage_classwork(v_class,'subject.create', '{"name":"QA P3 rollback subject"}'::jsonb);
  v_subject:=(r->>'id')::uuid;
  r:=public.bn_manage_classwork(v_class,'assignment.create',jsonb_build_object(
    'subject_id',v_subject,'name','QA two-version submission','is_group',false,
    'deadline','2026-11-03T14:00:00Z','required_file_types',jsonb_build_array('application/pdf')));
  v_assignment:=(r->>'id')::uuid;

  -- V1 preparation, fake Storage metadata, finalize and submit.
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  r:=public.bn_p3_prepare(v_assignment,'first.pdf','application/pdf',5,NULL);
  v_submission:=(r->>'submission_id')::uuid;
  v_v1:=(r->>'version_id')::uuid;
  v_file:=(r->>'file_id')::uuid;
  v_path:=r->>'storage_key';
  INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES('bn-submissions',v_path,'{"size":5,"mimetype":"application/pdf"}'::jsonb);
  r:=public.bn_p3_finish_file(v_file);
  IF NOT (r->>'ready')::boolean THEN RAISE EXCEPTION 'V1 failed metadata finalization'; END IF;
  r:=public.bn_p3_submit(v_submission,v_v1);
  SELECT submitted_at,deadline_at_submission INTO v_v1_time,v_v1_due
  FROM public."SubmissionVersion" WHERE id=v_v1;
  IF v_v1_time IS NULL OR v_v1_due IS DISTINCT FROM '2026-11-03T14:00:00Z'::timestamptz
  THEN RAISE EXCEPTION 'V1 historical snapshot not stored'; END IF;

  -- V2: previous timestamps are cleared on Submission, not its READY version.
  r:=public.bn_p3_prepare(v_assignment,'second.pdf','application/pdf',6,NULL);
  v_v2:=(r->>'version_id')::uuid;
  IF v_v2=v_v1 THEN RAISE EXCEPTION 'New version not allocated'; END IF;
  IF (SELECT status FROM public."Submission" WHERE id=v_submission)<>'DRAFT'
  THEN RAISE EXCEPTION 'Resubmission did not reopen draft'; END IF;
  IF (SELECT submitted_at FROM public."SubmissionVersion" WHERE id=v_v1)
      IS DISTINCT FROM v_v1_time THEN RAISE EXCEPTION 'V1 timestamp changed'; END IF;
  -- The assignment deadline changes after V1; V2 should snapshot the new date.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  r:=public.bn_manage_classwork(v_class,'assignment.update',jsonb_build_object(
    'id',v_assignment,'subject_id',v_subject,'name','QA two-version submission',
    'deadline','2026-11-05T14:00:00Z','is_group',false,
    'required_file_types',jsonb_build_array('application/pdf')));
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  v_path:= (SELECT storage_key FROM public."File" WHERE version_id=v_v2);
  v_file:= (SELECT id FROM public."File" WHERE version_id=v_v2);
  INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES('bn-submissions',v_path,'{"size":6,"mimetype":"application/pdf"}'::jsonb);
  PERFORM public.bn_p3_finish_file(v_file);
  PERFORM public.bn_p3_submit(v_submission,v_v2);
  SELECT submitted_at INTO v_v2_time FROM public."SubmissionVersion" WHERE id=v_v2;
  IF v_v2_time IS NULL OR (SELECT current_version_id FROM public."Submission" WHERE id=v_submission)<>v_v2
   OR (SELECT deadline_at_submission FROM public."SubmissionVersion" WHERE id=v_v2)
       IS DISTINCT FROM '2026-11-05T14:00:00Z'::timestamptz
   OR (SELECT deadline_at_submission FROM public."SubmissionVersion" WHERE id=v_v1)
       IS DISTINCT FROM v_v1_due
  THEN RAISE EXCEPTION 'V2 did not preserve both snapshots'; END IF;
  r:=public.bn_p3_details(v_assignment);
  IF jsonb_array_length(r)<>1 OR jsonb_array_length(r->0->'versions')<>2
     OR (r->0->'versions'->0->>'submitted_at') IS NULL
  THEN RAISE EXCEPTION 'Version history was not returned'; END IF;
  -- Exercise Storage RLS using the authenticated PostgreSQL role.
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  PERFORM set_config('role','authenticated',true);
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='bn-submissions' AND name=v_path)
  THEN RAISE EXCEPTION 'Authenticated owner cannot SELECT READY Storage metadata'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='bn-submissions' AND name=v_path)
  THEN RAISE EXCEPTION 'Storage RLS exposed READY object to outsider'; END IF;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  -- Regression: a previously READY version's timestamp cannot be overwritten.
  BEGIN
    UPDATE public."SubmissionVersion" SET submitted_at=now()+interval '1 day' WHERE id=v_v1;
    RAISE EXCEPTION 'READY version timestamp was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Submitted version history is immutable' THEN RAISE; END IF;
  END;
  -- Verify read authorization through the storage key helper.
  IF NOT bn_private.bn_p3_can_object(v_path,false)
  THEN RAISE EXCEPTION 'Owner lost private object read permission'; END IF;
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  IF bn_private.bn_p3_can_object(v_path,false) THEN RAISE EXCEPTION 'Outsider can read private object'; END IF;
  BEGIN
    PERFORM public.bn_p3_details(v_assignment);
    RAISE EXCEPTION 'Outsider can read submissions';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Group assignment and class-scoped group member checks.
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  r:=public.bn_manage_classwork(v_class,'assignment.create',jsonb_build_object(
    'subject_id',v_subject,'name','QA group submission','is_group',true,
    'required_file_types',jsonb_build_array('application/pdf')));
  v_group_assignment:=(r->>'id')::uuid;
  r:=public.bn_p3_groups(v_group_assignment,'create',NULL,NULL,'QA shared team');
  v_group:=(r->0->>'id')::uuid;
  PERFORM public.bn_p3_groups(v_group_assignment,'add_member',v_group,v_student,NULL);
  PERFORM set_config('request.jwt.claim.sub',v_student::text,true);
  r:=public.bn_p3_prepare(v_group_assignment,'team.pdf','application/pdf',7,NULL);
  v_group_sub:=(r->>'submission_id')::uuid;
  IF (SELECT group_id FROM public."Submission" WHERE id=v_group_sub) IS DISTINCT FROM v_group
  THEN RAISE EXCEPTION 'Group-owned submission missing'; END IF;
  v_path:=r->>'storage_key';
  INSERT INTO storage.objects(bucket_id,name,metadata)
    VALUES('bn-submissions',v_path,'{"size":7,"mimetype":"application/pdf"}'::jsonb);
  PERFORM public.bn_p3_finish_file((r->>'file_id')::uuid);
  PERFORM public.bn_p3_submit(v_group_sub,(r->>'version_id')::uuid);
  PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  IF bn_private.bn_p3_can_object(v_path,false)
    THEN RAISE EXCEPTION 'Non-member could read group files'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
  IF NOT bn_private.bn_p3_can_object(v_path,false)
    THEN RAISE EXCEPTION 'Class Admin could not review group submission'; END IF;
  RAISE NOTICE 'Phase 3 rollback QA PASS: two version snapshots, metadata-only storage, group ownership and outsider denial';
END $qa$;
ROLLBACK;