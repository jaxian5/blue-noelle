-- Phase 1 least-privilege hardening.
-- The initial baseline left unnecessary direct table grants inherited by anon
-- and authenticated. RLS blocked unauthorized rows, but the grants were broader
-- than needed. Keep RLS as primary row boundary and narrow SQL privileges too.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
-- Identity, classroom and membership mutations must go through trusted Auth,
-- migrations or the guarded bn_private security-definer registration RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 ON public."User", public."Class", public."ClassMembership", public."ClassActionLog"
 FROM authenticated;
-- Phase 2/3 academic records are soft-deleted via permitted column updates,
-- not directly deleted. Preserve schedule deletion where intentionally supported.
REVOKE DELETE ON public."Subject", public."Assignment" FROM authenticated;
