# Blue Noelle · Eight-digit email verification with Brevo

**Status:** Feature implemented in the OTP verification PR; **production activation requires one manual Supabase email-template change and a real new-account test**. Do not claim it is deployed or successfully delivering codes before these checks.

## Architecture

- GitHub Pages hosts the client (no Brevo web hosting needed).
- Supabase Auth is the identity system. It generates confirmation OTPs via `{{ .Token }}`, validates them via `auth.verifyOtp({email,token,type:'email'})`, and controls expiry, replay and server-side attempt limits.
- Brevo is the **external SMTP delivery service**, authenticated against `bluenoelle.work.gd`. It has its own quota and sender policies; switching provider does not make email unlimited.
- **Do not** store OTPs, passwords, Brevo SMTP credentials or Supabase service-role keys in the website, database application tables, GitHub, query strings or browser storage.
- The only short-lived browser hint is the pending **email address** and client-side resend countdown in `sessionStorage`. Both can be lost safely; the verification page permits entering the email manually. Cooldown is for UX, not a replacement for Supabase rate limits.
- The approved Admin/Student account-type snapshot, one-owned-class constraints, invitation workflow and RLS remain unchanged.

## Required dashboard action: Confirm signup template

1. In Supabase project **zllphzqalkurnibfctyl**, check **Authentication → SMTP Settings**: custom SMTP must be enabled with the Brevo SMTP login, key and authenticated sender address. **Never publish credentials in a PR or screenshot.**
2. Ensure email confirmation is **enabled** under Authentication → Providers → Email.
3. Open **Authentication → Email Templates → Confirm signup**.
4. Set the **Subject** to `Blue Noelle | Verify your email`.
5. Replace the HTML template body with the exact HTML in `docs/EMAIL-OTP-TEMPLATE.html`. The crucial substitution is **`{{ .Token }}`** instead of a link-only `{{ .ConfirmationURL }}`.
6. Save the template. The change is made **inside the Supabase dashboard**, not by pushing a GitHub HTML file. That repository HTML is the source-of-truth template to copy. The connected Supabase plugin currently has no supported Auth email-template configuration action.
7. Review Authentication → Rate Limits. Use reasonable limits that fit Brevo's plan and protect against repeated resend requests. Do **not** disable verification or raise limits arbitrarily.

**Important deployment order:** Save the OTP email template **before merging/deploying** the registration-interface PR, otherwise new users could receive only a confirmation link while the UI asks for a eight-digit code.

## User journey

1. At `pages/register.html`, choose **Student** or **Admin**, enter full name, email and password, and submit.
2. Supabase accepts signup (and Brevo delivers a eight-digit confirmation code). The alert offers **Enter verification code** and opens `pages/verify-email.html`.
3. On the verification page, enter the code into six accessible boxes. Typing, pasting and mobile numeric keyboards are supported.
4. Blue Noelle sends **email + OTP** to Supabase Auth with `type:'email'`. Supabase validates it. The app signs out the verification-created session so the approved next step remains **Sign In**.
5. The user signs in normally. **Admin** creates one owned class; **Student** redeems an invitation and awaits approval.
6. If a code expires or is incorrect, no success message is shown. The user can request a new signup code with the documented `auth.resend({type:'signup',email})` endpoint. The UI waits at least 60 seconds after initial signup or a successful resend and shows a countdown. Server limits remain authoritative.
7. If the verification page opens in a different browser, the user enters the same registration email manually.

**If Supabase email confirmation is disabled**: signup can create a session immediately, so the site continues to the sign-in path rather than showing a false verification challenge. Keep email confirmation **enabled** for the intended production flow.

## Live acceptance checklist (requires new, distinct test identity)

- [ ] Confirm Brevo SMTP is saved, sending domain/sender approved, and the exact template body is live.
- [ ] Create one **new** test Admin or Student identity from the deployed registration page.
- [ ] Confirm email arrives with a **eight-digit code**, not just a clickable verification link. Verify code and expiry against dashboard settings.
- [ ] Check the code-entry screen using typing, paste, backspace, mobile viewport, and keyboard.
- [ ] Attempt incorrect code: remains unverified. Enter correct code: successful verification and sign-in redirect.
- [ ] Verify Admin/Student account type is unchanged by verification and old active accounts are unaffected.
- [ ] Resend only when necessary; verify rate-limit feedback, countdown and newly delivered code.
- [ ] Sign in with original password; ensure permission scopes follow existing class memberships.
- [ ] Review Supabase Auth email logs for delivery errors, if any. Do not publish email addresses or OTP tokens in bug reports.

## References

- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/reference/javascript/auth-verifyotp
- https://supabase.com/docs/reference/javascript/auth-resend
- https://supabase.com/docs/guides/auth/auth-smtp


## Duplicate signup and missing email troubleshooting (2026-10-25)

**Do not reveal whether an arbitrary entered email exists in Supabase Auth.** With email confirmations enabled, Supabase may respond HTTP 200 to a repeated signup for an existing account. The response cannot be treated as proof of email dispatch or account creation. An unauthenticated preflight API endpoint that returns "already registered" would enable account enumeration and is intentionally not implemented.

The browser instead offers contextual recovery routes:
- Already registered and confirmed? **Sign In** using the existing password; choose **Forgot password** if necessary.
- Registered but not yet confirmed? Open **Verify Email**, enter any valid code already received, or request a new code after the cooldown (subject to Supabase server limits).
- Fresh signup? Open the OTP email. Do not click Create Account repeatedly to "resend" a code.
- Received no message? Inspect **Brevo → Transactional → Email → Logs**. Distinguish *sent*, *delivered*, *deferred*, *blocked*, and *bounced* events. A smaller sending allowance does **not** prove inbox delivery. Check spam/junk and the sender's authenticated domain. Do not include addresses, codes, full logs or SMTP credentials in public issues.

**Observed (privacy-preserving) diagnostics:** An October 25 Supabase Auth log inspection identified HTTP 200 events for a new confirmation request, a repeated signup, a resend request, and a password-recovery request. These confirm requests reached Supabase; only Brevo's delivery logs and the user's inbox can establish delivery. The live auth platform already contains verified and unverified accounts. Do not infer the status of a particular email from these aggregates.

**Email template prerequisite:** The Supabase *Confirm signup* template must contain `{{ .Token }}` instead of solely `{{ .ConfirmationURL }}`; otherwise the interface will ask for a code that is not present in the email. The template source lives in `docs/EMAIL-OTP-TEMPLATE.html`. Modifying the repository file alone does not update Supabase's live email template.

## OTP length synchronization

**October 25, 2026:** The project owner observed an **eight-digit** code from the configured Supabase/Brevo email flow. The website's prior six-box frontend would reject it before calling Supabase. The current verification UI, adapter validation and regression tests now expect **exactly eight numeric digits**.

Supabase's documented default email OTP length is **6** and the Auth platform supports configured lengths from **6 to 10** (see [Supabase CLI email OTP settings](https://supabase.com/docs/guides/local-development/cli/config#authemailotp_length)). This frontend must match the configured backend length. If the Supabase OTP length is later changed, update the interface, the API check, copy and tests in the same pull request. **The email template's `{{ .Token }}` placeholder remains unchanged**: it supplies the actual generated token; its HTML does not set the token length.

Do not paste real verification codes into GitHub issues, this repository, or support screenshots. Use a real inbox that you control for subsequent end-to-end tests, not a deliberately nonexistent address, because rejected emails can create hard bounces and affect sender reputation.


## Account-status popups and anti-enumeration behavior (2026-10-25)

Blue Noelle now reuses its centered signup confirmation dialog for **two distinct states only when Supabase explicitly reports them**:
- `user_already_exists` (or equivalent explicit duplicate error) → **Email already registered**, with **Continue to Sign-In** and **Not verified? Enter a code** actions.
- `email_not_confirmed` (or equivalent explicit unverified error) → **Email not verified**, with the **Enter verification code** action.
- On the **Sign In** page, a password login attempt that receives Supabase `email_not_confirmed` displays a separate large **Email not verified** dialog and prompts code entry.
- On successful-but-ambiguous signup responses, the dialogue must NOT claim an address exists or is confirmed. Supabase can return a synthetic successful result for an already-registered email to prevent public email enumeration. The neutral alert offers **Enter verification code** and **Already have an account? Sign In**.

We intentionally **do not expose an unauthenticated endpoint that checks arbitrary email-address existence**. Even a private SQL helper called through a public RPC would turn the registration form into a directory of students' emails. No prior auth identities are modified by this UX change.

## Brevo: Gmail unsolicited-message rejection

A real October 25 password-reset test returned **Gmail SMTP `550 5.7.1`** with a diagnostic indicating likely unsolicited email. Brevo recorded it as a **soft bounce**, even though SMTP 550 is a permanent rejection code. **Sent** means Brevo attempted transmission, not inbox delivery. This is distinct from the intentionally nonexistent inbox's `550 5.1.1` hard bounce.

Before requesting more emails, review Brevo's authenticated domain and sender status for `bluenoelle.work.gd`. Ensure **DKIM**, **SPF**, and **DMARC** authentication and From-address alignment satisfy Gmail sender guidelines. A Brevo authentication badge alone does not guarantee Gmail will accept messages; a new free subdomain and shared sender-IP reputation may also be relevant, but are not proven causes without further diagnostics. If Gmail continues rejecting genuine confirmation and recovery emails, send the **exact redacted** SMTP response (without recipient addresses, account data or OTPs) to Brevo Support. Avoid repeated sends to nonexistent recipients.

References: https://help.brevo.com/hc/en-us/articles/36039161138706-Troubleshooting-Deliverability-issues-with-Gmail and https://support.google.com/mail/answer/81126
