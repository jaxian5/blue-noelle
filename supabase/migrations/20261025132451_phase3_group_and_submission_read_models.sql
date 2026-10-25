-- Phase 3: secure read models and Admin-scoped assignment groups.
CREATE OR REPLACE FUNCTION bn_private.bn_p3_details_impl(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=auth.uid(); cid uuid; staff boolean; stud boolean; result jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT s.class_id INTO cid
 FROM public."Assignment" a JOIN public."Subject" s ON s.id=a.subject_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND s.deleted_at IS NULL;
 IF cid IS NULL THEN RAISE EXCEPTION 'Assignment not found' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE user_id=actor AND class_id=cid
    AND role IN('Admin','Moderator') AND status='ACTIVE') INTO staff;
 SELECT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE user_id=actor AND class_id=cid
    AND role='Student' AND status='ACTIVE') INTO stud;
 IF NOT staff AND NOT stud THEN RAISE EXCEPTION 'No access to this classroom' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(entry ORDER BY entry->>'created_at'), '[]'::jsonb) INTO result
 FROM (
   SELECT jsonb_build_object(
    'id',sub.id,'assignment_id',sub.assignment_id,
    'student_id',sub.student_id,'group_id',sub.group_id,
    'student_name',(SELECT u.full_name FROM public."User" u WHERE u.id=sub.student_id),
    'group_name',(SELECT g.name FROM public."Group" g WHERE g.id=sub.group_id),
    'status',sub.status,'current_version_id',sub.current_version_id,
    'created_at',sub.created_at,'submitted_at',sub.submitted_at,
    'deadline_at_submission',sub.deadline_at_submission,
    'versions',(
      SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'number',v.version_number,
       'state',v.upload_state,'created_at',v.created_at,'uploaded_by',v.uploaded_by,
       'files',(
         SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,
          'name',f.original_filename,'size',f.size_bytes,'mime',f.mime_type,
          'state',f.upload_state,'key',CASE WHEN f.upload_state='READY' THEN f.storage_key ELSE NULL END,
          'created_at',f.created_at) ORDER BY f.created_at),'[]'::jsonb)
         FROM public."File" f WHERE f.version_id=v.id AND f.deleted_at IS NULL
       )) ORDER BY v.version_number DESC),'[]'::jsonb)
      FROM public."SubmissionVersion" v
      WHERE v.submission_id=sub.id
    )
   ) AS entry
   FROM public."Submission" sub
   WHERE sub.assignment_id=p_assignment AND sub.deleted_at IS NULL AND sub.status<>'DELETED'
    AND (staff OR (stud AND (sub.student_id=actor OR EXISTS (
      SELECT 1 FROM public."GroupMembership" gm
      WHERE gm.group_id=sub.group_id AND gm.user_id=actor AND gm.removed_at IS NULL
    ))))
 ) v;
 RETURN coalesce(result,'[]'::jsonb);
END $fn$;

CREATE OR REPLACE FUNCTION bn_private.bn_p3_groups_impl(p_assignment uuid,p_action text DEFAULT 'list',
  p_group uuid DEFAULT NULL,p_member uuid DEFAULT NULL,p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=auth.uid(); cid uuid; g public."Group"%ROWTYPE; out jsonb; is_group boolean;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT s.class_id,a.is_group INTO cid,is_group
 FROM public."Assignment" a JOIN public."Subject" s ON s.id=a.subject_id
 WHERE a.id=p_assignment AND a.deleted_at IS NULL AND s.deleted_at IS NULL;
 IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE class_id=cid
  AND user_id=actor AND role='Admin' AND status='ACTIVE') THEN
  RAISE EXCEPTION 'ACTIVE Admin required' USING ERRCODE='42501';
 END IF;
 IF NOT is_group THEN RAISE EXCEPTION 'This is not a group assignment'; END IF;
 IF p_action='create' THEN
  IF length(btrim(coalesce(p_name,'')))<2 OR length(btrim(p_name))>120 THEN RAISE EXCEPTION 'Invalid group name'; END IF;
  INSERT INTO public."Group"(assignment_id,name) VALUES(p_assignment,btrim(p_name)) RETURNING * INTO g;
  INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
  VALUES(actor,'Admin',cid,'SUBMISSION_GROUP_CREATED','Group',g.id,jsonb_build_object('name',g.name));
 ELSIF p_action IN ('add_member','remove_member') THEN
  SELECT * INTO g FROM public."Group" WHERE id=p_group AND assignment_id=p_assignment AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group does not belong to assignment' USING ERRCODE='42501'; END IF;
  IF p_member IS NULL THEN RAISE EXCEPTION 'Choose a Student'; END IF;
  IF p_action='add_member' THEN
   IF NOT EXISTS(SELECT 1 FROM public."ClassMembership" WHERE user_id=p_member AND class_id=cid AND status='ACTIVE' AND role='Student') THEN
    RAISE EXCEPTION 'Member must be an ACTIVE Student of this class' USING ERRCODE='42501';
   END IF;
   IF EXISTS(SELECT 1 FROM public."GroupMembership" gm JOIN public."Group" gg ON gg.id=gm.group_id
    WHERE gm.user_id=p_member AND gg.assignment_id=p_assignment AND gm.removed_at IS NULL) THEN
    RAISE EXCEPTION 'Student already belongs to a group for this assignment';
   END IF;
   INSERT INTO public."GroupMembership"(group_id,user_id) VALUES(g.id,p_member);
  ELSE
   UPDATE public."GroupMembership" SET removed_at=now()
   WHERE group_id=g.id AND user_id=p_member AND removed_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Active group member not found'; END IF;
  END IF;
  INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
  VALUES(actor,'Admin',cid,'SUBMISSION_GROUP_MEMBER_'||upper(p_action),'Group',g.id,jsonb_build_object('member',p_member));
 ELSIF p_action <> 'list' THEN
   RAISE EXCEPTION 'Unsupported group action';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',gg.id,'name',gg.name,
  'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',gm.user_id,
      'name',u.full_name) ORDER BY u.full_name),'[]'::jsonb)
      FROM public."GroupMembership" gm JOIN public."User" u ON u.id=gm.user_id
      WHERE gm.group_id=gg.id AND gm.removed_at IS NULL))
  ORDER BY gg.name),'[]'::jsonb) INTO out
 FROM public."Group" gg WHERE gg.assignment_id=p_assignment AND gg.deleted_at IS NULL;
 RETURN coalesce(out,'[]'::jsonb);
END $fn$;

CREATE OR REPLACE FUNCTION bn_private.bn_p3_my_group_impl(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=auth.uid(); cid uuid; out jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT s.class_id INTO cid FROM public."Assignment" a JOIN public."Subject" s
 ON s.id=a.subject_id WHERE a.id=p_assignment AND a.is_group AND a.deleted_at IS NULL AND s.deleted_at IS NULL;
 IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM public."ClassMembership"
  WHERE user_id=actor AND class_id=cid AND role='Student' AND status='ACTIVE') THEN
  RAISE EXCEPTION 'Group assignment membership required' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('id',g.id,'name',g.name) INTO out
 FROM public."Group" g JOIN public."GroupMembership" gm ON gm.group_id=g.id
 WHERE g.assignment_id=p_assignment AND g.deleted_at IS NULL
 AND gm.user_id=actor AND gm.removed_at IS NULL LIMIT 1;
 RETURN coalesce(out,'null'::jsonb);
END $fn$;

CREATE OR REPLACE FUNCTION public.bn_p3_details(p_assignment uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $fn$ SELECT bn_private.bn_p3_details_impl(p_assignment) $fn$;
CREATE OR REPLACE FUNCTION public.bn_p3_groups(p_assignment uuid,p_action text DEFAULT 'list',
p_group uuid DEFAULT NULL,p_member uuid DEFAULT NULL,p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $fn$ SELECT bn_private.bn_p3_groups_impl(p_assignment,p_action,p_group,p_member,p_name) $fn$;
CREATE OR REPLACE FUNCTION public.bn_p3_my_group(p_assignment uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $fn$ SELECT bn_private.bn_p3_my_group_impl(p_assignment) $fn$;

REVOKE ALL ON FUNCTION bn_private.bn_p3_details_impl(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION bn_private.bn_p3_groups_impl(uuid,text,uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION bn_private.bn_p3_my_group_impl(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p3_details(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p3_groups(uuid,text,uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.bn_p3_my_group(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_details_impl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_groups_impl(uuid,text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION bn_private.bn_p3_my_group_impl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p3_details(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p3_groups(uuid,text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bn_p3_my_group(uuid) TO authenticated;
