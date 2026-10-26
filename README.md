# PROJECT: Blue Noelle

A private, multi-class classroom platform hosted on **GitHub Pages**, using **Supabase Auth, PostgreSQL, guarded RPCs, and private Supabase Storage**. The initial deployment stays on free services.

> **Release snapshot · October 26, 2026**
>
> - **Phase 0:** architecture accepted; the executable database schema lives under `supabase/migrations/`.
> - **Phase 1:** class-scoped Auth, Admin-owned classrooms and invitation/approval flows implemented and previously accepted. **Email deliverability is on operational hold**: Gmail rejected some Brevo messages (`550 5.7.1`) and one Outlook message was not visible despite a “Delivered” event. **New public self-service signup and password recovery are not release-ready.** Existing confirmed sessions can use later phases. Do not disable confirmation or use privileged keys in the browser.
> - **Phase 2:** audited Subjects and Assignments, a live multi-class dashboard and Admin tools are **merged into `main`** (PRs [#20](https://github.com/jaxian5/blue-noelle/pull/20), [#21](https://github.com/jaxian5/blue-noelle/pull/21), [#24](https://github.com/jaxian5/blue-noelle/pull/24)). Automated and rolled-back database tests passed. The owner completed an initial live testing round and provisionally approved the phase; final browser sign-off is still pending.
> - **Phase 3:** private Storage, versioned individual/group submissions, role-scoped review and guarded upload/finalize/submit RPCs are **merged into `main`** (PR [#23](https://github.com/jaxian5/blue-noelle/pull/23)); database migrations are deployed and CI is green. The owner provisionally approved Phase 3 after initial live testing. Final real-byte integrity and independent cross-account Storage isolation evidence remain required before release acceptance.
> - **Later phases:** chat, announcements, notifications and compilation remain **deny-by-default schema placeholders** until separately implemented and tested.

## Appearance: role colors and Dark Mode

Blue Noelle now has a **site-wide light/dark appearance toggle**. The first
visit follows the device's color-scheme preference. Manual Light/Dark choice
is stored locally as an appearance preference and persists across every
canonical page, without affecting classwork or permissions.

- **Student:** blue
- **Moderator:** purple
- **Admin:** indigo
- **Developer:** silver

The active class membership selects the classroom palette. Developer silver
requires the protected `User.is_developer` flag and overrides only the
**appearance**, never class privileges. The shared sidebar, academic pages,
submissions, profile settings and Phase 1 public screens all support dark mode.
Details and browser checks are documented in
[Role palettes & Dark Mode](docs/ROLE-PALETTES-DARK-MODE-2026-10-26.md).

## Signed-in workspaces

The public homepage presents **Sign in** and **Create an account** only.
A successful login opens `pages/dashboard.html` directly, while
`pages/account.html` provides **Profile & Security** settings for users with
ACTIVE classroom membership. Here they can update their display name,
change their password after confirming the current password, and manage a
private 2 MiB JPG/PNG/WebP avatar. Accounts awaiting class access instead
see enrollment/approval guidance. The email address and membership roles
remain read-only. This work uses migration
`20261025232001_account_settings_private_avatars.sql` and is tracked in
[Account settings acceptance](docs/ACCOUNT-SETTINGS-ACCEPTANCE-2026-10-26.md).



Successful sign-in now opens [Dashboard](pages/dashboard.html), not the
Phase 1 [My Account](pages/account.html) enrollment center. The same
authenticated dashboard renders a **Student study overview** or an
**Admin operations overview** depending on the ACTIVE role in the
selected classroom; Moderators have classwork reading and authorized
staff navigation. The UI stays connected to Supabase Auth, RLS and
guarded RPCs. Signed-in accounts without an ACTIVE membership see an
enrollment/approval entry point instead of fictional classroom data.

The Phase 1 sign-in, signup and OTP page designs have not changed.
See [post-login workspace specification](docs/POST-LOGIN-WORKSPACES-2026-10-26.md).
This frontend redesign does **not** count as Phase 2/3 final live acceptance.

## Canonical production routes

| Workflow | Entry |
| --- | --- |
| Sign in / register / OTP | [Sign in](pages/login.html) · [Register](pages/register.html) · [Verify email](pages/verify-email.html) |
| Profile & security (or enrollment if no ACTIVE class) | [My Account](pages/account.html) |
| Classroom overview | [Live dashboard](pages/dashboard.html) |
| Read subjects and assignments | [Classwork](pages/classwork.html) |
| Admin subject/assignment management | [Manage classwork](pages/admin-classwork.html) |
| Student submissions / authorized staff review | [Private submissions](pages/submission.html) (requires `?assignment=<uuid>` from a real assignment link) |
| Staff registration review | [Class staff](pages/phase1-class-staff.html) |
| Classroom roster and weekly scheduling | [Schedule & members](pages/class-operations.html) |

Production pages use **Supabase Auth + class membership RLS**. The browser may use only public Supabase URL and publishable key; never database passwords, `sb_secret_*`, or the service-role key.

## Class Operations and Phase 4 readiness

The Schedule & Members screen is being repaired through
[PR #32](https://github.com/jaxian5/blue-noelle/pull/32), with readable
class names, Admin schedule operations, authorized registration reviews and
error isolation between the roster/weekly schedule/dated exceptions.
**Database security repairs are already deployed:** migration
`20261026015109_class_operations_least_privilege_and_audit.sql` removes
RLS-bypassing schedule `TRUNCATE` privileges and adds atomic AuditLog entries
for all schedule changes. Do not reapply the deployed migration under a
different version.

The Phase 4 Class Clock (current/next class, countdown, per-date exception
behavior), overlap handling and full calendar semantics are **not yet
implemented**. See the [pre-Phase 4 audit](docs/PRE-PHASE4-AUDIT-2026-10-26.md).
A passing CI/database test is distinct from real browser acceptance.

## Architectural rules

> The database enforces invariants. The backend enforces business rules. The frontend enforces usability.

- **Identity:** Supabase Auth owns credentials/sessions. `ClassMembership` determines ACTIVE Student/Moderator/Admin authorization. `User.account_type` is not a substitute for class-scoped membership.
- **Business rules:** guarded functions in private `bn_private` validate `auth.uid()`, role and class on every privileged operation. Public wrappers are narrow. **No direct browser writes** to `Subject`, `Assignment`, `Submission`, `SubmissionVersion` or `File`.
- **Storage:** the `bn-submissions` bucket is **private**. Upload keys originate from guarded RPCs and Storage RLS authorizes uploads/downloads. No public file URLs, no reliance on opaque paths alone for protection. Each submitted version is independent; submitted timestamps and deadline snapshots are server-written. Live Storage acceptance remains open.
- **Invariants:** submission owner is Student XOR Group; audit retains `actor_role_at_time`; deadlines are stored as UTC timestamps and displayed in Asia/Manila; compilation is distinct from a submission version.
- **Later phases:** a table alone is not an enabled feature. Group/announcement/chat/notification/compilation capability needs its own authorized APIs, UI and acceptance gate. Phase 3 assignment groups are an implemented exception; chat, announcements, notifications and compilation remain inactive.

## Historical prototype isolation

`data/roles.json`, `data/assignments.json`, `data/invite-codes.json`, `js/core.js`, `js/phase1-auth.js` and `js/phase2-assignments.js` are **historical development artifacts**. Their sample credentials/invites are not real users. **Never import, activate or copy them into Supabase.** The canonical production pages do not load these scripts. The former local-data import screen has been retired because its direct table inserts are incompatible with mandatory audited RPCs.

The old `docs/schema.sql` and local-disk storage concept describe early planning, **not** the executable production backend. [ADR-0001](docs/ADR-0001-supabase-architecture.md) records the move to Supabase; [storage specification](docs/storage-spec.md) preserves the original intent with a current implementation note.

## Developer workflow

1. Implement schema/security changes as ordered migrations under `supabase/migrations/`, with RLS, least privilege, RPC authorization and auditable mutations. Never let a frontend client bypass the backend.
2. Update the relevant permission matrix and documentation when introducing a feature, and add positive and negative authorization tests.
3. Test CI and rolled-back database invariants. For Storage or other external effects, complete real-browser end-to-end acceptance, not just mocked tests.
4. Merge a reviewed PR, verify GitHub Pages deployment, then record the actual release/acceptance decision separately.

## Release and implementation references

- [Architecture decision](docs/ADR-0001-supabase-architecture.md) · [Phase 0 acceptance](docs/PHASE0-COMPLETE.md)
- [Phase 1 completion and email hold](docs/PHASE1-COMPLETE.md) · [Email/Brevo runbook](docs/EMAIL-OTP-BREVO-SETUP.md)
- [Phase 2 production](docs/PHASE2-PRODUCTION-2026-10-25.md) · [Phase 2 browser acceptance](docs/PHASE2-FINAL-ACCEPTANCE.md)
- [Phase 3 implementation and security gate](docs/PHASE3-PRODUCTION-2026-10-25.md)

**Long-term philosophy:** Upload → Organize → Submit/Share → Compile → Download → Track. Each step must become a real authorized feature before it is advertised as available.
