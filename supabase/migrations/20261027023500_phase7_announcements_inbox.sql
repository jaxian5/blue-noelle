-- Phase 7: class-scoped staff announcements and private in-app inbox.
-- Unsent/public push/email notifications remain out of scope.
ALTER TABLE public."Announcement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Announcement",public."Notification" FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS bn_p7_announcements_current
 ON public."Announcement"(class_id,pinned DESC,created_at DESC)
 WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bn_p7_notification_unread
 ON public."Notification"(user_id,class_id,created_at DESC) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION bn_private.bn_p7_announcements_list_impl(p_class uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v jsonb;
BEGIN
 IF bn_private.bn_p6_staff_or_student(p_class) IS NULL
 THEN RAISE EXCEPTION 'ACTIVE class membership required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'title',a.title,'message',a.message,'priority',a.priority,
  'pinned',a.pinned,'expires_at',a.expires_at,'created_at',a.created_at,
  'author_id',a.author_id,'author_name',u.full_name)
 ORDER BY a.pinned DESC,a.priority DESC,a.created_at DESC),'[]'::jsonb) INTO v
 FROM (SELECT * FROM public."Announcement" WHERE class_id=p_class AND deleted_at IS NULL
   AND (expires_at IS NULL OR expires_at>now())
   ORDER BY pinned DESC,priority DESC,created_at DESC LIMIT 80) a
 LEFT JOIN public."User" u ON u.id=a.author_id;
 RETURN v;
END
$fn$;
CREATE OR REPLACE FUNCTION public.bn_p7_announcements_list(p_class uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$SELECT bn_private.bn_p7_announcements_list_impl(p_class)$$;
REVOKE ALL ON FUNCTION bn_private.bn_p7_announcements_list_impl(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p7_announcements_list_impl(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p7_announcements_list(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p7_announcements_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION bn_private.bn_p7_announcements_mutate_impl(
 p_class uuid,p_action text,p_title text DEFAULT NULL,p_message text DEFAULT NULL,
 p_announcement uuid DEFAULT NULL,p_priority integer DEFAULT 0,
 p_pinned boolean DEFAULT false,p_expires timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE actor uuid:=(SELECT auth.uid());v_role text;v_id uuid;
 title_clean text;body_clean text;current_record public."Announcement"%ROWTYPE;
BEGIN
 v_role:=bn_private.bn_p6_staff_or_student(p_class);
 IF v_role NOT IN ('Admin','Moderator') OR v_role IS NULL
 THEN RAISE EXCEPTION 'ACTIVE classroom staff access required' USING ERRCODE='42501';END IF;
 IF p_action IS NULL OR p_action NOT IN ('create','edit','delete','pin') THEN
  RAISE EXCEPTION 'Unsupported announcement operation';END IF;
 IF p_action IN ('create','edit') THEN
  title_clean:=btrim(coalesce(p_title,''));body_clean:=btrim(coalesce(p_message,''));
  IF char_length(title_clean) NOT BETWEEN 3 AND 120 OR char_length(body_clean) NOT BETWEEN 1 AND 4000
  THEN RAISE EXCEPTION 'Title must be 3-120 and message 1-4000 characters';END IF;
  IF p_priority NOT BETWEEN 0 AND 2 THEN RAISE EXCEPTION 'Priority must be 0, 1, or 2';END IF;
  IF p_expires IS NOT NULL AND (p_expires<=now() OR p_expires>now()+interval '366 days')
  THEN RAISE EXCEPTION 'Expiry must be future-dated within one year';END IF;
 END IF;
 IF p_action='create' THEN
  IF (SELECT count(*) FROM public."Announcement"
    WHERE author_id=actor AND created_at>now()-interval '1 hour')>=15 THEN
   RAISE EXCEPTION 'Announcement posting limit reached';END IF;
  INSERT INTO public."Announcement"(class_id,author_id,title,message,priority,pinned,expires_at)
  VALUES(p_class,actor,title_clean,body_clean,p_priority,coalesce(p_pinned,false),p_expires)
  RETURNING id INTO v_id;
  -- Deliver private inbox records to ACTIVE class members only.
  INSERT INTO public."Notification"(user_id,class_id,type,payload)
  SELECT m.user_id,p_class,'ANNOUNCEMENT',
    jsonb_build_object('announcement_id',v_id,'title',title_clean,'priority',p_priority)
  FROM public."ClassMembership" m
  WHERE m.class_id=p_class AND m.status='ACTIVE' AND m.user_id<>actor;
 ELSE
  IF p_announcement IS NULL THEN RAISE EXCEPTION 'Select an announcement';END IF;
  SELECT * INTO current_record FROM public."Announcement"
  WHERE id=p_announcement AND class_id=p_class AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Announcement unavailable';END IF;
  v_id:=p_announcement;
  IF p_action='delete' THEN
   UPDATE public."Announcement" SET deleted_at=now(),deleted_by=actor WHERE id=v_id;
  ELSIF p_action='pin' THEN
   UPDATE public."Announcement" SET pinned=coalesce(p_pinned,false) WHERE id=v_id;
  ELSE
   UPDATE public."Announcement" SET title=title_clean,message=body_clean,
    priority=p_priority,pinned=coalesce(p_pinned,false),expires_at=p_expires WHERE id=v_id;
  END IF;
 END IF;
 INSERT INTO public."AuditLog"(actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES(actor,v_role,p_class,CASE p_action WHEN 'create' THEN 'ANNOUNCEMENT_CREATED'
  WHEN 'edit' THEN 'ANNOUNCEMENT_EDITED' WHEN 'delete' THEN 'ANNOUNCEMENT_REMOVED'
  ELSE 'ANNOUNCEMENT_PINNED' END,'Announcement',v_id,
  jsonb_build_object('priority',p_priority));
 RETURN jsonb_build_object('id',v_id,'action',p_action);
END
$fn$;
CREATE OR REPLACE FUNCTION public.bn_p7_announcements_mutate(
 p_class uuid,p_action text,p_title text DEFAULT NULL,p_message text DEFAULT NULL,
 p_announcement uuid DEFAULT NULL,p_priority integer DEFAULT 0,
 p_pinned boolean DEFAULT false,p_expires timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$SELECT bn_private.bn_p7_announcements_mutate_impl(p_class,p_action,p_title,
 p_message,p_announcement,p_priority,p_pinned,p_expires)$$;
REVOKE ALL ON FUNCTION bn_private.bn_p7_announcements_mutate_impl(uuid,text,text,text,uuid,integer,boolean,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p7_announcements_mutate_impl(uuid,text,text,text,uuid,integer,boolean,timestamptz) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p7_announcements_mutate(uuid,text,text,text,uuid,integer,boolean,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p7_announcements_mutate(uuid,text,text,text,uuid,integer,boolean,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION bn_private.bn_p7_notifications_impl(p_class uuid,p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE out jsonb;
BEGIN
 IF bn_private.bn_p6_staff_or_student(p_class) IS NULL
 THEN RAISE EXCEPTION 'ACTIVE class membership required' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',n.id,'type',n.type,'payload',n.payload,
  'read_at',n.read_at,'created_at',n.created_at)
  ORDER BY n.created_at DESC),'[]'::jsonb) INTO out
 FROM (SELECT * FROM public."Notification"
  WHERE user_id=(SELECT auth.uid()) AND class_id=p_class
  ORDER BY created_at DESC LIMIT greatest(1,least(coalesce(p_limit,60),100))) n;
 RETURN out;
END
$fn$;
CREATE OR REPLACE FUNCTION public.bn_p7_notifications(p_class uuid,p_limit integer DEFAULT 60)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$SELECT bn_private.bn_p7_notifications_impl(p_class,p_limit)$$;
REVOKE ALL ON FUNCTION bn_private.bn_p7_notifications_impl(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p7_notifications_impl(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p7_notifications(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p7_notifications(uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION bn_private.bn_p7_notification_read_impl(p_class uuid,p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE affected int;
BEGIN
 IF bn_private.bn_p6_staff_or_student(p_class) IS NULL THEN
  RAISE EXCEPTION 'ACTIVE class membership required' USING ERRCODE='42501';END IF;
 UPDATE public."Notification" SET read_at=coalesce(read_at,now())
 WHERE id=p_id AND user_id=(SELECT auth.uid()) AND class_id=p_class;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Notification not found or access denied' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('id',p_id,'read',true);
END
$fn$;
CREATE OR REPLACE FUNCTION public.bn_p7_notification_read(p_class uuid,p_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$SELECT bn_private.bn_p7_notification_read_impl(p_class,p_id)$$;
REVOKE ALL ON FUNCTION bn_private.bn_p7_notification_read_impl(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION bn_private.bn_p7_notification_read_impl(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.bn_p7_notification_read(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bn_p7_notification_read(uuid,uuid) TO authenticated;
