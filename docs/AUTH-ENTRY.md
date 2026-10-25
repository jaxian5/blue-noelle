# Blue Noelle: Single Auth Entry Architecture (Phase 1)

> **UPDATE 2026-10-25:** Registration now offers Student or Admin. After confirmation, a Student redeems an invite; an Admin creates one owned class. See [Multi-Class Phase 1](MULTICLASS-PHASE1.md); the Student-only flow described below is historical context.

**As of 2026-10-25 · PR replacing the legacy login and register forms**

## Canonical navigation

| Entry | URL | Responsibility |
| --- | --- | --- |
| Landing | `/index.html` | Choose Sign in or Create account |
| Sign in | `/pages/login.html` | Supabase Auth email/password, recovery request and new password form |
| Register | `/pages/register.html` | Student/Admin signup and creation of a real Supabase Auth account |
| Verify email | `/pages/verify-email.html` | Eight-digit OTP entry, resend countdown and Supabase verification |
| My Account | `/pages/account.html` | Authenticated session, class-scoped membership statuses, sign out and privileged navigation |
| Class staff | `/pages/phase1-class-staff.html` | Moderator/Admin pending review, Admin invitation creation |
| Class operations | `/pages/class-operations.html` | Active officer scheduling and member management (no separate login) |

Old pages `/pages/phase1-onboarding.html` and `/pages/supabase-auth.html` now redirect to the canonical registration/sign-in pages. They're kept as lightweight redirects to preserve links.

## New post-signup eight-digit email verification

**Feature pending deployment:** The existing signup alert now offers **Enter verification code**, opening `pages/verify-email.html`. The user enters a eight-digit code sent by Brevo (external SMTP) and validated using Supabase Auth `verifyOtp({email,token,type:"email"})`. The code is never stored in app data. After successful verification the auto-issued session is signed out and the user selects **Continue to Sign-In**. A wrong or expired code does not authenticate the account; resend uses the `signup` type and a visible 60-second UI cooldown. Email confirmation must stay enabled.

**Deployment prerequisite:** Supabase's **Confirm signup** template must be changed from `{{ .ConfirmationURL }}` to `{{ .Token }}` before deploying this UI. Copy [EMAIL-OTP-TEMPLATE.html](EMAIL-OTP-TEMPLATE.html) into Authentication → Email Templates → Confirm signup and perform a real new-account delivery test. See [Brevo setup](EMAIL-OTP-BREVO-SETUP.md).

## Registration sequence, following Phase 1 framework

1. **CREATE ACCOUNT:** real Supabase Auth `signUp`. Profile trigger populates `public."User"`. The browser never writes passwords into Blue Noelle JSON or localStorage.
2. **VERIFY EMAIL:** enter the eight-digit code on `/pages/verify-email.html`; after successful Supabase verification, proceed to sign in.
3. **SIGN IN:** Supabase Auth `signInWithPassword` and authenticated session.
4. **JOIN CLASS:** enter a private class code + username at `register.html`. Server `bn_join_class` requires email confirmation, validates invitation and inserts Student/PENDING membership. No class access on signup alone.
5. **OFFICER REVIEW:** `phase1-class-staff.html` checks ACTIVE Moderator/Admin membership in the selected class. An authorized officer approves/rejects in the database.
6. **MY ACCOUNT:** student refreshes `account.html` to view PENDING, REJECTED, REMOVED, or ACTIVE. Only ACTIVE staff see links to privileged interfaces.
7. **CLASSWORK:** intentionally *not routed* to localStorage legacy dashboards. Phase 2 remains unintegrated; active Student accounts see an accurate coming-soon notice until shared assignments use Supabase.

Authentication status is **not** read from localStorage `bn_current_user`, URL-supplied roles, or user-editable Auth metadata. The canonical entry pages remove the stale demo identity key on load. Supabase Auth may internally persist its own session tokens in browser storage; those are not the deprecated demo sessions.

## Password recovery
Login page sends `auth.resetPasswordForEmail(email,{redirectTo})` to `/pages/login.html?mode=recovery`. On a valid authenticated recovery callback, users choose a new password through `auth.updateUser({password})`. No plaintext password is displayed, stored in app data, or returned to administrators.

## Supabase dashboard configuration required before live email testing

Set the **Site URL** and **Redirect URLs** in Supabase Authentication → URL Configuration to the exact deployment host and the login routes, including:

- `<your deployed base>/pages/login.html?verified=1`
- `<your deployed base>/pages/login.html?mode=recovery`

If GitHub Pages is the deployment target, your base is typically `https://jaxian5.github.io/blue-noelle`, but verify actual hosting before saving the allowlist. Confirmation emails might not deliver to external users without suitable SMTP setup and Auth provider configuration.

## Audit and scope
The original September 18 framework remains authoritative for class-scoped roles, invitation restrictions, and verification. Only the UI entry points changed; Supabase migrations from PR #9 are untouched. `pages/admin.html`, `pages/moderator.html`, `pages/dashboard.html`, and `pages/assignments.html` are **legacy Phase 1/2 UI prototypes**, not yet migrated to the live login and should not be presented as production pages.

## Acceptance checks

- [x] Login page no longer loads `core.js` or `phase1-auth.js` or shows demo accounts.
- [x] Registration page no longer loads legacy `phase1-auth.js`.
- [x] Class Operations no longer asks for a second password.
- [x] Old experimental auth URLs redirect to their canonical screens.
- [x] Sign-in routes to authenticated account center; unauthorized accounts see no staff controls (mock test).
- [x] Pending Student account can't get officer links (mock test).
- [x] Approved Admin account sees officer links (mock test).
- [x] Frontend script syntax and page IDs checked for consistency.
- [ ] Real signup and email confirmation on the deployed host.
- [ ] Password recovery through a real email.
- [ ] Real confirmed Admin bootstrap; issuance and redemption of invite.
- [ ] Moderator approval and rejection with separate real accounts.
- [ ] Cross-class RLS checks and role isolation.
- [ ] Integrate the old academic pages into live Supabase before enabling them as routes.

**Phase 1 is not signed off merely because this interface is ready.** The first Admin bootstrap and real multi-user trials remain the release gate.


## Supabase Free Plan email sending limits

Supabase's built-in authentication email provider has a **project-wide allowance of two authentication emails per hour**, which is quickly exhausted by repeated signups and password-reset tests. A per-user minimum interval also applies. The resulting `email rate limit exceeded` response means the email sender is throttling requests; it is **not** evidence that an invitation was approved or that a new account was successfully registered. The app displays a readable error without a confirmation success dialog. Wait for the allowance to reset or follow a previously received link.

For long-term multiple-class deployment, configure your own SMTP provider or Supabase Send Email hook, which is supported without changing Blue Noelle's class ownership or RLS model. A custom sending service has its own quotas and billing requirements. See [Supabase authentication rate limits](https://supabase.com/docs/guides/auth/rate-limits) and [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp). Do not disable email confirmation as a workaround.

## Phase 2 academic access

Once signed in, ACTIVE members can open `pages/classwork.html` from My Account. It displays only live `Subject` and `Assignment` rows visible through class-scoped RLS. It does **not** load old localStorage demo identities or expose unaudited writes. Phase 2 creation and status updates follow in separate PRs. See [Phase 2 live kickoff](PHASE2-LIVE-KICKOFF-2026-10-25.md).
