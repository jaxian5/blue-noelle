# Blue Noelle Phase 5: Groups & Compilation
**Implementation:** October 26, 2026 · **Pull request:** #34
**Current stage:** Milestone 1 implemented; final browser acceptance and generated-file compilation remain pending.

## Product goal

Phase 5 builds on Phase 3's audited group-specific submissions, without
introducing a second or less-protected group/Storage implementation. The new
authenticated route `pages/phase5-groups.html` has one unified workspace
for grouping Students by assignment and reviewing a verified compilation
of submitted-version metadata.

### User journeys

| Account role | Allowed behavior |
| --- | --- |
| ACTIVE Student | Choose an approved class and assignment; view own assigned group via `bn_p3_my_group`; follow link to Phase 3 private upload/version history. |
| ACTIVE Moderator | View group names/members and locked status for a group assignment **read only**; review a server-verified compilation manifest for any assignment in their approved class; export the metadata JSON with an audit record. |
| ACTIVE Admin | All staff read capabilities, plus create groups and add/remove ACTIVE Students through existing `bn_p3_groups` RPC. Edits stop once a group's first submission draft exists. |
| Developer with no membership | No bypass. Developer silver is a cosmetic theme, not class data permission. |
| Outsider / unapproved member | No access to class-specific groups or manifest; server checks `auth.uid()` and ACTIVE membership. |

The UI uses the same sidebar and theme variables as Phases 1–4; role themes
(Student Blue, Moderator Purple, Admin Indigo and verified Developer Silver)
work in light and dark appearance modes. Class switches discard stale API
responses to avoid showing prior classroom data.

## Audited group workflow

Existing `public.bn_p3_groups` is the *sole* write pathway for Admin group
creation/assignment. It rejects non-group assignments, outsiders and
Students outside the ACTIVE class, and prevents assignment to more than
one active group per assignment. It emits `AuditLog` records.

Migration
`20261026063125_phase5_group_integrity_compilation_manifest.sql`
adds `bn_p5_group_membership_freeze`, a protected DB trigger. When a group's
submission first exists (even in draft), group membership changes are
rejected. This prevents quietly granting/revoking access to private
Storage versions after work has started. In particular it is not merely
a disabled HTML button: the database enforces this for any client.

Migration `20261026063345_phase5_staff_group_read.sql` introduces
`public.bn_p5_groups_read(p_assignment)`, a guarded read-only RPC for
Admin/Moderator. It returns groups and active member names, together
with `locked:true/false`. Moderators cannot create or edit groups.

## Compilation: current implementation and boundaries

`public.bn_p5_compilation(p_assignment,p_export)` returns a **metadata-only**
server-authenticated manifest. For each Student/group submission it selects
the latest `SubmissionVersion` with `upload_state='READY'` and
`submitted_at IS NOT NULL`, including a historical submitted version
when a newer draft is underway. Each entry contains the Student/group,
version number, immutable submission/deadline snapshots, late status,
and READY, non-deleted file **metadata** (name, MIME, size and ID).
It does not return private storage keys, signed links or file bytes.

A staff export sets `p_export=true` and creates a protected
`COMPILATION_MANIFEST_EXPORTED` audit event, before returning the JSON
for a local download. Neither the staff preview nor the JSON export
writes `Compilation` records. That entity stays inaccessible to web
clients until the separately scoped secure output-artifact generation
pipeline is implemented.

**Not yet implemented:** a server-generated combined PDF/ZIP, long-running
file aggregation, private generated-output storage, durable compilation
history or downloadable composite artifacts. Calling the JSON manifest a
merged PDF would be misleading.

## Backend security

- `Group`, `GroupMembership`, and `Compilation` have **no direct**
  Data API grants to anon/authenticated. All access goes through narrow
  public SECURITY INVOKER wrappers calling protected `bn_private`
  functions. Those functions check `auth.uid()` and ACTIVE classroom
  membership on every request. Privileged functions use `search_path=''`.
- `bn_p5_compilation` rejects Students and outsiders, and does not expose
  private file keys. `bn_p5_groups_read` rejects Students and outsiders.
- Read permissions do not change the Phase 3 private Storage policies.
- Existing Phase 2/3/4 schema, audits, submission versions and deadlines
  were not changed.

## Verification and acceptance

**Automated: 121 passing tests, 0 failing** (GitHub Actions), including
`tests/phase5-foundation.test.mjs` and the expanded canonical route,
theme, navigation and legacy-release checks.

**Database:** `tests/acceptance/phase5-db-rollback.sql` PASS against
the connected Supabase project, with temporary group assignment/submission
rolled back. Checks real ACTIVE Admin group creation and Student allocation,
read model lock state, refusal to mutate group after draft, metadata-only
compilation JSON, audited export and Student access denial. The test also
creates a submitted Version 1 and unfinished Version 2 and confirms the
staff manifest returns historical Version 1 with its preserved late flag.
Post-deployment Phase 2 and Phase 3 rollback tests also PASS; an older
Class Operations rollback test was updated to follow Phase 4's explicit
reschedule target requirement and now PASS.

**Still required in a browser:**
1. ACTIVE Admin creates a group and assigns a Student, then refreshes. Group
   data persists; second group assignment for that Student is denied.
2. ACTIVE Student opens the workspace and sees their own group, not other
   groups or staff exports. Direct calls to staff RPCs fail.
3. ACTIVE Moderator can read a classroom group roster and compilation
   preview but cannot change the roster.
4. Upload/submit a real Phase 3 group draft; verify group becomes locked and
   adding/removing members is denied by database even through direct RPC.
5. Confirm latest *submitted* historical version remains included in the
   manifest if a newer draft exists. Confirm deleted/pending files are excluded.
6. Export JSON and confirm AuditLog event, content ordering, no Storage
   keys/public URLs and no fake `Compilation` database rows.
7. Switch between classes with different roles; verify content, sidebar
   palette, dark mode, mobile layout and navigation.
8. Continue separately outstanding real-file byte and Student-to-Student
   storage isolation acceptance from Phase 3.

**Recommendation:** Approve Milestone 1 only after browser acceptance;
then implement secure file aggregation/merge as Milestone 2 before marking
all Phase 5 complete. Do not conflate a metadata export with a generated
document.
