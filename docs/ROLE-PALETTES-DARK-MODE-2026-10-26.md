# Blue Noelle · Four-role color system and Dark Mode
**Date:** October 26, 2026
**Implementation:** PR #30 · **Acceptance:** automated tests complete, signed-in browser contrast/accessibility review outstanding.

## Role palette

| Role | Light primary | Dark accent | Sidebar character |
| --- | --- | --- | --- |
| Student | Blue `#245bc7` | Sky blue `#74b9ff` | Deep ocean navy |
| Moderator | Purple `#7746c7` | Lavender `#d1a0ff` | Aubergine |
| Admin | Indigo `#514bd5` | Periwinkle `#a9a1ff` | Midnight indigo |
| Developer | Silver/slate `#51647c` | Silver `#d4dbe7` | Graphite |

The palette changes the left sidebar, selected state, identity avatar, hero gradients,
buttons, shortcuts, chips, assignment form accents, notices, and focus/highlight color.
Dark mode changes the **actual page surfaces**, including forms, tables, dialogues,
private submissions, account settings, public sign-in/registration and the landing page,
not merely the sidebar.

## Trust and role precedence

- Color selection is **cosmetic only**. All actions retain existing Supabase RLS
  and private, class-scoped RPC controls.
- For authenticated classroom users, the selected ACTIVE `ClassMembership.role`
  determines blue/purple/indigo. A user with multiple classes can therefore have
  a Student-blue classroom and an Admin-indigo classroom.
- The silver palette is reserved for an authenticated profile whose protected
  `public."User".is_developer` boolean is true. Developer color overrides the
  role palette, **not** the permissions of the current class.
- No role or Developer capability is read from client-set user metadata, a URL
  parameter, a CSS toggle, or localStorage. Tampering with the theme DOM cannot
  grant Admin or Developer privileges.

## Preference and accessibility

- `js/theme.js` runs near the top of every canonical page before the stylesheets
  and chooses `light`/`dark` from the saved preference or the operating
  system's `prefers-color-scheme`.
- Only the **display choice**, under the key `bn-ui-color-mode-v1`, is retained
  locally. The toggle on signed-in pages lives in the top bar; public pages show
  a small floating appearance toggle. It supports keyboard operation, an
  accessible action label and pressed state. No color mode is sent to Supabase.
- Buttons, form controls, alerts, inputs and modals adapt to dark mode. Reduced
  motion preference is respected.
- Role color and theme alone are not authorization indicators: labels still state
  the logged-in class role.

## Checks completed / final browser acceptance

Automated tests: `tests/role-theme.test.mjs` plus existing phase tests under
`tests/*.test.mjs`. No new migrations or modifications to academic records.
GitHub Actions and the PR must pass before merge.

After merging and Pages publication, confirm all of the following in a real browser:

1. In each available role (Student, Moderator, Admin and a **verified Developer**),
   open Dashboard, Classwork, Submission, Account and staff/admin areas where
   authorized. Confirm sidebar, buttons, tabs, metrics and cards use the same
   role palette.
2. Toggle to Dark, refresh and navigate across pages; confirm all surfaces,
   inputs, tables, date pickers, alerts, modal dialogs and uploaded file rows
   stay readable. Toggle back to Light; check persistence and contrast.
3. Start in a fresh browser profile without a saved preference. Verify it
   follows the operating system's appearance. Set a preference and verify
   changes to the OS theme do not override the explicit choice.
4. Switch between classes with different ACTIVE roles. Verify role palette
   changes and that protected Admin/Moderator actions are still checked
   server-side.
5. Check narrow/mobile layouts and keyboard focus. Avoid sharing passwords,
   user tokens, OTPs or privileged keys in screenshots.
6. Continue the separately tracked Phase 2 and 3 final real-upload/download
   and cross-account acceptance checks. Theme testing does not replace those.

**No production database or authentication changes are part of this PR.**
