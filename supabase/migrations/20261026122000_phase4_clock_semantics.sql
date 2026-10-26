-- Blue Noelle Phase 4: Class Clock timetable semantics.
-- Add an optional per-slot exception target without altering legacy records.
-- All existing RLS policies and schedule audit triggers remain authoritative.
ALTER TABLE public."ScheduleException"
 ADD COLUMN IF NOT EXISTS schedule_slot_id uuid
 REFERENCES public."ScheduleSlot"(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS bn_slot_class_day_start_idx
 ON public."ScheduleSlot"(class_id,day_of_week,start_local);
CREATE INDEX IF NOT EXISTS bn_exception_class_date_idx
 ON public."ScheduleException"(class_id,exception_date);
CREATE UNIQUE INDEX IF NOT EXISTS bn_exception_target_once_idx
 ON public."ScheduleException"(schedule_slot_id,exception_date)
 WHERE schedule_slot_id IS NOT NULL AND kind IN ('holiday','cancelled','rescheduled');
CREATE UNIQUE INDEX IF NOT EXISTS bn_exception_whole_day_once_idx
 ON public."ScheduleException"(class_id,exception_date)
 WHERE schedule_slot_id IS NULL AND kind IN ('holiday','cancelled');

-- Prevent overlapping recurring sessions for one class/day, and reject
-- subject links pointing into other classrooms. Advisory transaction lock
-- serializes concurrent Admin inserts on the same class/day.
CREATE OR REPLACE FUNCTION bn_private.bn_phase4_guard_slot()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF NEW.subject_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public."Subject" s WHERE s.id=NEW.subject_id
      AND s.class_id=NEW.class_id AND s.deleted_at IS NULL
 ) THEN RAISE EXCEPTION 'Schedule subject must belong to this active classroom'; END IF;
 IF NEW.start_local>=NEW.end_local THEN RAISE EXCEPTION 'Class must end after it starts';END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(NEW.class_id::text||':'||NEW.day_of_week::text,0));
 IF EXISTS(SELECT 1 FROM public."ScheduleSlot" s WHERE s.class_id=NEW.class_id
   AND s.day_of_week=NEW.day_of_week AND s.id IS DISTINCT FROM NEW.id
   AND s.start_local<NEW.end_local AND NEW.start_local<s.end_local)
 THEN RAISE EXCEPTION 'Overlapping class sessions are not allowed on the same day';END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bn_private.bn_phase4_guard_slot() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bn_phase4_slot_validation ON public."ScheduleSlot";
CREATE TRIGGER bn_phase4_slot_validation BEFORE INSERT OR UPDATE
 ON public."ScheduleSlot" FOR EACH ROW EXECUTE FUNCTION bn_private.bn_phase4_guard_slot();

CREATE OR REPLACE FUNCTION bn_private.bn_phase4_guard_exception()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE v_class uuid; v_day smallint;
BEGIN
 IF NEW.schedule_slot_id IS NOT NULL THEN
   SELECT s.class_id,s.day_of_week INTO v_class,v_day
    FROM public."ScheduleSlot" s WHERE s.id=NEW.schedule_slot_id;
   IF v_class IS DISTINCT FROM NEW.class_id THEN
     RAISE EXCEPTION 'Exception target must be in the same classroom';END IF;
   IF NEW.kind='special' THEN
     RAISE EXCEPTION 'Special one-off sessions must not target a recurring slot';END IF;
   IF EXTRACT(DOW FROM NEW.exception_date)::integer<>v_day THEN
     RAISE EXCEPTION 'Target slot does not take place on that date';END IF;
 END IF;
 IF NEW.kind='rescheduled' AND NEW.schedule_slot_id IS NULL THEN
   RAISE EXCEPTION 'Choose which class is being rescheduled';END IF;
 IF NEW.kind='rescheduled' AND
   (NEW.replacement_start_local IS NULL OR NEW.replacement_end_local IS NULL) THEN
   RAISE EXCEPTION 'A reschedule requires a start and end time';END IF;
 IF NEW.kind IN ('holiday','cancelled') AND
   (NEW.replacement_start_local IS NOT NULL OR NEW.replacement_end_local IS NOT NULL) THEN
   RAISE EXCEPTION 'Cancellation dates must not have replacement times';END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION bn_private.bn_phase4_guard_exception() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bn_phase4_exception_validation ON public."ScheduleException";
CREATE TRIGGER bn_phase4_exception_validation BEFORE INSERT OR UPDATE
 ON public."ScheduleException" FOR EACH ROW EXECUTE FUNCTION bn_private.bn_phase4_guard_exception();
