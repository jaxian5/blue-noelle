# Blue Noelle · Phase 2/3 acceptance · 2026-10-26

**Release state: technical implementation available; owner live-browser sign-off NOT YET RECORDED.**
This is an acceptance record, not a declaration of production release readiness.

## Verified now (live Supabase, 2026-10-26 Asia/Manila)

- Deployed schema migration `20261025222705_phase3_immutable_version_snapshots.sql`.
  `SubmissionVersion.submitted_at` and `deadline_at_submission` preserve each READY version's history.
  Existing current submitted snapshots are backfilled, and the original submission timestamp trigger is kept with a narrow, history-preserving SUBMITTED→DRAFT exception.
- `tests/acceptance/phase2-db-rollback.sql`: **PASS** on live PostgreSQL.
  Uses existing ACTIVE Admin/Student memberships to validate subject/assignment CRUD, six audit events, Asia/Manila deadline calculation, permission denials, and authenticated RLS reads.
- `tests/acceptance/phase3-db-rollback.sql`: **PASS** on live PostgreSQL.
  Tests V1→V2, immutable V1 timestamp/deadline after changing the assignment deadline, actual Storage **metadata** finalization, owner/outsider Storage RLS, group ownership, and denied outsider reads.
- Both SQL suites end with `ROLLBACK`. They create **no persistent academic test data or Storage objects**.
- JavaScript tests under `tests/*.test.mjs` cover private upload UI contracts, history rendering and Manila deadline input.
- Initial and final database counts during testing: 0 assignments, 0 submissions, 0 versions, 0 Storage objects in `bn-submissions`. The unrelated preexisting subjects/classes were left unchanged.

### Important testing limits

Database tests simulate the JWT identity inside PostgreSQL. They do **not** exercise real Supabase Auth access tokens, GitHub Pages browser fetches, Storage object **bytes**, file SHA-256 integrity, email delivery, browser refresh persistence, or an actual second Student's ability to deny access to someone else's work.

In the SQL Phase 3 test, direct inserts into `storage.objects` stand in for the real Storage API; such rows contain only metadata. Never mistake this for a successful upload/download. A repository PR or green CI does not satisfy the release gates below.

## Phase 2 owner browser acceptance (PENDING)

Use the existing verified Admin and Student accounts in **separate browser profiles or private sessions**; no new email signups are necessary.

1. Admin opens `pages/admin-classwork.html`, creates a temporary subject and an individual assignment with PDF MIME restrictions and a deadline of **November 4, 2026, 10:00 PM Asia/Manila**. Confirm the editable form shows 22:00 even if the browser timezone is changed.
2. Refresh. Verify the subject and assignment persist. Rename the subject, edit instructions, change the deadline to **November 5, 2026, 10:00 PM Asia/Manila**, and change assignment status to CLOSED and back to OPEN.
3. Student opens `pages/classwork.html` and `pages/dashboard.html` in another session. Verify only that Student's ACTIVE classroom work is shown; confirm deadlines match the Admin input and that Student cannot access working Admin edit actions.
4. Confirm audit actions `SUBJECT_CREATED`, `SUBJECT_RENAMED`, `ASSIGNMENT_CREATED`, `ASSIGNMENT_UPDATED`, `DEADLINE_CHANGED`, `ASSIGNMENT_STATUS_CHANGED` with correct class, actor and historical role via Supabase SQL tools.
5. Check browser reload, narrow/mobile layout, missing session redirects, and that production pages do not use `localStorage` demo assignments.
6. Do not mark Phase 2 accepted until actual browser results are recorded with date, account role, and pass/fail evidence.

## Phase 3 owner browser acceptance (PENDING)

Use a harmless locally created PDF (never use confidential student documents for QA).
Keep an original copy locally and compare its checksum after download.

1. Admin ensures the test assignment is OPEN; Student opens `pages/submission.html?assignment=<real-assignment-uuid>` via Classwork.
2. Student uploads the PDF. Verify it appears as a private draft, transitions from PENDING to READY, and that submitting marks Version 1 READY with a timestamp.
3. Refresh and download Version 1. Compare downloaded and original bytes (e.g. `sha256sum original.pdf downloaded.pdf` on Linux). An exact match is required.
4. Change the assignment deadline as Admin. Student uploads a different PDF as Version 2, submits and downloads it. Both files must match their originals; Version 1 retains its original timestamp and deadline even after refreshing the page.
5. Admin views the class-scoped staff review pane. Verify both versions and late calculations. If a Moderator exists, verify review-only access.
6. For a group assignment, Admin creates a group and adds an ACTIVE Student. Student uploads and submits a group-owned PDF. Verify review and download work, and non-members cannot read or upload to that group.
7. **Cross-account proof:** log in as another separately confirmed ACTIVE Student (not in the same group) and try opening the first Student's submitted Storage object and submission via the UI/API. Both must be denied. The current database has only one ACTIVE Student in the tested classroom, so this scenario cannot be completed with the two existing roles alone.
8. Check signed-out restrictions, closed assignments, unsupported MIME, empty files, 40 MiB file cap, interrupted uploads, storage quota errors, and small-screen behavior.
9. Record screenshot/video evidence (without tokens, email OTPs, or privileged keys), test files/checksums, and whether each operation survived refresh.

**Do not use production service-role keys in a browser or paste session tokens into issues.** Do not disable Auth confirmation to create test accounts. A second test Student, if needed, must follow the approved trusted onboarding procedure.

## Sign-off record (unfilled)

| Gate | Result | Evidence |
| --- | --- | --- |
| Phase 2 transactional database authorization | PASS | `tests/acceptance/phase2-db-rollback.sql` |
| Phase 2 Admin/Student real browser sessions | PENDING | Owner evidence required |
| Phase 2 deadline display on foreign-timezone browser | PENDING | Browser check required |
| Phase 3 database V1→V2 snapshot regression | PASS | `tests/acceptance/phase3-db-rollback.sql` |
| Phase 3 Storage RLS under authenticated role (metadata only) | PASS | `tests/acceptance/phase3-db-rollback.sql` |
| Phase 3 real Storage byte upload/download + checksum | PENDING | Owner evidence required |
| Phase 3 real second Student isolation and group UI | PENDING | Owner evidence required |
| Final Phase 2 sign-off | **NOT GRANTED** | Live browser acceptance outstanding |
| Final Phase 3 sign-off | **NOT GRANTED** | Live byte and cross-account acceptance outstanding |

The earlier Phase 1 SMTP deliverability limitation remains a separately tracked operational issue. Existing verified accounts may continue these tests without disabling email confirmation.
