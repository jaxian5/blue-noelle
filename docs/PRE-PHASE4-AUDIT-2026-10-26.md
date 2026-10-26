# Blue Noelle · Full-system debugging audit before Phase 4
**Date:** October 26, 2026
**Repository:** `jaxian5/blue-noelle` · **Code branch:** `fix/class-operations-and-prephase4-audit-20261026` · **PR:** #32

## Executive decision

**Phase 4 should not yet be declared started or complete.** Class Operations
needed UI/authorization alignment and a database security correction. Those
repairs have been implemented, with the security migration already deployed,
but post-merge browser confirmation remains necessary. Phase 2/3 were
provisionally approved by the owner after a first live round, not fully
signed off. The remaining Class Clock model needs concrete behavioral rules.

### Severity & outcomes

| Severity | Area | Evidence/finding | Resolution |
| --- | --- | --- | --- |
| CRITICAL | Class scheduling grants | `authenticated` had `TRUNCATE` privileges on ScheduleSlot and ScheduleException, bypassing row-based class isolation if directly invoked. | **FIXED in live DB** by migration 20261026015109; also revoked unnecessary TRIGGER/REFERENCES privileges. |
| CRITICAL | Core academic grants | A broader SQL grant audit found the same RLS-bypassing `TRUNCATE` privileges on the Subject and Assignment tables. | **FIXED in live DB** by migration 20261026020847; kept RLS-scoped SELECT and audited classwork RPCs intact. |
| HIGH | Schedule auditability | Directly written slots/exceptions were guarded by RLS but did not record who changed them in the central AuditLog. | **FIXED in live DB:** atomic AFTER mutation trigger records Admin actor and before/after row images. |
| HIGH | Class Operations membership UX | Old UI offered promoting arbitrary members to Admin and modifying the protected Admin row; current owner guard explicitly prohibits those operations. | **FIXED in PR:** protected owner read-only; existing Student/Moderator changes use guarded `bn_update_member`, pending approvals use `bn_review_registration`. |
| MEDIUM | Class Operations reliability | Large inline script coupled roster, slots and exceptions with `Promise.all`; one failing request prevented all sections from rendering and handlers were bound only afterward. Class selector showed bare UUIDs. | **FIXED in PR:** dedicated controller, independent requests, per-section errors, readable class labels, handlers bound early, explicit default selection/retry. |
| MEDIUM | Exception semantics | Old UI allowed `rescheduled` without replacement times despite schema supporting them. | **FIXED in PR:** replacement start/end fields, both required for Rescheduled and validated for time order. |
| MEDIUM | Deletion visibility | Old schedule deletions treated zero affected rows as success and did not include class ID in the delete filter. | **FIXED in PR:** class-scoped deletion and exact one-row acknowledgement. |
| MEDIUM | UI consistency | Static Account Session panel on an authenticated page, no scoped success/error states, operations selector not recognized by role-aware sidebar theme. | **FIXED in PR:** new Schedule & Members UI and `ops-class` selection ID. |
| OPERATIONAL HOLD | Phase 1 emails | Brevo/Gmail rejection and missing Outlook delivery make new self-service signup/password recovery unreliable. | **OPEN**; maintain email confirmation and admin-assisted legitimate onboarding; do not weaken auth. |
| ACCEPTANCE GATE | Phase 2/3 | Initial live round is provisionally approved, DB tests pass; final authorized browser and real-byte/isolation evidence is still required. | **OPEN** until owner acceptance is recorded. |
| PHASE 4 DESIGN | Timetable logic | No Class Clock displays current/next class; weekly slots do not enforce overlap policy and dated exceptions lack a specific slot/subject target. | **OPEN, intentionally Phase 4 scope.** Define semantics before implementing clock/countdown. |
| SECURITY GATE | Protected SQL privileges | Source and live grants must be checked globally, not only on tables that have an active UI. | **FIXED for current public schema**. Repeat privilege audit before each release. |
| SECURITY SETTINGS | Password controls | Supabase Security Advisor reports leaked-password protection disabled. | **OPEN** Auth setting; consider enabling if available before wider public rollout. Does not justify disabling email confirmation. |
| PERFORMANCE | Foreign-key indexes | Supabase Performance Advisor identifies 34 unindexed foreign keys, including future deny-by-default tables. | **TRACK**; prioritize active classwork/membership/schedule query indexes from measured plans, not speculative mass indexes. |
| DEFENSE-IN-DEPTH | Deny-by-default tables | Supabase reports 12 RLS-enabled tables with no policies; most are intentionally private academic/internal placeholders, not an exposure signal. | **EXPECTED**, keep closed until separate phase implements scoped APIs. |

## Architecture / cross-feature review

### Authentication, class scope and authorization (Phases 0–1)
- The canonical browser routes use Supabase Auth; protected classroom actions use
  ACTIVE ClassMembership role checks or guarded server RPCs.
- Admin class ownership cannot be changed by editing user metadata or a CSS
  palette. `User.is_developer` governs appearance but not classroom powers.
- An enrolled user lands on Dashboard and Profile & Security handles personal
  account settings. Email deliverability remains a distinct operational risk.
- Existing Admin/Student browser sessions are useful for subsequent test gates.
- **Risk not closed:** public first-time enrollment and email-based password
  recovery cannot be treated as reliable while the SMTP issue persists.

### Subjects, assignments and dashboard (Phase 2)
- Subject/assignment mutations pass through audited, class-scoped RPCs.
- Asia/Manila display and input conversions are explicit in the current
  classwork/admin scripts; they do not rely on browser-local timezone.
- The dashboard's class switcher reads ACTIVE membership and restricts
  classwork queries to the selected class.
- Rollback-only Phase 2 SQL test **passed again on October 26, 2026** after
  the Class Operations security migration.
- **Pending:** final real Admin/Student browser sign-off, including external
  timezone settings and refreshing edited classwork.

### File submission, ownership, history (Phase 3)
- Private Storage and guarded versioning APIs remain distinct from ordinary
  public table access, with server-side ownership and content-type restrictions.
- Version 1 versus Version 2 historical submission timestamp/deadline snapshots
  are retained by the deployed repair and regression test.
- Group submission and outsider-authorization database tests have passed in
  rollback-only SQL. The corresponding file-byte Storage API and a separate
  Student account browser test must remain distinct release gates.
- Rollback-only Phase 3 SQL test **passed again on October 26, 2026**.
- Both Phase 2 and Phase 3 rollback tests **passed again after the academic grant revocation**; this did not disable the guarded classwork RPCs.
- **Pending:** owner-recorded real PDF/PNG byte integrity, version history,
  group file isolation, and cross-account browser Storage denial.

### Design consistency and route integrity
- Shared authenticated sidebar, role palettes (Student Blue, Moderator Purple,
  Admin Indigo, Developer Silver) and Light/Dark semantic tokens are merged.
- Previous contrast test audits cover 224 representative role/mode pairs, all
  meeting the 4.5:1 normal-text WCAG AA threshold.
- Class Operations now uses the shared navigation and theme selectors.
- Static local link/asset audit of 16 inspected pages found no missing tracked
  asset (apart from the newly created controller not present in the old main
  tree). The new `tests/site-route-integrity.test.mjs` guards **all 11
  canonical pages** and detects future missing local CSS/JS/routes.
- **Pending:** actual screen-reader, narrow mobile, contrast on computed
  rendered text and cross-role browser visual inspection.

### Database / deployment safety
- Migration `20261026020847_academic_table_least_privilege.sql` is also **already deployed** and removes the unsafe privileges on Subject and Assignment. A current global grant query returns **no TRUNCATE, TRIGGER or REFERENCES privileges for the authenticated role on any public table**.
- Migration `20261026015109_class_operations_least_privilege_and_audit.sql`
  is **already applied to Supabase** and has the same version in the repo.
  Do not replay it under a different name/version.
- New `tests/acceptance/class-operations-db-rollback.sql` passed: Admin
  schedule CRUD, directory, protected RLS, blocked TRUNCATE, exactly four
  audit mutations, and rollback of all fixtures.
- Authenticated users still have authorized SELECT, Admin INSERT and Admin
  DELETE on schedules. There are **no live recurring slots or exceptions
  yet** in the linked environment, so their appearance after creating entries
  must be verified in a real browser.
- No existing academic assignments, submission versions or Storage objects
  were modified by the database tests.

## What Phase 4 must define BEFORE clock implementation

1. **Clock state:** current activity, next activity, precise Manila countdown,
   empty-day state, rest/holiday state, and what users see outside class hours.
2. **Class identity:** associate timetable slots with subjects from the same
   classroom, including what to do when a subject is archived/deleted.
3. **Overlap rules:** allow parallel activities or reject conflicting weekly
   slots. Current DB only guarantees `start_local < end_local` and cannot
   represent an overnight slot. These rules need server-side enforcement if
   overlap is prohibited.
4. **Exception precedence:** decide whether dated Holiday/Cancelled affects the
   entire class day or a particular slot; define what Special and Rescheduled
   mean for conflicting events and replacement times. The current exception
   schema has a class/date and optional replacement times, but no target slot.
5. **Audit and permissions:** retain class-scoped read rights, Admin-only
   schedule writes and atomic audit; the clock itself is read-only for Students.
6. **Acceptance:** two timezones (including Manila), DST-free Manila wall clock,
   Admin and Student sessions, midnight transitions, off-hours, reschedules,
   holidays and multiple classes.

## Automated and browser verification boundaries

**Verified now:** CI (including new Class Operations/controller/route tests);
live database rollback tests for Phases 2/3 and Class Operations; Supabase
grants and migration history. Security/performance advisors inspected.

**Not performed:** actual Cloud Browser navigation as the existing Admin,
Moderator or Student; real file uploads/download byte inspection; end-to-end
Phase 4 current/next class clock, which has not been built.

**Release decision:** merge PR #32, verify Schedule & Members in authenticated
Admin/Moderator browser sessions, and complete Phase 2/3 final acceptance.
Only then begin a separately scoped Phase 4 implementation.

## Advisor references

- Supabase Security Advisor: `auth_leaked_password_protection` warning.
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- RLS-enabled tables without policies are intentional deny-by-default placeholders:
  https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Performance Advisor: 34 unindexed foreign keys in current schema:
  https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
