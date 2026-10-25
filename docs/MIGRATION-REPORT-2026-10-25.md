# Blue Noelle — live migration and debugging report (2026-10-25)

## Live target
Supabase project: `zllphzqalkurnibfctyl` · PostgreSQL 17 · `Asia/Manila` class display timezone.

**Database:** 19 `public` application tables are deployed. All 19 have RLS enabled. The 11 future-phase tables intentionally lack frontend grants and RLS policies, so they remain closed until their features are developed. The security advisor reports this as INFO, not a permissions failure. Authenticated-access SECURITY DEFINER RPCs retain advisor warnings; their internal role checks still need end-to-end tests with separated identities.

## Source inventory and migration outcome

| GitHub source | Source content | Migration outcome |
| --- | --- | --- |
| `data/roles.json` | Four fictional accounts (Student/Moderator/Admin/Developer) with plaintext demo passwords; one class name | **Class metadata migrated once; accounts/passwords NOT migrated.** Real identities must be enrolled via Supabase Auth. |
| `data/invite-codes.json` | Three **publicly documented demo** codes including staff/developer codes | **NOT imported**. These codes cannot be trusted in production. The new `InviteCode` schema only stores hashes, not raw codes. |
| `data/assignments.json` | `subjects: []`, `assignments: []` | Zero data rows to migrate. |
| `data/pending-registrations.json` | `pending: []` | Zero data rows to migrate. |
| `data/audit-log.json` | `events: []` | Zero data rows to migrate. |
| `docs/schema.sql` | Complete Phase 0 design | Supabase now has all corresponding entity tables, adapted for Supabase Auth and secure RLS; see actual versioned migrations. |
| Browser `localStorage.bn_phase2_assignments` | **Unknown:** local to an individual browser, not in GitHub | Use `pages/import-local-data.html` with an actual Supabase Admin membership to review and import data. |

Imported class provenance: legacy `class-educ2-a` → Supabase `Class.id = 8f69ba0f-6fb6-41b1-9765-08d9abcb8d3b` and name `EDUC 2 · The Teaching Profession · Section A`. **This is sample classroom data**, not a real enrollment, and there are no associated production accounts.

## Current source-of-truth migrations
Remote versions and GitHub migration filenames have been aligned. As of this report:

1. `20261025024400_initial_classroom.sql`
2. `20261025024408_class_operations.sql`
3. `20261025024435_harden_class_rpc_anon_permissions.sql`
4. `20261025025024_auth_profile_and_data_api_permissions.sql`
5. `20261025025739_complete_phase_zero_entity_schema.sql`
6. `20261025030007_import_legacy_demo_class_metadata.sql`

These migrations have been applied to the remote project. Earlier nonmatching filenames must not be reintroduced: `supabase db push` will otherwise attempt to replay them. Pull request #6 adds an older version of the privilege fix and should be closed/superseded after this newer PR is merged.

## Database safeguards tested

- Verified all 19 public tables have RLS enabled.
- Transactional database smoke test accepted a valid group-owned submission and rejected an invalid submission owner. The test transaction was rolled back; no test records remain.
- Explicit grants allow authenticated phase-1/2 reading and permitted admin-scoped writes, leaving future-phase tables closed.
- Confirmed `authenticated` cannot update `Assignment.subject_id` and can update `Assignment.status` (RLS still applies).
- Verified anonymous execution of three privileged RPCs was blocked previously.
- `auth.users` → `public."User"` auto-provision trigger exists. **Actual Auth signup has not yet been tested**.
- Submission ownership uses Student XOR Group; current version must belong to same submission; snapshot timestamps become immutable when populated; group submissions must match assignment type; compilation must reference the submission's own source version; chat reply parent stays in class.

## Debugging fixes

- Fixed/pinned Supabase UMD JS path in Class Operations.
- Added separate `supabase-auth.html` for real Auth test signup/sign-in (no auto class elevation).
- Added browser/JSON Phase-2 classwork import with Admin checks and reimport duplicate detection; backed by RLS.
- Removed false "Submitted" / "Draft saved" messages from the Phase-3 simulation.
- Escaped filename, dashboard assignment, moderator masterlist text; replaced avatar HTML interpolation with DOM image creation and restricted allowed avatar MIME types.
- Checked JavaScript syntax in 22 JS/HTML files; executed an isolated mock to test successful and duplicate browser classwork imports and non-admin rejection.

## Remaining blockers

**Not yet production ready.** Initial Administrator bootstrap needs a real signed-in Auth account and an explicitly provisioned `ClassMembership` pointing to the sample class (or the actual class you intend to use). No Auth users exist yet. The public demo `login.html` / `register.html` still uses localStorage; the live test UI is deliberately separate to avoid mixing identities.

No actual student submissions/files existed in GitHub, and no files were uploaded to Supabase Storage. The submission page remains a preview; do not accept real assignments through it. Role-based RLS tests across distinct users, live email confirmation, actual browser integration testing, and Phase-3 private storage policies are still required.

For Supabase Auth confirmation links, set the project's Site URL and redirect allowlist to the actual deployed origin (GitHub Pages or another chosen host) before using live signup.
