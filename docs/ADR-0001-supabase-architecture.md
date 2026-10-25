# ADR-0001: Supabase implementation of Blue Noelle

**Status:** ACCEPTED for Phase 0 baseline · 2026-10-25

**Source of truth:** `PROJECT_ Blue Noelle.docx` (2026-09-18). This ADR records an **implementation choice made after that document**, not a retroactive edit to its requirements.

## Decision
Use Supabase hosted PostgreSQL and Auth as the initial backend; static frontend remains GitHub Pages. Use RLS plus narrow permission-checked PostgreSQL RPCs for sensitive transitions. The browser uses only the public Supabase project URL and publishable key. Never expose any database password, `sb_secret_*`, or service-role key.

## Storage adjustment
The original document proposes a local application-managed storage backend with `put/get/delete/exists` abstraction and later optional migration to object storage. Because deployment is static and there's no trusted local storage server, **use private Supabase Storage buckets for initial real submissions** while preserving an application-level opaque `storage_key` abstraction. The `File` table already reserves filename, MIME, size and SHA-256 fields. Storage buckets, private access policies and upload/download logic were **deferred at Phase 0**. They were later implemented and merged in Phase 3 PR #23 (private `bn-submissions` bucket, narrow guarded RPCs, Storage RLS), but **live file-byte upload/download and isolation acceptance is still required for production sign-off**.

## Multi-class ownership amendment (2026-10-25)
Blue Noelle now supports **multiple independent classes**, not a deployment dedicated to one section. An immutable signup choice is captured as `User.account_type` (Admin or Student) at Auth creation. A verified Admin creates exactly one owned class via a private transactional RPC, which simultaneously grants their ACTIVE Admin membership. Admin accounts cannot join another class; Student accounts join classes by private invitation and may have different roles in different classes. `Class.owner_user_id` is uniquely indexed and `ClassMembership` has an Admin-ownership guard. Existing sample class rows remain unowned. See [Multi-Class Phase 1](MULTICLASS-PHASE1.md).

## Trust boundaries
- **Identity:** Supabase Auth manages password hashes and sessions. `public."User"` provides profile data only.
- **Class membership:** `public."ClassMembership"` is the authoritative role/status source; client-supplied `user_metadata` is never authorized as a role.
- **Browser:** never trusted to approve accounts, grant Admin/Moderator rights or bypass class scoping.
- **RPC:** security-definer functions must validate `auth.uid()` plus class authorization internally, live in a non-exposed private schema where feasible, and restrict EXECUTE grants.
- **Data:** all 19 public tables have RLS; future phase tables intentionally deny browser access pending feature-specific policies.
- **Audit:** role at event time, actor, class, action, target, timestamp; future mutations must write authoritative database audit rows.
- **Time:** `timestamptz` persisted in UTC, local `TIME` on recurring slots, displayed in `Asia/Manila`.
- **Developer:** platform-wide `is_developer` is not a normal editable membership and must be controlled through trusted operations with auditing.

## Deliberate non-goals
No fictional demo accounts, public demo invite codes, raw passwords, uploaded student files or privileged server keys are migrated. Phase 5–10 entities may exist now, but they are not enabled features.

## Release gates
1. **Phase 0 documents**: schema, entity relationships, permission matrix, storage specification/ADR, threat model, system architecture and sitemap consistent.
2. **Phase 0 DB**: migrations deployed, all 19 public tables use RLS, ownership constraints inspected, no accidental PUBLIC/anon privileged access.
3. **Phase 1 implementation**: real signup, invite redemption, pending membership, moderator review, active login; separate accounts and negative tests.
4. **Phase 3**: secure storage and end-to-end E-Journal submit/retrieve.

This document supersedes the idea that `docs/schema.sql` is executable migration code: it is an early **design draft**. `supabase/migrations/` is the executable schema.
