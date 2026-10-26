-- Class Operations hardening, October 26, 2026.
-- Historical schedule grants mistakenly included TRUNCATE/TRIGGER/REFERENCES.
-- TRUNCATE bypasses row-level security and must never be available to browsers.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public."ScheduleSlot",
  public."ScheduleException" FROM PUBLIC, anon, authenticated;
-- Preserve SELECT for class members and INSERT/DELETE for active Admins,
-- protected by existing RLS policies. UPDATE is not a browser feature yet.

-- The existing browser writes were RLS-guarded but not audited.
-- Auditing in triggers is atomic with the underlying mutation; users cannot
-- forge AuditLog rows from the Data API or skip the audit by using REST directly.
CREATE OR REPLACE FUNCTION bn_private.bn_schedule_audit_impl()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_class uuid; v_id uuid; v_actor uuid := (select auth.uid());
 v_old jsonb := null; v_new jsonb := null; v_role text;
BEGIN
 IF TG_OP='DELETE' THEN
   v_class:=OLD.class_id;v_id:=OLD.id;v_old:=to_jsonb(OLD);
 ELSE
   v_class:=NEW.class_id;v_id:=NEW.id;v_new:=to_jsonb(NEW);
   IF TG_OP='UPDATE' THEN
     v_old:=to_jsonb(OLD);
     IF OLD.class_id IS DISTINCT FROM NEW.class_id THEN
       RAISE EXCEPTION 'A schedule item cannot be moved between classes';
     END IF;
   END IF;
 END IF;
 IF v_actor IS NOT NULL THEN
   SELECT role INTO v_role FROM public."ClassMembership"
     WHERE user_id=v_actor AND class_id=v_class AND role='Admin' AND status='ACTIVE';
   IF v_role IS DISTINCT FROM 'Admin' THEN
     RAISE EXCEPTION 'Only ACTIVE class administrators can change the schedule';
   END IF;
 ELSE
   -- Trusted maintenance/session-less DDL can still write, and is marked System.
   v_role:='System';
 END IF;
 INSERT INTO public."AuditLog"
   (actor_id,actor_role_at_time,class_id,action,target_type,target_id,metadata)
 VALUES
   (v_actor,v_role,v_class,
    'SCHEDULE_'||TG_OP,TG_TABLE_NAME,v_id,
    jsonb_build_object('before',v_old,'after',v_new));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION bn_private.bn_schedule_audit_impl() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS bn_schedule_slot_audit ON public."ScheduleSlot";
CREATE TRIGGER bn_schedule_slot_audit
 AFTER INSERT OR UPDATE OR DELETE ON public."ScheduleSlot"
 FOR EACH ROW EXECUTE FUNCTION bn_private.bn_schedule_audit_impl();
DROP TRIGGER IF EXISTS bn_schedule_exception_audit ON public."ScheduleException";
CREATE TRIGGER bn_schedule_exception_audit
 AFTER INSERT OR UPDATE OR DELETE ON public."ScheduleException"
 FOR EACH ROW EXECUTE FUNCTION bn_private.bn_schedule_audit_impl();
