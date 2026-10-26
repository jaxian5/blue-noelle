# Class Operations: Schedule & Members
**Reconciled: October 26, 2026 · PR #32**

## Current integration

The canonical `pages/class-operations.html` page loads
`js/class-operations.js` (authenticated Supabase adapter) and
`js/class-operations-ui.js` (accessible, responsive controller), using the
shared authenticated sidebar. There is no second login form, demo session,
or localStorage-based schedule/roster.

Access is **class-scoped**, not determined by a browser label:

| Operation | Student | ACTIVE Moderator | ACTIVE Admin |
| --- | --- | --- | --- |
| Visit Schedule & Members admin/staff screen | No | Yes | Yes |
| Read current class roster | No | Yes | Yes |
| Read own class schedule via RLS | Yes | Yes | Yes |
| Review PENDING Student registration | No | Yes | Yes |
| Edit Student/Moderator membership | No | No | Yes |
| Change protected owned-class Admin membership | No | No | No |
| Create/delete weekly slots and dated exceptions | No | No | Yes |
| Truncate an entire scheduling table | No | No | No |

## User workflow

1. Sign in on the canonical `pages/login.html` page.
2. Open **Schedule & Members** from the authenticated sidebar.
3. The class picker lists **only ACTIVE Admin or Moderator memberships** and
   uses the human-readable class name where it can be loaded.
4. Each section loads independently: roster, weekly slots, exceptions.
   A failure in one shows a scoped message and does not erase the others.
5. Admin schedules use 24-hour Manila wall-clock times. Each weekly slot
   must have an end after its start. Overnight slots are not yet supported.
6. Date exceptions can be Holiday, Cancelled, Special or Rescheduled.
   Rescheduled exceptions need both replacement start and end times.
   They are stored but **not yet interpreted by a Class Clock**.
7. The page checks Admin/Moderator role for UI affordances; the backend
   independently enforces actual operations with RLS and guarded RPCs.
8. Registration approvals use `bn_review_registration`, while edits to
   existing Student/Moderator memberships use `bn_update_member`.
   The class owner can never be demoted or removed through this page.
9. Mutating actions show success only after Supabase acknowledges the write.
   Deletes are scoped to the selected class and must affect one row.

## Database security: repaired and deployed

Early class-operations migrations granted `TRUNCATE`, `TRIGGER` and
`REFERENCES` on `ScheduleSlot` and `ScheduleException` to authenticated.
PostgreSQL `TRUNCATE` is not protected by per-row RLS checks. This was a
security risk, irrespective of whether the browser exposed such a button.

Migration `20261026015109_class_operations_least_privilege_and_audit.sql`
is **deployed to Supabase**. It revokes those unnecessary privileges,
preserves Admin-scoped INSERT/DELETE and member-scoped SELECT, and adds
private atomic AFTER INSERT/UPDATE/DELETE triggers that create `AuditLog`
rows for all schedule writes. These rows record the actor, actual Admin role,
class, action, object ID and before/after values. They are deny-by-default
to browser clients, not editable by them.

The rollback-only regression suite at
`tests/acceptance/class-operations-db-rollback.sql` verifies the corrected
grant boundaries, Admin directory lookup, slot/exception creation and
deletion, outsider reads (when another account exists) and four audit rows.
All fixtures and their audit records are rolled back.

## Browser acceptance (not yet confirmed)

Use an already verified ACTIVE Admin and, if available, Moderator in
separate browser sessions after merging PR #32 and GitHub Pages deployment.
Verify class picker, roster, approval, create/delete slot, create/delete
exception with replacement times, the responsive sidebar, dark mode, refresh
persistence, error messages and denied direct URLs as ordinary Students.

**Remaining Phase 4 work:** Class Clock, overlap rules, subject-to-schedule
association and per-date exception resolution. These are not implemented
just because the underlying schedule tables exist. Avoid approving Phase 4
until behavior and tests for those features are defined.

## Operational limitations

Phase 1 SMTP deliverability remains an independent hold; do not disable
email confirmation or expose service-role credentials to work around it.
