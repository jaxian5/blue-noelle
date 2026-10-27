-- Phase 6 hardening: atomic per-author posting limit, post audit, and
-- (timestamp, UUID) keyset pagination to avoid equal-timestamp omissions.
CREATE OR REPLACE FUNCTION bn_private.bn_p6_chat_mutate_impl(
 p_class uuid,p_action text,p_body text DEFAULT NULL,p_message uuid DEFAULT NULL,
 p_parent uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid());v_role text;v_message public."ChatMessage"%ROWTYPE;
 trimmed text;v_id uuid;recipient uuid;
BEGIN
 v_role:=bn_private.bn_p6_staff_or_student(p_class);
 IF v_role IS NULL THEN RAISE EXCEPTION 'ACTIVE class membership required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('post','edit','delete') THEN
  RAISE EXCEPTION 'Unsupported discussion operation';END IF;
 IF p_action IN ('post','edit') THEN
  trimmed:=btrim(coalesce(p_body,''));
  IF char_length(trimmed)<1 OR char_length(trimmed)>2000 THEN
   RAISE EXCEPTION 'Message must contain 1 to 2000 characters';END IF;
 END IF;
 IF p_action='post' THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 606));
  IF (SELECT count(*) FROM public."ChatMessage" c
   WHERE c.author_id=actor AND c.created_at>now()-interval '1 minute')>=8
   THEN RAISE EXCEPTION 'Message limit reached; try again in a minute';END IF;
  IF p_parent IS NOT NULL THEN
   SELECT c.author_id INTO recipient FROM public."ChatMessage" c
   WHERE c.id=p_parent AND c.class_id=p_class AND c.deleted_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Reply target is unavailable in this class';END IF;
  END IF;
  INSERT INTO public."ChatMessage"(class_id,author_id,body,parent_id)
   VALUES(p_class,actor,trimmed,p_parent) RETURNING id INTO v_id;
  INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
  VALUES(actor,v_role,p_class,'CHAT_POSTED','ChatMessage',v_id,jsonb_build_object('reply',p_parent IS NOT NULL));
  -- Notify only the parent author, not every classroom member on every post.
  IF recipient IS NOT NULL AND recipient<>actor
   AND EXISTS(SELECT 1 FROM public."ClassMembership" m
     WHERE m.class_id=p_class AND m.user_id=recipient AND m.status='ACTIVE')
  THEN
   INSERT INTO public."Notification"(user_id,class_id,type,payload)
   VALUES(recipient,p_class,'CHAT_REPLY',
     jsonb_build_object('chat_id',v_id,'parent_id',p_parent));
  END IF;
  RETURN jsonb_build_object('id',v_id,'action','posted');
 END IF;
 IF p_message IS NULL THEN RAISE EXCEPTION 'Choose a discussion message';END IF;
 SELECT * INTO v_message FROM public."ChatMessage"
 WHERE id=p_message AND class_id=p_class AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Message is unavailable';END IF;
 IF p_action='edit' THEN
  IF v_message.author_id<>actor OR v_message.created_at<now()-interval '15 minutes' THEN
   RAISE EXCEPTION 'Only the author may edit within 15 minutes' USING ERRCODE='42501';
  END IF;
  UPDATE public."ChatMessage" SET body=trimmed,edited_at=now() WHERE id=p_message;
 ELSE
  IF v_message.author_id<>actor AND v_role NOT IN ('Admin','Moderator') THEN
    RAISE EXCEPTION 'Only the author or classroom staff may remove a message' USING ERRCODE='42501';
  END IF;
  UPDATE public."ChatMessage" SET deleted_at=now(),deleted_by=actor WHERE id=p_message;
 END IF;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,v_role,p_class,CASE WHEN p_action='edit' THEN 'CHAT_EDITED' ELSE 'CHAT_REMOVED' END,
   'ChatMessage',p_message,jsonb_build_object('self',v_message.author_id=actor));
 RETURN jsonb_build_object('id',p_message,'action',p_action);
END
$fn$;


CREATE OR REPLACE FUNCTION bn_private.bn_p6_chat_page_impl(
 p_class uuid,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,
 p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE rows jsonb;
BEGIN
 IF bn_private.bn_p6_staff_or_student(p_class) IS NULL
 THEN RAISE EXCEPTION 'ACTIVE class membership required' USING ERRCODE='42501';END IF;
 IF (p_before IS NULL) <> (p_before_id IS NULL)
 THEN RAISE EXCEPTION 'Pagination requires both timestamp and message ID';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',t.id,'author_id',t.author_id,'author_name',t.full_name,
  'body',t.body,'parent_id',t.parent_id,'created_at',t.created_at,
  'edited_at',t.edited_at) ORDER BY t.created_at,t.id),'[]'::jsonb) INTO rows
 FROM (
 SELECT c.id,c.author_id,u.full_name,c.body,c.parent_id,c.created_at,c.edited_at
 FROM public."ChatMessage" c JOIN public."User" u ON u.id=c.author_id
 WHERE c.class_id=p_class AND c.deleted_at IS NULL
 AND (p_before IS NULL OR (c.created_at,c.id)<(p_before,p_before_id))
 ORDER BY c.created_at DESC,c.id DESC LIMIT greatest(1,least(coalesce(p_limit,60),100))
 ) t;
 RETURN rows;
END
$fn$;

CREATE OR REPLACE FUNCTION public.bn_p6_chat_page(
 p_class uuid,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,
 p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$SELECT bn_private.bn_p6_chat_page_impl(p_class,p_before,p_before_id,p_limit)$$;
REVOKE ALL ON FUNCTION bn_private.bn_p6_chat_page_impl(uuid,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p6_chat_page_impl(uuid,timestamptz,uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p6_chat_page(uuid,timestamptz,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p6_chat_page(uuid,timestamptz,uuid,integer) TO authenticated;

-- Phase 7: convenient inbox bulk-read limited to *your own* class notifications.
CREATE OR REPLACE FUNCTION bn_private.bn_p7_notifications_read_all_impl(p_class uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE changed int;
BEGIN
 IF bn_private.bn_p6_staff_or_student(p_class) IS NULL
 THEN RAISE EXCEPTION 'ACTIVE class membership required' USING ERRCODE='42501';END IF;
 UPDATE public."Notification" SET read_at=now()
 WHERE user_id=(SELECT auth.uid()) AND class_id=p_class AND read_at IS NULL;
 GET DIAGNOSTICS changed=ROW_COUNT;
 RETURN jsonb_build_object('marked_read',changed);
END
$fn$;
CREATE OR REPLACE FUNCTION public.bn_p7_notifications_read_all(p_class uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$SELECT bn_private.bn_p7_notifications_read_all_impl(p_class)$$;
REVOKE ALL ON FUNCTION bn_private.bn_p7_notifications_read_all_impl(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p7_notifications_read_all_impl(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p7_notifications_read_all(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p7_notifications_read_all(uuid) TO authenticated;
