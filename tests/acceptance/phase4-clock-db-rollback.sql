-- Phase 4 acceptance: CLASS CLOCK write-side invariants.
-- Run in a trusted SQL connection; entire fixture and audits are ROLLED BACK.
BEGIN;
DO $qa$
DECLARE
 actor uuid; room uuid; other_room uuid; other_subject uuid;
 first_slot uuid;second_slot uuid; ex uuid;
 baseline int;after_audit int;rejected boolean;
BEGIN
 SELECT user_id,class_id INTO actor,room FROM public."ClassMembership"
  WHERE role='Admin' AND status='ACTIVE' LIMIT 1;
 IF actor IS NULL THEN RAISE EXCEPTION 'Requires a verified ACTIVE class Admin';END IF;
 SELECT id INTO other_room FROM public."Class" WHERE id<>room LIMIT 1;
 SELECT id INTO other_subject FROM public."Subject"
  WHERE class_id IS DISTINCT FROM room AND deleted_at IS NULL LIMIT 1;
 SELECT count(*) INTO baseline FROM public."AuditLog"
  WHERE class_id=room AND action LIKE 'SCHEDULE_%';
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('role','authenticated',true);
 INSERT INTO public."ScheduleSlot"(class_id,day_of_week,start_local,end_local,label)
 VALUES(room,1,'09:00','10:00','QA Phase4 Morning') RETURNING id INTO first_slot;
 INSERT INTO public."ScheduleSlot"(class_id,day_of_week,start_local,end_local,label)
 VALUES(room,1,'10:00','11:00','QA Phase4 Second') RETURNING id INTO second_slot;
 -- Adjacent sessions are valid; overlap must fail with transaction serialization.
 rejected:=false;
 BEGIN
   INSERT INTO public."ScheduleSlot"(class_id,day_of_week,start_local,end_local,label)
   VALUES(room,1,'09:45','10:30','INVALID overlap');
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE '%Overlapping class sessions%' THEN rejected:=true;
   ELSE RAISE;END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Overlapping session was accepted';END IF;
 IF other_subject IS NOT NULL THEN
   rejected:=false;
   BEGIN
     INSERT INTO public."ScheduleSlot"(class_id,subject_id,day_of_week,start_local,end_local,label)
     VALUES(room,other_subject,3,'08:00','09:00','INVALID other subject');
   EXCEPTION WHEN OTHERS THEN
     IF SQLERRM LIKE '%subject must belong%' THEN rejected:=true;
     ELSE RAISE;END IF;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'Cross-class Subject accepted';END IF;
 END IF;
 rejected:=false;
 BEGIN
   INSERT INTO public."ScheduleException"(class_id,exception_date,kind,
    replacement_start_local,replacement_end_local)
   VALUES(room,'2026-11-02','rescheduled','14:00','15:00');
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE '%Choose which class%' THEN rejected:=true;
   ELSE RAISE;END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Unscoped reschedule was accepted';END IF;
 rejected:=false;
 BEGIN
   INSERT INTO public."ScheduleException"(class_id,schedule_slot_id,exception_date,kind,
    replacement_start_local,replacement_end_local)
   VALUES(room,first_slot,'2026-11-03','rescheduled','14:00','15:00');
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE '%does not take place%' THEN rejected:=true;
   ELSE RAISE;END IF;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Wrong-weekday exception accepted';END IF;
 INSERT INTO public."ScheduleException"(class_id,schedule_slot_id,exception_date,kind,
  note,replacement_start_local,replacement_end_local)
 VALUES(room,first_slot,'2026-11-02','rescheduled','QA Phase4 moved class','14:00','15:00')
 RETURNING id INTO ex;
 IF NOT EXISTS(SELECT 1 FROM public."ScheduleException"
  WHERE id=ex AND schedule_slot_id=first_slot) THEN
  RAISE EXCEPTION 'Targeted reschedule not stored';END IF;
 rejected:=false;
 BEGIN
   INSERT INTO public."ScheduleException"(class_id,schedule_slot_id,exception_date,kind)
   VALUES(room,first_slot,'2026-11-02','cancelled');
 EXCEPTION WHEN unique_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Duplicate exception targeting a class accepted';END IF;
 DELETE FROM public."ScheduleException" WHERE id=ex;
 DELETE FROM public."ScheduleSlot" WHERE id=first_slot;
 DELETE FROM public."ScheduleSlot" WHERE id=second_slot;
 PERFORM set_config('role','postgres',true);
 SELECT count(*) INTO after_audit FROM public."AuditLog"
  WHERE class_id=room AND action LIKE 'SCHEDULE_%';
 IF after_audit-baseline<>6 THEN
   RAISE EXCEPTION 'Audit mismatch: expected 6 events; got %',after_audit-baseline;END IF;
 RAISE NOTICE 'PASS: subject isolation, overlap rejection, scoped reschedules, weekday guards and 6 audited mutations';
END $qa$;
ROLLBACK;
