# Blue Noelle: Phase 1 Live Registration Implementation

> **MULTI-CLASS UPDATE (2026-10-25):** The original manual "first administrator bootstrap" guidance further below is **superseded**. Admin signup now creates a new Admin account type, and the confirmed Admin creates their own class using `bn_create_owned_class`. Students continue joining by invitation. Consult [Multi-Class Phase 1](MULTICLASS-PHASE1.md) for the current authoritative flow. Do not run the old bootstrap SQL.

**Source:** `PROJECT_ Blue Noelle.docx`, September 18, 2026, §§3–4, 14–15, 19–20.

**Status 2026-10-25:** core PostgreSQL/RPC workflow implemented; canonical login and registration UI added for controlled testing. **Not production certified until the sign-up/confirm/approve/active path passes real multi-account tests.** The canonical login and registration pages now use Supabase Auth, not the old localStorage demo. Historical academic dashboards remain unintegrated.

## Flow (authoritative)
1. A **real, verified Admin** issues a cryptographically random **Student** invitation using `bn_issue_class_invite`. Database saves only SHA-256 hash and restrictions, never the raw code.
2. A student creates a real Supabase Auth account using email, password and full name at `pages/register.html`. Supabase stores password credentials, not our `User` table.
3. Student verifies email (when confirmation required), signs in at `pages/login.html`, then enters code, username and Student ID at `pages/register.html` via `bn_join_class`. Raw code isn't kept in localStorage.
4. PostgreSQL validates authenticated email, rate-limit history (8 attempts / 15 minutes), code hash, expiry, revocation, max uses, duplicate membership, username and uniqueness. Successful redemption creates exactly one **PENDING** Student membership and increments usage, atomically.
5. An ACTIVE Moderator or Admin in **the matching class** views the queue using `bn_pending_class_registrations` at `pages/phase1-class-staff.html`.
6. Staff approves/rejects using `bn_review_registration`. PostgreSQL checks role and pending state and stores `USER_APPROVED`/`USER_REJECTED` in `ClassActionLog` and full `AuditLog` with actor role at event time.
7. The student refreshes the membership view at `pages/account.html`. Only **ACTIVE** membership satisfies RLS for Class, Subject and Assignment reads.

**Security note:** This two-step email signup and invite redemption differs in ordering from the single-form demo, because server-side code validation must occur *after* a trusted Auth session exists. A Supabase Auth user alone does not have class access.

## Backend and UI contracts

| Component | Name |
| --- | --- |
| Live migration | `supabase/migrations/20261025032100_phase1_invited_registration_and_review.sql` |
| RPC issue high-entropy code | `bn_issue_class_invite(p_class,p_max_uses,p_expires_at)` |
| RPC redeem code | `bn_join_class(p_code,p_username,p_student_id)` |
| RPC list pending | `bn_pending_class_registrations(p_class)` |
| RPC review | `bn_review_registration(p_membership,p_approve)` |
| App adapter | `js/phase1-live.js` |
| Student flow | `pages/register.html`, `pages/login.html`, `pages/account.html` |
| Staff flow | `pages/phase1-class-staff.html` |

The RPC entry points are SECURITY INVOKER in public; internal elevated functions live in non-API `bn_private`. All public entry points refuse anonymous role EXECUTE. Admin/Moderator authorization is verified on the server. `bn_private."InviteAttempt"` is not available through the browser Data API.

## First administrator bootstrap, ONCE, using trusted Supabase SQL editor
No Admin can be created by signup or by knowing a demo code. There are currently **zero** Auth users and active memberships. To configure the first Admin safely:

1. Open `pages/register.html` after deployment and sign up with the **actual administrator's** email and a unique private password.
2. Confirm the email and sign in; note that you must not use a demo account from `data/roles.json`.
3. In Supabase's trusted SQL editor, find the exact `auth.users.id` of that account and its `public."User"` profile. Replace the two explicit placeholders below with values you have verified:

```sql
-- Run exactly once after verifying the account email and target classroom.
-- Choose YOUR real class id, not a sample class by accident.
insert into public."ClassMembership"(user_id,class_id,role,status,joined_at)
select u.id, c.id, 'Admin', 'ACTIVE', now()
from auth.users u
join public."User" p on p.id=u.id
cross join public."Class" c
where u.id = 'REPLACE_WITH_VERIFIED_AUTH_USER_UUID'::uuid
  and c.id = 'REPLACE_WITH_VERIFIED_CLASS_UUID'::uuid
  and u.email_confirmed_at is not null
on conflict(user_id,class_id) do nothing;
```

This is an intentional first-time trust bootstrap, not an ongoing administrative workflow. Thereafter, class officers issue invites and review memberships through the website. Never provide an unauthenticated admin bootstrap code or expose service-role keys in browser code.

## Required testing before retiring demo login
- [ ] Supabase Auth signup, email confirmation and sign-in via real browser.
- [ ] Auth trigger creates `public."User"` profile with correct UUID.
- [ ] Admin issues invite; plaintext never persists in DB; valid code only creates Student/PENDING.
- [ ] Invalid/expired/revoked/used-up codes fail without class membership; attempts throttle.
- [ ] Duplicate redemption does not create duplicates or consume extra uses.
- [ ] Moderator sees **own-class** queue, not another class's students.
- [ ] Moderator can approve and reject; normal Student cannot call either function.
- [ ] Full audit rows record USER_APPROVED and USER_REJECTED with historical actor roles.
- [ ] Pending and rejected accounts cannot see class content; ACTIVE can.
- [ ] Same identity can have different roles in different classes.
- [ ] Password resets / sign-outs, redirect URLs, email deliverability, and project Auth rate limits checked (see [canonical auth entry](AUTH-ENTRY.md)).
- [ ] Cross-device, mobile, empty states, network failure and accessibility checks.

**Do not invite real students or link to the legacy academic dashboard until these tests pass. The canonical `pages/login.html` and `pages/register.html` now point only to Supabase Auth; verification and production acceptance remain open.** Password visibility/editing through localStorage is legacy-demo-only and must be removed during cutover.


## Verified developer tests (2026-10-25)

| Test | Result |
| --- | --- |
| Migrations applied to connected Supabase project | PASS: `20261025032100_phase1_invited_registration_and_review` and `20261025032803_move_privileged_management_rpcs_private` |
| Public registration RPCs allow `authenticated` | PASS |
| Public registration RPCs deny `anon` | PASS (verified `has_function_privilege`) |
| Private invite-attempt table inaccessible to browser roles | PASS |
| Unauthorized/no-session invite redemption and issue | PASS (negative tests) |
| Unauthorized/no-session pending queue lookup | PASS (negative test) |
| SHA-256 and CSPRNG available | PASS (`extensions.digest`, `extensions.gen_random_bytes`) |
| Existing public application tables retain RLS | PASS: 19/19 |
| Page scripts parse / frontend adapter smoke | PASS (static syntax and mocked RPC arguments) |
| Real student, Moderator, Admin lifecycle | PENDING real confirmed accounts |
| Email redirect and Auth deliverability | PENDING deployment/configuration |
| Supabase Security Advisor | **No security WARN/ERROR** after migration `20261025032803`: the original 3 public SECURITY DEFINER RPCs were replaced with SECURITY INVOKER wrappers; elevated implementations now live privately. INFO notices remain for 12 intentionally deny-by-default tables, including the private invite-attempt table. |

For details, see [Supabase's production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) and [database security linter](https://supabase.com/docs/guides/database/database-linter).
