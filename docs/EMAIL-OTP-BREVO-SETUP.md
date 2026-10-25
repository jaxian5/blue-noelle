# Blue Noelle · Six-digit email verification with Brevo

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

**Important deployment order:** Save the OTP email template **before merging/deploying** the registration-interface PR, otherwise new users could receive only a confirmation link while the UI asks for a six-digit code.

## User journey

1. At `pages/register.html`, choose **Student** or **Admin**, enter full name, email and password, and submit.
2. Supabase accepts signup (and Brevo delivers a six-digit confirmation code). The alert offers **Enter verification code** and opens `pages/verify-email.html`.
3. On the verification page, enter the code into six accessible boxes. Typing, pasting and mobile numeric keyboards are supported.
4. Blue Noelle sends **email + OTP** to Supabase Auth with `type:'email'`. Supabase validates it. The app signs out the verification-created session so the approved next step remains **Sign In**.
5. The user signs in normally. **Admin** creates one owned class; **Student** redeems an invitation and awaits approval.
6. If a code expires or is incorrect, no success message is shown. The user can request a new signup code with the documented `auth.resend({type:'signup',email})` endpoint. The UI waits at least 60 seconds after initial signup or a successful resend and shows a countdown. Server limits remain authoritative.
7. If the verification page opens in a different browser, the user enters the same registration email manually.

**If Supabase email confirmation is disabled**: signup can create a session immediately, so the site continues to the sign-in path rather than showing a false verification challenge. Keep email confirmation **enabled** for the intended production flow.

## Live acceptance checklist (requires new, distinct test identity)

- [ ] Confirm Brevo SMTP is saved, sending domain/sender approved, and the exact template body is live.
- [ ] Create one **new** test Admin or Student identity from the deployed registration page.
- [ ] Confirm email arrives with a **six-digit code**, not just a clickable verification link. Verify code and expiry against dashboard settings.
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
