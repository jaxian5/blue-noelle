-- Phase 5 final DB acceptance. All fixtures AND AuditLog rows roll back.
-- File bytes are intentionally not uploaded here. Edge byte tests are separate.
BEGIN;
DO $qa$
DECLARE
 admin uuid;student uuid;cid uuid;sid uuid;aid uuid;
 sub uuid;version uuid;exportid uuid;secondid uuid;path text;
 response jsonb; denied boolean;ready boolean;source_count integer;other_role text;
BEGIN
 SELECT a.user_id,s.user_id,a.class_id INTO admin,student,cid
 FROM public."ClassMembership" a JOIN public."ClassMembership" s
   ON s.class_id=a.class_id
 WHERE a.role='Admin' AND a.status='ACTIVE'
 AND s.role='Student' AND s.status='ACTIVE' LIMIT 1;
 IF admin IS NULL THEN RAISE EXCEPTION 'Requires an ACTIVE Admin/Student pair';END IF;
 IF has_table_privilege('authenticated','public."CompilationExport"','SELECT')
   OR has_table_privilege('authenticated','public."Compilation"','SELECT')
 THEN RAISE EXCEPTION 'Compilation tables must not be exposed to authenticated SQL';END IF;
 IF has_function_privilege('authenticated',
   'public.bn_p5_export_finish(uuid,boolean,bigint,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Client can forge a completed artifact';END IF;

 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 response:=public.bn_manage_classwork(cid,'subject.create',
   '{"name":"Phase 5 output QA temporary subject"}'::jsonb);
 sid:=(response->>'id')::uuid;
 response:=public.bn_manage_classwork(cid,'assignment.create',jsonb_build_object(
   'subject_id',sid,'name','Phase 5 compiled file QA (ROLLBACK)',
   'deadline','2026-11-10T14:00:00Z',
   'required_file_types',jsonb_build_array('application/pdf')));
 aid:=(response->>'id')::uuid;

 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 response:=public.bn_p3_prepare(aid,'qa-submitted.pdf','application/pdf',5,NULL);
 sub:=(response->>'submission_id')::uuid;
 version:=(response->>'version_id')::uuid;
 path:=response->>'storage_key';
 INSERT INTO storage.objects(bucket_id,name,metadata)
 VALUES('bn-submissions',path,'{"size":5,"mimetype":"application/pdf"}'::jsonb);
 PERFORM public.bn_p3_finish_file((response->>'file_id')::uuid);
 PERFORM public.bn_p3_submit(sub,version);

 denied:=false;
 BEGIN PERFORM public.bn_p5_export_start(aid,'zip');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Student was able to start staff-only export';END IF;

 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 response:=public.bn_p5_export_start(aid,'pdf');
 exportid:=(response->>'id')::uuid;
 IF exportid IS NULL OR response->>'format'<>'pdf'
    OR (response->>'file_count')::int<>1 THEN
  RAISE EXCEPTION 'PDF export did not freeze exactly one ready file';END IF;
 IF (response->'files'->0->>'key') IS DISTINCT FROM path THEN
  RAISE EXCEPTION 'Compilation source differs from recorded file';END IF;
 SELECT count(*) INTO source_count FROM public."Compilation" WHERE export_id=exportid
  AND submission_id=sub AND source_version_id=version;
 IF source_count<>1 THEN RAISE EXCEPTION 'Source version provenance not stored';END IF;
 response:=public.bn_p5_export_history(aid);
 IF response->0->>'status'<>'BUILDING' THEN RAISE EXCEPTION 'History missing pending export';END IF;
 denied:=false;
 BEGIN PERFORM public.bn_p5_export_access(exportid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Pending export should not be downloadable';END IF;
 denied:=false;
 BEGIN PERFORM public.bn_p5_export_start(aid,'zip');
 EXCEPTION WHEN raise_exception THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'A second simultaneous build was allowed';END IF;

 PERFORM set_config('role','service_role',true);
 response:=public.bn_p5_export_finish(exportid,true,610,repeat('a',64),NULL);
 IF response->>'status'<>'READY' THEN RAISE EXCEPTION 'Service finalization failed';END IF;
 PERFORM set_config('role','postgres',true);
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 response:=public.bn_p5_export_access(exportid);
 IF response->>'sha256'<>repeat('a',64)
   OR response->>'format'<>'pdf'
 THEN RAISE EXCEPTION 'Staff cannot access private compiled output metadata';END IF;
 response:=public.bn_p5_export_history(aid);
 IF response->0->>'status'<>'READY' THEN RAISE EXCEPTION 'Completed history was not durable';END IF;

 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 denied:=false;
 BEGIN PERFORM public.bn_p5_export_access(exportid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Student could access staff export';END IF;
 denied:=false;
 BEGIN PERFORM public.bn_p5_export_history(aid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Student could browse private history';END IF;
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 response:=public.bn_p5_export_start(aid,'zip');
 secondid:=(response->>'id')::uuid;
 IF secondid IS NULL THEN RAISE EXCEPTION 'Cannot start a second build after completion';END IF;
 PERFORM set_config('role','service_role',true);
 PERFORM public.bn_p5_export_finish(secondid,false,NULL,NULL,'TEST_FAILURE');
 PERFORM set_config('role','postgres',true);
 IF NOT EXISTS(SELECT 1 FROM public."CompilationExport"
   WHERE id=secondid AND status='FAILED' AND error_code='TEST_FAILURE') THEN
  RAISE EXCEPTION 'Failed build history missing';END IF;
 RAISE NOTICE 'Phase 5 PASS: saved source versions, JWT role boundaries, single-flight, private download and durable successful/failed exports';
END $qa$;
ROLLBACK;
