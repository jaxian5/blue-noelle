-- Blue Noelle account settings: run this test on a trusted SQL connection.
-- It intentionally uses authenticated roles with synthetic JWT identity.
-- ALL fixture changes are rolled back. This does not upload real Storage bytes.
BEGIN;
DO $qa$
DECLARE
 v_owner uuid;v_other uuid;v_name text;v_key text;v_rows integer;
BEGIN
 SELECT id,full_name INTO v_owner,v_name FROM public."User" ORDER BY created_at LIMIT 1;
 SELECT id INTO v_other FROM public."User" WHERE id<>v_owner ORDER BY created_at LIMIT 1;
 IF v_owner IS NULL OR v_other IS NULL THEN
  RAISE EXCEPTION 'Needs two existing auth profiles';END IF;
 IF (SELECT public FROM storage.buckets WHERE id='bn-avatars') IS DISTINCT FROM false
 OR (SELECT file_size_limit FROM storage.buckets WHERE id='bn-avatars')<>2097152
 THEN RAISE EXCEPTION 'Avatar bucket not securely configured';END IF;
 v_key:=v_owner::text||'/avatar';
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 PERFORM set_config('role','authenticated',true);
 UPDATE public."User" SET full_name=v_name WHERE id=v_owner;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 THEN RAISE EXCEPTION 'Self profile name update blocked';END IF;
 BEGIN
  UPDATE public."User" SET account_type='Admin' WHERE id=v_owner;
  RAISE EXCEPTION 'Account type privilege escalation permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 INSERT INTO storage.objects(bucket_id,name,metadata)
 VALUES('bn-avatars',v_key,'{"size":123,"mimetype":"image/png"}'::jsonb);
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='bn-avatars' AND name=v_key)
 THEN RAISE EXCEPTION 'Owner avatar metadata not readable';END IF;
 PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='bn-avatars' AND name=v_key)
 THEN RAISE EXCEPTION 'Other account can read owner avatar';END IF;
 UPDATE storage.objects SET name=v_other::text||'/avatar'
 WHERE bucket_id='bn-avatars' AND name=v_key;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>0 THEN RAISE EXCEPTION 'Other account can overwrite owner avatar';END IF;
 UPDATE public."User" SET full_name='Unauthorized change' WHERE id=v_owner;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>0 THEN RAISE EXCEPTION 'Other account can edit owner profile';END IF;
 RAISE NOTICE 'PASS: self-name, role privilege separation, private avatar owner-only RLS';
END $qa$;
ROLLBACK;