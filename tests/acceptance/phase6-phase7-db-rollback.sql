-- Phase 6/7 integration acceptance. All data/audit/notifications ROLLBACK.
BEGIN;
DO $qa$
DECLARE admin uuid;student uuid;cid uuid;outsider uuid:=gen_random_uuid();
 msg_id uuid;reply_id uuid;post_id uuid;notice_id uuid;
 response jsonb;denied boolean;before_chat integer;
BEGIN
 SELECT a.user_id,s.user_id,a.class_id INTO admin,student,cid
 FROM public."ClassMembership" a JOIN public."ClassMembership" s ON a.class_id=s.class_id
 WHERE a.status='ACTIVE' AND a.role='Admin' AND s.status='ACTIVE' AND s.role='Student'
 LIMIT 1;
 IF cid IS NULL THEN RAISE EXCEPTION 'QA requires ACTIVE Admin+Student in one classroom';END IF;
 IF has_table_privilege('authenticated','public."ChatMessage"','SELECT')
  OR has_table_privilege('authenticated','public."Announcement"','INSERT')
  OR has_table_privilege('authenticated','public."Notification"','SELECT')
 THEN RAISE EXCEPTION 'Private communications tables exposed via Data API';END IF;

 -- Phase 6 authenticated group-only discussions.
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 response:=public.bn_p6_chat_mutate(cid,'post','Admin opening message');
 msg_id:=(response->>'id')::uuid;
 IF msg_id IS NULL THEN RAISE EXCEPTION 'Admin post failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 response:=public.bn_p6_chat_list(cid);
 IF jsonb_array_length(response)<>1 OR response->0->>'id'<>msg_id::text
 THEN RAISE EXCEPTION 'Student could not read class discussion';END IF;
 denied:=false;
 BEGIN PERFORM public.bn_p6_chat_mutate(cid,'edit','student tampering',msg_id);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Student edited another author message';END IF;
 response:=public.bn_p6_chat_mutate(cid,'post','Student reply',NULL,msg_id);
 reply_id:=(response->>'id')::uuid;
 IF reply_id IS NULL THEN RAISE EXCEPTION 'Reply failed';END IF;
 response:=public.bn_p6_chat_mutate(cid,'edit','Student edited reply',reply_id);
 IF response->>'action'<>'edit' THEN RAISE EXCEPTION 'Self edit failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 IF NOT EXISTS(SELECT 1 FROM public."Notification" n
    WHERE n.user_id=admin AND n.class_id=cid AND n.type='CHAT_REPLY'
    AND (n.payload->>'chat_id')::uuid=reply_id)
 THEN RAISE EXCEPTION 'Reply notification missing for parent author';END IF;
 PERFORM public.bn_p6_chat_mutate(cid,'delete',NULL,reply_id);
 IF (SELECT count(*) FROM public."ChatMessage" WHERE id=reply_id AND deleted_at IS NOT NULL)<>1
 THEN RAISE EXCEPTION 'Staff soft removal did not persist';END IF;
 response:=public.bn_p6_chat_list(cid);
 IF jsonb_array_length(response)<>1 THEN RAISE EXCEPTION 'Removed post leaked into discussion';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 denied:=false;BEGIN PERFORM public.bn_p6_chat_list(cid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider read class discussion';END IF;
 denied:=false;BEGIN PERFORM public.bn_p6_chat_mutate(cid,'post','outsider');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider posted to class';END IF;
 denied:=false;BEGIN PERFORM public.bn_p6_chat_list(gen_random_uuid());
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Other class discussion leaked';END IF;

 -- Phase 7 Admin/Moderator compose, Student view, per-user inbox.
 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 denied:=false;
 BEGIN PERFORM public.bn_p7_announcements_mutate(cid,'create','Not allowed','Text');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Student created staff-only announcement';END IF;
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 response:=public.bn_p7_announcements_mutate(cid,'create',
   'Classroom QA announcement','Phase 7 rollout',NULL,2,true,NULL);
 post_id:=(response->>'id')::uuid;
 IF post_id IS NULL THEN RAISE EXCEPTION 'Create announcement failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 response:=public.bn_p7_announcements_list(cid);
 IF jsonb_array_length(response)<>1 OR response->0->>'title'<>'Classroom QA announcement'
 THEN RAISE EXCEPTION 'Student cannot see pinned staff announcement';END IF;
 response:=public.bn_p7_notifications(cid);
 IF jsonb_array_length(response)<>1 OR response->0->>'type'<>'ANNOUNCEMENT'
 THEN RAISE EXCEPTION 'Student private inbox did not receive announcement';END IF;
 notice_id:=(response->0->>'id')::uuid;
 PERFORM public.bn_p7_notification_read(cid,notice_id);
 IF (SELECT read_at FROM public."Notification" WHERE id=notice_id) IS NULL
 THEN RAISE EXCEPTION 'Read receipt was not recorded';END IF;
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 denied:=false;BEGIN PERFORM public.bn_p7_notification_read(cid,notice_id);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Other account changed notification read receipt';END IF;
 PERFORM public.bn_p7_announcements_mutate(cid,'pin',NULL,NULL,post_id,0,false);
 response:=public.bn_p7_announcements_list(cid);
 IF (response->0->>'pinned')::boolean THEN RAISE EXCEPTION 'Staff pin toggle failed';END IF;
 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 denied:=false;BEGIN PERFORM public.bn_p7_announcements_mutate(cid,'delete',NULL,NULL,post_id);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Student deleted staff announcement';END IF;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 denied:=false;BEGIN PERFORM public.bn_p7_notifications(cid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider read private notification inbox';END IF;
 denied:=false;BEGIN PERFORM public.bn_p7_announcements_list(cid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider read announcements';END IF;
 -- Temporarily elevate Student membership in this transaction to exercise Moderator writes.
 UPDATE public."ClassMembership" SET role='Moderator' WHERE class_id=cid AND user_id=student;
 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 response:=public.bn_p7_announcements_mutate(cid,'create','Moderator message','Valid staff publication');
 IF (response->>'id') IS NULL THEN RAISE EXCEPTION 'Moderator publish denied';END IF;
 PERFORM public.bn_p7_announcements_mutate(cid,'delete',NULL,NULL,(response->>'id')::uuid);

 -- Phase 6 timestamp/UUID pagination must not skip equal-time messages.
 -- Place fixture posts in a future second (ROLLBACK), above all other rows.
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 FOR before_chat IN 1..3 LOOP
   response:=public.bn_p6_chat_mutate(cid,'post','Cursor QA #'||before_chat);
   UPDATE public."ChatMessage" SET created_at=now()+interval '30 seconds'
    WHERE id=(response->>'id')::uuid;
 END LOOP;
 response:=public.bn_p6_chat_page(cid,NULL,NULL,2);
 IF jsonb_array_length(response)<>2 THEN
   RAISE EXCEPTION 'Expected first 2 equal-time posts';END IF;
 DECLARE
   first_page jsonb:=response; second_page jsonb;
 BEGIN
   second_page:=public.bn_p6_chat_page(cid,
     (first_page->0->>'created_at')::timestamptz,(first_page->0->>'id')::uuid,2);
   IF jsonb_array_length(second_page)<1 OR
      (second_page->0->>'id')=(first_page->0->>'id') OR
      (second_page->0->>'id')=(first_page->1->>'id')
   THEN RAISE EXCEPTION 'Equal-time keyset paging duplicated or skipped messages';END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM public."AuditLog" a
    WHERE a.class_id=cid AND a.action='CHAT_POSTED'
      AND a.target_type='ChatMessage')
 THEN RAISE EXCEPTION 'Chat publication audit event missing';END IF;

 -- Phase 7 bulk read is caller-only. Create a fresh Student notification,
 -- then ensure the outsider cannot clear it and Student can.
 response:=public.bn_p7_announcements_mutate(cid,'create','Bulk inbox QA','Unread notice');
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 denied:=false;BEGIN PERFORM public.bn_p7_notifications_read_all(cid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'Outsider bulk-read other classroom';END IF;
 PERFORM set_config('request.jwt.claim.sub',student::text,true);
 -- Restore Student role (changed above to exercise Moderator writes).
 UPDATE public."ClassMembership" SET role='Student' WHERE class_id=cid AND user_id=student;
 response:=public.bn_p7_notifications_read_all(cid);
 IF (response->>'marked_read')::int<1 THEN
   RAISE EXCEPTION 'Student bulk-read did not update its own notifications';END IF;
 IF EXISTS(SELECT 1 FROM public."Notification" n
    WHERE n.user_id=student AND n.class_id=cid AND n.read_at IS NULL)
 THEN RAISE EXCEPTION 'Student still has unread notifications';END IF;
 RAISE NOTICE 'PASS: Phases 6/7 role permissions, equal-time pagination, atomic posting audit, private bulk-read';
END $qa$;
ROLLBACK;
