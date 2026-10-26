-- Phase 5 follow-up: safe read-only group roster for ACTIVE Admin/Moderator.
-- Group mutation remains Admin-only via the existing audited Phase 3 RPC.
CREATE OR REPLACE FUNCTION bn_private.bn_p5_groups_read_impl(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $body$
DECLARE actor uuid:=(SELECT auth.uid());cid uuid;out jsonb;is_group boolean;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501';END IF;
 SELECT s.class_id,a.is_group INTO cid,is_group FROM public."Assignment" a
 JOIN public."Subject" s ON s.id=a.subject_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND s.deleted_at IS NULL;
 IF cid IS NULL OR NOT EXISTS (
  SELECT 1 FROM public."ClassMembership" cm WHERE cm.class_id=cid
   AND cm.user_id=actor AND cm.status='ACTIVE' AND cm.role IN ('Admin','Moderator')
 ) THEN RAISE EXCEPTION 'ACTIVE classroom staff access required' USING ERRCODE='42501';END IF;
 IF NOT is_group THEN RETURN '[]'::jsonb;END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',g.id,'name',g.name,
  'locked',EXISTS(SELECT 1 FROM public."Submission" sub
     WHERE sub.group_id=g.id AND sub.deleted_at IS NULL AND sub.status<>'DELETED'),
  'members',(
   SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',gm.user_id,
      'name',u.full_name) ORDER BY u.full_name,gm.user_id),'[]'::jsonb)
   FROM public."GroupMembership" gm JOIN public."User" u ON u.id=gm.user_id
   WHERE gm.group_id=g.id AND gm.removed_at IS NULL)
 ) ORDER BY g.name,g.id),'[]'::jsonb)
 INTO out FROM public."Group" g
 WHERE g.assignment_id=p_assignment AND g.deleted_at IS NULL;
 RETURN coalesce(out,'[]'::jsonb);
END
$body$;

CREATE OR REPLACE FUNCTION public.bn_p5_groups_read(p_assignment uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $body$ SELECT bn_private.bn_p5_groups_read_impl(p_assignment) $body$;
REVOKE ALL ON FUNCTION bn_private.bn_p5_groups_read_impl(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p5_groups_read(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p5_groups_read_impl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p5_groups_read(uuid) TO authenticated;
