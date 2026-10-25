# Post-login routing and personal account acceptance · October 26, 2026

## Release behavior

- **Public homepage:** only Sign in and Create an account. The direct Class dashboard CTA was removed.
- **Successful email/password sign-in or existing session on login:** opens `pages/dashboard.html`. The login script has a cache-versioned URL. Phase 1 entry visuals are otherwise unchanged.
- **My Account, with ACTIVE membership:** dedicated profile and security interface. Display name can be saved to `public."User".full_name`, password can be changed via Supabase Auth after current-password confirmation, and JPG/PNG/WebP profile photo can be uploaded to private Storage (`bn-avatars`, 2 MiB maximum). Email is read-only because SMTP delivery remains unreliable.
- **My Account, without ACTIVE membership:** enrollment and pending-approval status instead of academic dashboard-directory buttons. Admin creation/Student invitation redemption remain on the existing registration/enrollment flow. Neither an Admin account_type nor a pending registration grants class access.
- **Dashboard:** shows the owner's private avatar, or the existing initials if no image exists. The photo is fetched from private Storage with the authenticated account.
- **Security:** No public avatar URLs; exact per-user path `<auth.uid()>/avatar`. Self profile edits grant only the `full_name` column. Other profile fields, including account_type/is_developer and class roles, remain server-controlled.

## Automated verification

`tests/account-settings.test.mjs`: checks removal of homepage button, login redirect contract, settings/enrollment separation, name update payload, password confirmation and credential cleanup, private avatar upload/removal, and input restrictions.

`tests/acceptance/account-settings-db-rollback.sql`: **PASS against deployed Supabase**. Run in a trusted SQL connection. Verifies owner name update, denial of account_type updates, owner-only private avatar Storage metadata access and cross-account denial. All fixture changes are rolled back.

Supabase deployed migration version: `20261025232001_account_settings_private_avatars.sql`.

## Browser sign-off still required

After PR merge and Pages deployment, use existing verified Admin and Student accounts in separate browser profiles:

1. Start from `index.html`. Confirm the only actions are Sign in and Create an account.
2. Sign in on `pages/login.html`. Check immediate redirect to `pages/dashboard.html`, without opening My Account. Repeat with an already-signed-in session. If a stale redirect persists, hard refresh the login page once.
3. Open My Account. With ACTIVE membership, confirm there are only personal profile and security settings, not the old enrollment directory.
4. Change display name; refresh both Account and Dashboard. Confirm the name persists.
5. Upload a small real JPG/PNG/WebP, refresh Account and Dashboard, and verify the photo. Remove photo and confirm initials return. Cross-account reads must fail.
6. Change the password with the current password; sign out and sign in using the new password. Old password should no longer work.
7. Verify a non-member account sees only enrollment/pending approval, and no classwork data.
8. Inspect mobile layout, keyboard navigation and error feedback. Do not paste passwords or session tokens into a ticket.

**The SQL integration test uses Storage metadata, not real image bytes.** This PR does not complete Phase 2/3 live browser acceptance or repair email delivery.
