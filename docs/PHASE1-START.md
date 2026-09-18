# Phase 1 — Authentication & Class Membership (started)

**Reference:** PROJECT_ Blue Noelle.docx · Phase 1 roadmap · §4 Authentication & Registration  

**Version:** 0.2 · September 2026  

**Milestone:** *A verified student can securely enter their class.*

## What Phase 1 includes (framework)

- Login, Registration, Invite code, Verification  
- Roles, Class membership, Profiles, Permissions  
- Basic audit logging, Password hashing, Secure sessions, Rate limiting  

## Implemented in this start

| Capability | Status | Notes |
|------------|--------|-------|
| Invite-code validation | Demo | `data/invite-codes.json` + `Phase1.validateInviteCode` |
| Registration → PENDING | Demo | Stored in `localStorage` (`bn_pending_registrations`) |
| Moderator approve / reject | Demo | `moderator.html` queue + audit events |
| Login rate limiting | Demo | Client-side window (replace with server) |
| PENDING cannot log in | Done | Explicit error until approved |
| Password view/edit | Done | **Requires invite code used at registration** |
| Session | Demo | `localStorage` user blob (no password in session) |
| Audit events | Demo | LOGIN_SUCCESS, REGISTRATION_SUBMITTED, USER_APPROVED, USER_REJECTED, PASSWORD_CHANGED |
| Password hashing | **Not yet** | Framework requires hashing — use bcrypt/argon2 on real backend |
| Secure HTTP-only sessions | **Not yet** | Requires backend |

## Cleared seed data (integration hygiene)

- Dashboard assignments, submissions, announcements → empty states  
- Assignments page → empty  
- Moderator pending queue → empty (dynamic)  
- Admin assignment lists / inflated stats → zeroed  
- `data/pending-registrations.json` starts empty  

Staff accounts in `data/roles.json` remain as bootstrap users only.

## Invite codes (bootstrap)

| Code | Use |
|------|-----|
| BN-EDUC2-2026 | Student registration |
| BN-STAFF-2026 | Moderator / Admin bootstrap |
| BN-DEV-2026 | Developer bootstrap |

## Password security UX (product rule)

1. Sidebar shows masked password.  
2. **View** or **Edit** opens invite-code confirmation popup.  
3. User must enter the **same invite code used at registration**.  
4. On success: reveal password or show edit form.  
5. New password min length 8; stored as session override until SQL.

## How to expand / fix

**Create**
- Real API: keep `Phase1.*` method names; swap body to `fetch('/api/...')`.  
- Hash passwords server-side before any persistence.  
- Persist pending rows and memberships in PostgreSQL per `docs/schema.sql`.

**Expand**
- Profile edit (name, student_id) under same auth rules.  
- Invite code admin UI (revoke, regenerate, max_uses).  
- Email notifications deferred (framework).

**Fix**
| Issue | Check |
|-------|--------|
| Cannot view password | Enter exact `invite_code` from account record |
| Pending user can log in | Should be blocked — check `Phase1.login` pending branch |
| Queue not updating | Moderator page must load `phase1-auth.js` and call `renderPendingQueue` |
| Rate limited | Wait 15 minutes or clear `localStorage.bn_login_attempts` |

## Next inside Phase 1

1. Wire backend endpoints + password hashing.  
2. Secure cookie sessions.  
3. Persist audit log to `AuditLog` table.  
4. Moderator verification against real ClassMembership rows.
