-- Phase 5 milestone 1: assignment groups and staff compilation manifest.
-- No direct browser grants to Group, GroupMembership, Compilation or File.
-- Compilation table remains deny-by-default until an actual generated, privately
-- stored artifact exists. JSON manifest is an on-demand verified read model.
--
-- Existing Phase 3 groups RPC provides create/roster/add/remove; we preserve it.
-- Once a group submission exists, freeze group membership, including drafts,
-- so a membership change cannot silently alter access to private version files.
CREATE OR REPLACE FUNCTION bn_private.bn_p5_freeze_submitted_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
DECLARE v_group uuid;
BEGIN
  v_group:=CASE WHEN TG_OP='DELETE' THEN OLD.group_id ELSE NEW.group_id END;
  IF EXISTS (
    SELECT 1 FROM public."Submission" sub
    WHERE sub.group_id=v_group AND sub.deleted_at IS NULL
      AND sub.status<>'DELETED'
  ) THEN
    RAISE EXCEPTION 'Group membership is locked after a submission draft exists'
      USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION bn_private.bn_p5_freeze_submitted_group() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS bn_p5_group_membership_freeze ON public."GroupMembership";
CREATE TRIGGER bn_p5_group_membership_freeze
 BEFORE INSERT OR UPDATE OF group_id,user_id,removed_at OR DELETE
 ON public."GroupMembership" FOR EACH ROW
 EXECUTE FUNCTION bn_private.bn_p5_freeze_submitted_group();

CREATE OR REPLACE FUNCTION bn_private.bn_p5_compilation_impl(
  p_assignment uuid, p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $body$
DECLARE
 actor uuid:=(SELECT auth.uid());
 cid uuid; a_name text; a_group boolean; result jsonb; files_json jsonb;
BEGIN
 IF actor IS NULL THEN
  RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501';
 END IF;
 SELECT s.class_id,a.name,a.is_group INTO cid,a_name,a_group
 FROM public."Assignment" a JOIN public."Subject" s ON s.id=a.subject_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND s.deleted_at IS NULL;
 IF cid IS NULL OR NOT EXISTS (
  SELECT 1 FROM public."ClassMembership" m
  WHERE m.class_id=cid AND m.user_id=actor AND m.status='ACTIVE'
   AND m.role IN ('Admin','Moderator')
 ) THEN
  RAISE EXCEPTION 'ACTIVE classroom staff access required' USING ERRCODE='42501';
 END IF;

 -- Never expose storage keys here. Staff can download the original artifacts
 -- only using existing Phase 3 guarded details/private Storage operations.
 SELECT coalesce(jsonb_agg(
  jsonb_build_object(
   'submission_id',sub.id,
   'group_id',sub.group_id,'group_name',g.name,
   'student_id',sub.student_id,'student_name',u.full_name,
   'version_id',v.id,'version',v.version_number,
   'submitted_at',v.submitted_at,
   'deadline_at_submission',v.deadline_at_submission,
   'late',coalesce(v.deadline_at_submission IS NOT NULL
     AND v.submitted_at>v.deadline_at_submission,false),
   'files',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
       'file_id',f.id,'name',f.original_filename,'mime',f.mime_type,
       'size',f.size_bytes) ORDER BY f.original_filename,f.id)
      FROM public."File" f WHERE f.version_id=v.id
       AND f.upload_state='READY' AND f.deleted_at IS NULL
    ),'[]'::jsonb)
  ) ORDER BY coalesce(g.name,u.full_name), sub.id),'[]'::jsonb)
 INTO result
 FROM public."Submission" sub
 JOIN LATERAL (
   SELECT vv.id,vv.version_number,vv.submitted_at,vv.deadline_at_submission
   FROM public."SubmissionVersion" vv
   WHERE vv.submission_id=sub.id AND vv.upload_state='READY'
     AND vv.submitted_at IS NOT NULL
   ORDER BY vv.version_number DESC LIMIT 1
 ) v ON true
 LEFT JOIN public."Group" g ON g.id=sub.group_id
 LEFT JOIN public."User" u ON u.id=sub.student_id
 WHERE sub.assignment_id=p_assignment
  AND sub.deleted_at IS NULL AND sub.status='SUBMITTED';

 IF p_export THEN
  INSERT INTO public."AuditLog"(
   actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
  SELECT actor,m.role,cid,'COMPILATION_MANIFEST_EXPORTED','Assignment',p_assignment,
   jsonb_build_object('entries',jsonb_array_length(result))
  FROM public."ClassMembership" m
  WHERE m.user_id=actor AND m.class_id=cid AND m.status='ACTIVE'
   AND m.role IN ('Admin','Moderator')
  LIMIT 1;
 END IF;

 RETURN jsonb_build_object(
  'assignment_id',p_assignment,'assignment_name',a_name,'is_group',a_group,
  'generated_at',now(),'entries',result,'count',jsonb_array_length(result),
  'format','metadata-only','contains_private_file_urls',false
 );
END
$body$;

CREATE OR REPLACE FUNCTION public.bn_p5_compilation(
  p_assignment uuid,p_export boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $body$
 SELECT bn_private.bn_p5_compilation_impl(p_assignment,p_export)
$body$;

REVOKE ALL ON FUNCTION bn_private.bn_p5_compilation_impl(uuid,boolean)
 FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p5_compilation(uuid,boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p5_compilation_impl(uuid,boolean)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p5_compilation(uuid,boolean)
 TO authenticated;

-- Protect original deny-by-default placeholders from direct Data API access.
REVOKE ALL ON TABLE public."Compilation",public."Group",public."GroupMembership"
 FROM anon,authenticated;
CREATE INDEX IF NOT EXISTS bn_p5_group_assignment
 ON public."Group"(assignment_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bn_p5_member_active_by_group
 ON public."GroupMembership"(group_id,user_id) WHERE removed_at IS NULL;
