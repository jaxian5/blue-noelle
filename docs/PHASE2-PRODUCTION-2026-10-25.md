# Phase 2 Production Implementation · October 25, 2026

**Status:** Production code prepared on feature branch. The database migration has been applied and transactionally tested on the live Supabase project. GitHub merge and owner browser acceptance are separate release gates.

## Scope and decisions

Phase 1 membership/security was approved earlier. **Phase 1 email deliverability is on hold**, pending advice and resolution; this does not disable existing Supabase sessions, real classroom reads, or authorized classwork writes. Email verification and password recovery remain unreliable for some recipients. New public enrollment must NOT be marketed as production ready.

Phase 2 is now based on **real Supabase Auth + PostgreSQL**, never browser-local demo identities or browser-local assignment data. GitHub Pages remains free hosting, Supabase remains on Free, and no paid SMTP/domain requirement is introduced.

### Production screens

| Route | Purpose |
|---|---|
| `pages/dashboard.html` | **New** responsive multiclasse dashboard: personal verified profile, active class picker, role badge, subjects, open work and seven-day deadlines, real data. |
| `pages/classwork.html` | Authenticated view of Subjects and Assignments, class-scoped via RLS, including archived/closed status display. |
| `pages/admin-classwork.html` | **New** ACTIVE Admin-only management UI: Subject creation and renaming, Assignment creation and editing, status transitions `OPEN` / `CLOSED` / `ARCHIVED`, required MIME types, maximum file sizes and deadlines. |
| `pages/account.html` | Existing approved membership center, now links to dashboard and role-gated Admin classwork. |
| `pages/assignments.html`, `pages/admin-assignments.html` | Redirect into the live classwork pages. |
| `pages/submission.html` | Former fake submission UI removed; signed-in Phase 3 notice. **No actual file upload is enabled yet.** |
| Legacy Admin/Moderator/Developer directory routes | Redirect to live staff/account destinations rather than presenting fictitious identities. |

### Database enforcement

Migration: `supabase/migrations/20261025125119_phase2_audited_classwork_rpcs.sql`.

- Exposed `public.bn_manage_classwork(p_class uuid,p_action text,p_data jsonb)` is SECURITY INVOKER.
- `bn_private.bn_classwork_manage_impl` is security-definer in a **non-exposed private schema** with pinned `search_path` and a **mandatory check of `auth.uid()` against ACTIVE Admin membership in the given class** on every call.
- Supported actions: `subject.create`, `subject.rename`, `assignment.create`, `assignment.update`, `assignment.status`. Neither arbitrary SQL nor cross-class assignment reassignment is exposed.
- Creates and updates are atomic with `AuditLog` inserts. Audited actions include `SUBJECT_CREATED`, `SUBJECT_RENAMED`, `ASSIGNMENT_CREATED`, `ASSIGNMENT_UPDATED`, `ASSIGNMENT_STATUS_CHANGED` and `DEADLINE_CHANGED` (when applicable).
- Direct browser `INSERT`, `UPDATE`, `DELETE` on `Subject` and `Assignment` are REVOKED from authenticated so no unaudited bypass remains. Classroom SELECT remains governed by pre-existing ACTIVE-membership RLS, and the function's role guards are rechecked server-side.
- Inputs are validated for names, field size, required types, MAX file size and status; deadlines use TIMESTAMPTZ and are displayed in Asia/Manila in the dashboard.
- No production user profile, membership, class, Subject or Assignment rows were modified by the transactional QA. All fixtures were rolled back.

### Database transactional QA: PASS

As an actual authenticated-role impersonation using transaction-local JWT subjects:

- ACTIVE Admin successfully created/renamed Subject; created/edited Assignment; changed its status.
- Six corresponding `AuditLog` actions were verified in the transaction.
- Student ACTIVE membership was rejected for creation with SQLSTATE 42501.
- Admin attempting to write to another classroom was rejected.
- All fixture rows were **rolled back**, leaving no demo academic data.

### Acceptance before marking Phase 2 COMPLETED

1. CI tests green for current PR and no merge conflicts.
2. Owner signs into live GitHub Pages using the existing **verified Admin** account, creates a subject and individual/group assignment, edits a deadline, and changes status; refresh and confirm persistence.
3. Owner signs into live GitHub Pages using the existing **verified Student** account: see only their ACTIVE classroom's classwork, no Admin write UI. Verify unauthorized cross-class reads/writes denied.
4. Verify audit record counts and role at time, confirm no fabricated data or legacy `localStorage` routes are still active.
5. Confirm layout works on narrow viewport and assignment dates display accurately in Asia/Manila.
6. Confirm the Phase 1 email-delivery issue remains separately tracked, not bypassed.

## Phase 3 next: real private file submissions

Phase 3 requires separate security/acceptance work before enabling upload:

- A private Supabase Storage bucket, class-scoped object-key naming and path/RLS policy.
- Server-side authenticated submission creation and immutable `submitted_at` plus snapshot `deadline_at_submission`.
- `Submission` must have exactly one owner: Student XOR Group (existing DB check), and version history must remain consistent.
- `SubmissionVersion` / `File` metadata only after successful authorized upload; never trust browser MIME/name/size alone.
- Enforce `DRAFT`, `SUBMITTED`, `DELETED` rules, upload sizes/allowed types, atomic submit and audit trail, and permissioned download/signing.
- Validate object cleanup, file replacement, and private access under Student, Moderator and Admin roles.

**Do not re-enable the old file-upload demo while this is unfinished.**
