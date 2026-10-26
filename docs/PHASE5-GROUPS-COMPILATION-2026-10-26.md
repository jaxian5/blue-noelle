# Blue Noelle Phase 5: Groups & Compilation
**Implementation:** October 26, 2026 · **Pull requests:** #34 (merged), #35 (under review)
**Current stage:** Groups and metadata manifest merged. PDF/ZIP compiler and private artifact history implemented on #35; live browser/file-byte acceptance still pending.

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

## Compilation manifests, PDF/ZIP artifacts and private history

### Existing metadata manifest

`public.bn_p5_compilation(p_assignment,p_export)` continues returning a
**metadata-only** overview: the latest immutable submitted version per
Student/group (even when a newer unfinished draft exists), names,
deadlines, late flags and READY file metadata. `p_export=true` audits
a local JSON download; it does not create a combined artifact.

### New actual downloadable artifacts (PR #35)

The authenticated, JWT-verifying Edge Function
`supabase/functions/bn-phase5-compilation/index.ts` is deployed as
`bn-phase5-compilation` and has two actions:

- `{action:"build",assignment_id:"<uuid>",format:"pdf"|"zip"}`:
  validates ACTIVE Admin/Moderator membership through a guarded
  `bn_p5_export_start` RPC. That transaction locks the assignment,
  chooses the latest actual submitted `SubmissionVersion` for each
  Student/group, pins those version IDs in `Compilation`, records a
  `BUILDING` export and captures a fixed list of READY source files.
  The Edge Function downloads the pinned private sources using
  server-managed credentials, verifies size (and SHA-256 where present),
  builds a PDF/ZIP file, uploads it into the private `bn-compilations`
  bucket, calculates the output SHA-256, and completes the export
  through a **service-role-only** attestation RPC.
- `{action:"download",id:"<uuid>"}`: independently authorizes ACTIVE
  staff via `bn_p5_export_access`, audits the download request,
  streams the private output back with safe attachment headers, and
  rechecks the saved SHA-256 and size. **No permanent public or
  client-side signed URLs** are used. For `supabase.functions.invoke`,
  the authenticated download returns `application/octet-stream` so
  Supabase JS decodes it as a binary Blob, not text; the expected PDF/ZIP
  type is reported separately in `X-File-Mime` and the safe download
  filename has the correct extension.

**PDF:** merges source PDF pages in sequence, preceded by a labeled
source-identification cover for each original file. It accepts only
`application/pdf` input and is capped at 150 original pages. It does
**not** claim to convert DOCX, PPTX, JPG, ZIP or other formats to PDF.

**ZIP:** stores all verified source files without conversion, with
owner/version-prefixed, traversal-safe paths and an embedded
`COMPILATION-MANIFEST.json` describing each source.

Limits for both: at most **48 READY files**, **20 MiB combined input**
and **24 MiB generated output**, with a single active build per
assignment, stale-build recovery, and a maximum of 8 starts per hour
per assignment. Invalid or missing Storage objects fail closed with
a persisted FAILED status; partial uploaded outputs are cleaned up.

### Durable provenance and History

Production migration
`20261026070205_phase5_private_compilation_artifacts.sql` creates
`CompilationExport` with fields for class, assignment, requesting
staff, format, BUILDING/READY/FAILED status, private object key,
output size, SHA-256, timestamps and failure code. The existing
`Compilation` table links **exact source submission/version IDs**
to its parent export. This history is immutable with respect to
a later assignment resubmission.

`public.bn_p5_export_history` returns only the 40 newest records,
status and non-secret metadata to authorized staff.
The UI offers **Generate combined PDF**, **Generate ZIP**,
**Refresh history**, and **Download** for READY records.

The private `bn-compilations` bucket allows only PDF/ZIP outputs
up to 24 MiB and has *no direct authenticated-client Storage policies*.
The `CompilationExport` and `Compilation` tables have no direct
anon/authenticated Data API grants. Failure, generation and
download-request audit events are recorded in `AuditLog`.

## Backend security

- `Group`, `GroupMembership`, and `Compilation` have **no direct**
  Data API grants to anon/authenticated. All access goes through narrow
  public SECURITY INVOKER wrappers calling protected `bn_private`
  functions. Those functions check `auth.uid()` and ACTIVE classroom
  membership on every request. Privileged functions use `search_path=''`.
- `bn_p5_compilation` rejects Students and outsiders, and does not expose
  private file keys. `bn_p5_groups_read` rejects Students and outsiders.
- Read permissions do not change the Phase 3 private Storage policies.
- Supabase security advisors report `RLS enabled without policy` for
  deny-by-default private/placeholder tables, including `CompilationExport`.
  This is intentional and paired with revoked client grants and guarded RPCs.
  The Auth advisor separately reports **leaked password protection disabled**,
  a pre-existing operational hardening task unrelated to Phase 5. Review
  [password security configuration](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
  before broad public account onboarding.
- Existing Phase 2/3/4 schema, audits, submission versions and deadlines
  were not changed.
- PDF/ZIP binary generation and service-role Storage operations run only
  inside a JWT-gated Edge Function. The GitHub Pages frontend never
  receives `SUPABASE_SERVICE_ROLE_KEY`, object paths or bucket credentials.
- This is a *generated snapshot*: the binary references exactly the
  submitted historical versions selected at build time, not whichever
  versions are current during later downloads.

## Verification and acceptance

**Automated: 127 passing Node contract tests and 4 passing Deno binary fixture tests, 0 failures** (GitHub Actions), including
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

**Generated-file SQL acceptance:** `tests/acceptance/phase5-generated-files-db-rollback.sql`
PASS against the connected production database. It prepares an actual
Phase 3 submitted PDF metadata fixture, pins a compilation source version,
verifies Student denial of build/history/access, single-flight protection,
audited READY and FAILED transitions, and rollback of all records.

**Edge deployment:** `bn-phase5-compilation` deployed in the connected
Supabase project (version 3, `verify_jwt=true`). It has no anonymous
release endpoint and is not part of the GitHub Pages deployment.

**Deno Edge fixtures:** `tests/phase5-edge-fixtures.test.ts` builds
two real PDF inputs into a five-page compilation and a mixed-file ZIP,
checks source manifest content/path safety, disallows a non-PDF source
in PDF output and verifies SHA-256. CI also `deno check`s the deployed
Edge entrypoint. These are controlled sample files, not real private
classroom uploads.

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
8. Generate PDF output from two or more *real submitted PDFs* in the
   selected class. Download and inspect the labeled cover pages, all
   source pages and PDF integrity. Generate a ZIP with PDF plus DOCX/JPG
   attachments and confirm filenames, content bytes and embedded manifest.
9. Attempt to build a PDF with mixed file types and verify a clear rejection
   recommending ZIP. Retry after missing/corrupt source files and confirm
   FAILED status rather than a false READY artifact.
10. Refresh the browser and confirm persisted READY/FAILED history, SHA-256
    display and authorized download. Revoking staff membership must
    immediately remove download access, including via direct Edge calls.
11. Verify source-version preservation after a Student submits an additional
    version. Older generated outputs remain unchanged and show original
    provenance in the DB.
12. Check a genuine Moderator (read/build/download, not group mutations),
    genuine Student/outsider denied, desktop/mobile and both theme modes.
13. Continue separately outstanding real-file byte and Student-to-Student
    Storage isolation acceptance from Phase 3.

**Release recommendation:** The code and services for Phase 5 milestones
5.1–5.5 are implemented and deployed in part. Approve the phase
**only after** the real authenticated multi-account browser and
private-file-byte acceptance above. The static frontend remains on
PR #35 until merged and GitHub Pages redeployed; database and Edge
Function were independently deployed and secured.
