-- Phase 5 Milestones 5.4/5.5: privately generated staff compilations and durable provenance.
-- Generated output is never put in the Phase 3 submission bucket or File table.
CREATE TABLE IF NOT EXISTS public."CompilationExport" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 class_id uuid NOT NULL REFERENCES public."Class"(id),
 assignment_id uuid NOT NULL REFERENCES public."Assignment"(id),
 requested_by uuid NOT NULL REFERENCES public."User"(id),
 format text NOT NULL CHECK (format IN ('pdf','zip')),
 status text NOT NULL DEFAULT 'BUILDING' CHECK (status IN ('BUILDING','READY','FAILED')),
 storage_key text NOT NULL UNIQUE,
 filename text NOT NULL,
 size_bytes bigint CHECK (size_bytes > 0 AND size_bytes <= 25165824),
 sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 source_count integer NOT NULL DEFAULT 0 CHECK (source_count >= 0 AND source_count <= 48),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 error_code text,
 CONSTRAINT bn_export_consistent_status CHECK (
  (status='READY' AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND completed_at IS NOT NULL)
   OR (status<>'READY' AND size_bytes IS NULL AND sha256 IS NULL)
 )
);
CREATE INDEX IF NOT EXISTS bn_compilation_export_by_assignment
 ON public."CompilationExport"(assignment_id,created_at DESC);
ALTER TABLE public."CompilationExport" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."CompilationExport" FROM PUBLIC,anon,authenticated;

ALTER TABLE public."Compilation"
 ADD COLUMN IF NOT EXISTS export_id uuid REFERENCES public."CompilationExport"(id);
CREATE UNIQUE INDEX IF NOT EXISTS bn_compilation_one_source_per_export
 ON public."Compilation"(export_id,submission_id) WHERE export_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bn_compilation_provenance_by_export
 ON public."Compilation"(export_id) WHERE export_id IS NOT NULL;
REVOKE ALL ON public."Compilation" FROM PUBLIC,anon,authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('bn-compilations','bn-compilations',false,25165824,
  ARRAY['application/pdf','application/zip']::text[])
 ON CONFLICT(id) DO UPDATE SET public=false,
  file_size_limit=25165824,allowed_mime_types=EXCLUDED.allowed_mime_types;
-- No INSERT, SELECT, UPDATE or DELETE policy for bn-compilations.
-- Only the server-side Edge Function with the managed service-role secret can
-- access those objects, after checking a separate ACTIVE staff-scoped RPC.

CREATE OR REPLACE FUNCTION bn_private.bn_p5_export_staff(p_assignment uuid)
 RETURNS TABLE(class_id uuid,role text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT s.class_id,m.role FROM public."Assignment" a
 JOIN public."Subject" s ON s.id=a.subject_id
 JOIN public."ClassMembership" m ON m.class_id=s.class_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND s.deleted_at IS NULL
 AND m.user_id=(SELECT auth.uid()) AND m.status='ACTIVE'
 AND m.role IN ('Admin','Moderator') LIMIT 1
$$;
REVOKE ALL ON FUNCTION bn_private.bn_p5_export_staff(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p5_export_staff(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION bn_private.bn_p5_export_start_impl(p_assignment uuid,p_format text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 actor uuid:=(SELECT auth.uid()); cid uuid; staffrole text;
 eid uuid; epath text; ename text; sources jsonb:='[]'::jsonb;
 fitems jsonb; r record; fileCount int:=0; byteCount bigint:=0; subCount int:=0;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF p_format IS NULL OR p_format NOT IN ('pdf','zip') THEN
  RAISE EXCEPTION 'Choose PDF or ZIP'; END IF;
 SELECT s.class_id,s.role INTO cid,staffrole FROM bn_private.bn_p5_export_staff(p_assignment) s;
 IF cid IS NULL THEN RAISE EXCEPTION 'ACTIVE classroom staff required' USING ERRCODE='42501';END IF;
 -- Lock the assignment across concurrent requests, preventing duplicate builds.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_assignment::text,441));
 UPDATE public."CompilationExport"
 SET status='FAILED',completed_at=now(),error_code='EXPIRED'
 WHERE assignment_id=p_assignment AND status='BUILDING'
   AND created_at<now()-interval '10 minutes';
 IF EXISTS(SELECT 1 FROM public."CompilationExport"
    WHERE assignment_id=p_assignment AND status='BUILDING') THEN
  RAISE EXCEPTION 'A compilation is already running for this assignment';
 END IF;
 IF (SELECT count(*) FROM public."CompilationExport"
   WHERE assignment_id=p_assignment AND created_at>now()-interval '1 hour')>=8 THEN
  RAISE EXCEPTION 'Compilation limit reached: try again later';
 END IF;
 FOR r IN
   SELECT sub.id AS submission_id,v.id AS version_id,v.version_number,
    coalesce(g.name,u.full_name,'Submission') AS owner_name
   FROM public."Submission" sub
   JOIN LATERAL (
    SELECT sv.id,sv.version_number FROM public."SubmissionVersion" sv
    WHERE sv.submission_id=sub.id AND sv.upload_state='READY' AND sv.submitted_at IS NOT NULL
    ORDER BY sv.version_number DESC LIMIT 1
   ) v ON true
   LEFT JOIN public."Group" g ON g.id=sub.group_id
   LEFT JOIN public."User" u ON u.id=sub.student_id
   WHERE sub.assignment_id=p_assignment AND sub.deleted_at IS NULL
     AND sub.status<>'DELETED'
   ORDER BY coalesce(g.name,u.full_name),sub.id
 LOOP
   SELECT coalesce(jsonb_agg(jsonb_build_object(
      'key',f.storage_key,'name',f.original_filename,
      'mime',f.mime_type,'size',f.size_bytes,'sha256',f.sha256,
      'owner',r.owner_name,'version',r.version_number,
      'file_id',f.id) ORDER BY f.original_filename,f.id),'[]'::jsonb)
   INTO fitems FROM public."File" f
   WHERE f.version_id=r.version_id AND f.upload_state='READY'
    AND f.deleted_at IS NULL;
   IF jsonb_array_length(fitems)=0 THEN CONTINUE;END IF;
   subCount:=subCount+1;
   SELECT fileCount+count(*),byteCount+coalesce(sum((x->>'size')::bigint),0)
    INTO fileCount,byteCount FROM jsonb_array_elements(fitems) x;
   IF fileCount>48 OR byteCount>20971520 THEN
    RAISE EXCEPTION 'Compilation exceeds 48 files or 20 MiB of sources';END IF;
   IF p_format='pdf' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(fitems) x
      WHERE x->>'mime'<>'application/pdf'
   ) THEN
    RAISE EXCEPTION 'PDF compilations require only PDF files; choose ZIP for mixed file types';
   END IF;
   sources:=sources||fitems;
 END LOOP;
 IF fileCount=0 THEN RAISE EXCEPTION 'No completed submissions with READY files to compile';END IF;
 INSERT INTO public."CompilationExport"(class_id,assignment_id,requested_by,format,
   storage_key,filename,source_count)
 VALUES(cid,p_assignment,actor,p_format,'pending',
   'blue-noelle-'||left(p_assignment::text,8)||'-'||gen_random_uuid()::text||'.'||p_format,fileCount)
 RETURNING id INTO eid;
 epath:=cid::text||'/'||p_assignment::text||'/'||eid::text||'.'||p_format;
 UPDATE public."CompilationExport" SET storage_key=epath WHERE id=eid;
 INSERT INTO public."Compilation"(submission_id,source_version_id,export_id,generated_by)
 SELECT sub.id,sv.id,eid,actor FROM public."Submission" sub
 JOIN LATERAL (
   SELECT v.id FROM public."SubmissionVersion" v
    WHERE v.submission_id=sub.id AND v.upload_state='READY'
      AND v.submitted_at IS NOT NULL ORDER BY v.version_number DESC LIMIT 1
 ) sv ON true
 WHERE sub.assignment_id=p_assignment AND sub.deleted_at IS NULL AND sub.status<>'DELETED'
 AND EXISTS(SELECT 1 FROM public."File" f WHERE f.version_id=sv.id
     AND f.upload_state='READY' AND f.deleted_at IS NULL);
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,staffrole,cid,'COMPILATION_BUILD_STARTED','CompilationExport',eid,
  jsonb_build_object('format',p_format,'files',fileCount,'sources_bytes',byteCount));
 RETURN jsonb_build_object('id',eid,'format',p_format,'key',epath,
   'files',sources,'file_count',fileCount,'source_bytes',byteCount);
END
$fn$;

CREATE OR REPLACE FUNCTION public.bn_p5_export_start(p_assignment uuid,p_format text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT bn_private.bn_p5_export_start_impl(p_assignment,p_format) $$;
REVOKE ALL ON FUNCTION bn_private.bn_p5_export_start_impl(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p5_export_start_impl(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p5_export_start(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p5_export_start(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION bn_private.bn_p5_export_history_impl(p_assignment uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE cid uuid; out jsonb;
BEGIN
 SELECT s.class_id INTO cid FROM bn_private.bn_p5_export_staff(p_assignment) s;
 IF cid IS NULL THEN RAISE EXCEPTION 'ACTIVE classroom staff required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',t.id,'format',t.format,'status',t.status,
  'filename',t.filename,'size',t.size_bytes,'sha256',t.sha256,
  'created_at',t.created_at,'completed_at',t.completed_at,
  'source_count',t.source_count,'error_code',t.error_code,
  'created_by',t.requested_by)
  ORDER BY t.created_at DESC),'[]'::jsonb) INTO out
 FROM (
  SELECT * FROM public."CompilationExport"
  WHERE assignment_id=p_assignment AND class_id=cid
  ORDER BY created_at DESC LIMIT 40
 ) t;
 RETURN out;
END
$fn$;

CREATE OR REPLACE FUNCTION public.bn_p5_export_history(p_assignment uuid)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT bn_private.bn_p5_export_history_impl(p_assignment) $$;
REVOKE ALL ON FUNCTION bn_private.bn_p5_export_history_impl(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p5_export_history_impl(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p5_export_history(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p5_export_history(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION bn_private.bn_p5_export_access_impl(p_export uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE e public."CompilationExport"%ROWTYPE; role text;
BEGIN
 SELECT * INTO e FROM public."CompilationExport" WHERE id=p_export;
 IF NOT FOUND OR e.status<>'READY' OR NOT EXISTS(
  SELECT 1 FROM bn_private.bn_p5_export_staff(e.assignment_id) s
  WHERE s.class_id=e.class_id
 ) THEN RAISE EXCEPTION 'Compilation not found or access denied' USING ERRCODE='42501';END IF;
 SELECT s.role INTO role FROM bn_private.bn_p5_export_staff(e.assignment_id) s;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES((SELECT auth.uid()),role,e.class_id,'COMPILATION_DOWNLOAD_REQUESTED','CompilationExport',e.id,
  jsonb_build_object('format',e.format,'bytes',e.size_bytes));
 RETURN jsonb_build_object('id',e.id,'key',e.storage_key,'name',e.filename,
  'format',e.format,'size',e.size_bytes,'sha256',e.sha256);
END
$fn$;
CREATE OR REPLACE FUNCTION public.bn_p5_export_access(p_export uuid)
 RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT bn_private.bn_p5_export_access_impl(p_export) $$;
REVOKE ALL ON FUNCTION bn_private.bn_p5_export_access_impl(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p5_export_access_impl(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p5_export_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p5_export_access(uuid) TO authenticated;

-- Only the managed service-role identity used by the Edge Function may
-- attest that a privately uploaded object has finished and store its digest.
CREATE OR REPLACE FUNCTION public.bn_p5_export_finish(
 p_export uuid,p_success boolean,p_bytes bigint DEFAULT NULL,p_sha256 text DEFAULT NULL,
 p_error text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE e public."CompilationExport"%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public."CompilationExport" WHERE id=p_export FOR UPDATE;
 IF NOT FOUND OR e.status<>'BUILDING' THEN
  RAISE EXCEPTION 'Compilation is not pending';END IF;
 IF p_success THEN
  IF p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 25165824
   OR p_sha256 IS NULL OR p_sha256 !~ '^[a-f0-9]{64}$' THEN
   RAISE EXCEPTION 'Invalid verified compilation size or SHA-256';END IF;
 END IF;
 UPDATE public."CompilationExport"
 SET status=CASE WHEN p_success THEN 'READY' ELSE 'FAILED' END,
 size_bytes=CASE WHEN p_success THEN p_bytes ELSE NULL END,
 sha256=CASE WHEN p_success THEN p_sha256 ELSE NULL END,
 completed_at=now(),
 error_code=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'GENERATION_FAILED'),60) END
 WHERE id=p_export;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(e.requested_by,'System',e.class_id,
  CASE WHEN p_success THEN 'COMPILATION_BUILD_READY' ELSE 'COMPILATION_BUILD_FAILED' END,
  'CompilationExport',e.id,jsonb_build_object('format',e.format,'bytes',p_bytes));
 RETURN jsonb_build_object('id',e.id,'status',CASE WHEN p_success THEN 'READY' ELSE 'FAILED' END);
END
$fn$;
REVOKE ALL ON FUNCTION public.bn_p5_export_finish(uuid,boolean,bigint,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p5_export_finish(uuid,boolean,bigint,text,text)
 TO service_role;
