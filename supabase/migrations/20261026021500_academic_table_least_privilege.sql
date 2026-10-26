-- Follow-up full-system grant audit. Subjects and Assignments were already
-- RPC-only for writes but retained unnecessary table-level privileges.
-- In PostgreSQL, TRUNCATE bypasses row-level security completely. A hostile
-- authenticated client must never be able to wipe academic records.
REVOKE TRUNCATE, TRIGGER, REFERENCES
ON public."Subject", public."Assignment"
FROM PUBLIC, anon, authenticated;
-- Keep SELECT with existing class-scoped RLS. Guarded bn_manage_classwork
-- runs in the private schema, so direct client INSERT/UPDATE are not needed.
