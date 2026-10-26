-- Class Operations live acceptance (Admin + read-only permission checks).
-- Execute on a trusted SQL connection, never in a public browser.
-- Entire fixture including AuditLog entries is rolled back.
BEGIN;
DO $qa$
DECLARE
 v_admin uuid; v_class uuid; v_other uuid; v_slot uuid; v_exception uuid;
 v_audit_before integer;v_audit_after integer;v_directory integer;
BEGIN
 IF has_table_privilege('authenticated','public."Subject"','TRUNCATE')
   OR has_table_privilege('authenticated','public."Assignment"','TRUNCATE')
   OR has_table_privilege('authenticated','public."Subject"','TRIGGER')
   OR has_table_privilege('authenticated','public."Assignment"','TRIGGER')
 THEN RAISE EXCEPTION 'Academic table privileges bypass RLS';END IF;
 IF has_table_privilege('authenticated','public."ScheduleSlot"','TRUNCATE')
   OR has_table_privilege('authenticated','public."ScheduleException"','TRUNCATE')
   OR has_table_privilege('authenticated','public."ScheduleSlot"','TRIGGER')
   OR has_table_privilege('authenticated','public."ScheduleException"','TRIGGER')
 THEN RAISE EXCEPTION 'Dangerous schedule grant detected';END IF;
 SELECT user_id,class_id INTO v_admin,v_class
 FROM public."ClassMembership" WHERE role='Admin' AND status='ACTIVE'
 ORDER BY created_at LIMIT 1;
 IF v_admin IS NULL THEN RAISE EXCEPTION 'Requires one ACTIVE Admin'; END IF;
 SELECT id INTO v_other FROM public."User" WHERE id<>v_admin LIMIT 1;
 SELECT count(*) INTO v_audit_before FROM public."AuditLog"
 WHERE class_id=v_class AND action LIKE 'SCHEDULE_%';

 PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 PERFORM set_config('role','authenticated',true);
 SELECT count(*) INTO v_directory FROM public.bn_class_directory(v_class);
 IF v_directory<1 THEN RAISE EXCEPTION 'Admin cannot read own directory';END IF;
 BEGIN
   EXECUTE 'TRUNCATE public."ScheduleSlot"';
   RAISE EXCEPTION 'Authenticated user could TRUNCATE schedules';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 INSERT INTO public."ScheduleSlot"(class_id,day_of_week,start_local,end_local,label)
 VALUES(v_class,1,'09:00','10:30','QA only: rollback schedule')
 RETURNING id INTO v_slot;
 INSERT INTO public."ScheduleException"(class_id,schedule_slot_id,exception_date,kind,note,
 replacement_start_local,replacement_end_local)
 VALUES(v_class,v_slot,'2026-11-02','rescheduled','QA only: rollback exception',
 '13:00','14:30')
 RETURNING id INTO v_exception;
 IF NOT EXISTS(SELECT 1 FROM public."ScheduleSlot" WHERE id=v_slot) THEN
   RAISE EXCEPTION 'Cannot read newly created slot';END IF;
 IF NOT EXISTS(SELECT 1 FROM public."ScheduleException" WHERE id=v_exception) THEN
   RAISE EXCEPTION 'Cannot read newly created exception';END IF;
 IF v_other IS NOT NULL THEN
   PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
   IF EXISTS(SELECT 1 FROM public."ScheduleSlot" WHERE id=v_slot)
      AND NOT EXISTS(SELECT 1 FROM public."ClassMembership"
          WHERE user_id=v_other AND class_id=v_class AND status='ACTIVE') THEN
     RAISE EXCEPTION 'Outsider can read another class schedule';
   END IF;
   PERFORM set_config('request.jwt.claim.sub',v_admin::text,true);
 END IF;
 DELETE FROM public."ScheduleException" WHERE id=v_exception;
 DELETE FROM public."ScheduleSlot" WHERE id=v_slot;
 PERFORM set_config('role','postgres',true);
 SELECT count(*) INTO v_audit_after FROM public."AuditLog"
 WHERE class_id=v_class AND action LIKE 'SCHEDULE_%';
 IF v_audit_after-v_audit_before<>4 THEN
   RAISE EXCEPTION 'Expected four atomic schedule AuditLog rows; found %',
     v_audit_after-v_audit_before; END IF;
 IF EXISTS(SELECT 1 FROM public."ScheduleSlot" WHERE id=v_slot) OR
   EXISTS(SELECT 1 FROM public."ScheduleException" WHERE id=v_exception)
 THEN RAISE EXCEPTION 'Delete failed';END IF;
 RAISE NOTICE 'PASS: class directory, Admin schedule CRUD, RLS, denied TRUNCATE and four audited changes';
END $qa$;
ROLLBACK;
