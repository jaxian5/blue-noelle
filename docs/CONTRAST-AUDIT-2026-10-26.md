# Blue Noelle · Light/Dark typography contrast audit
**Date:** October 26, 2026
**Branch:** `fix/theme-text-contrast-light-dark-20261026`
**Scope:** Four role palettes × two appearance modes, public authentication and the authenticated classroom pages.
**Status:** CSS source review and WCAG pairwise contrast tests completed; real rendered-browser visual acceptance remains pending.

## Root cause and corrections

The initial dark-mode implementation recolored page surfaces, but several legacy
modules retained fixed navy, grey and link-blue text declarations. They did not
inherit dark-mode variables, creating invisible or low-contrast text on dark
backgrounds. The most visible examples were submission filenames, file-format
picker labels and help text, classroom metadata, account profile forms and
Phase 1 signup/OTP overlays.

- Replace fixed text declarations in `auth.css`, `classwork.css`,
  `classwork-admin.css`, `submissions.css`, `dashboard.css`,
  `account-settings.css`, `workspace-pages.css` and
  `workspace-shell.css` with semantic `--ui-text`, `--ui-muted` and
  `--role-ink` foregrounds.
- Light-mode muted text darkened from `#667c98` to `#536781`;
  dark-mode muted text remains light `#a6b6ce`.
- Keep white text on the role-colored sidebar and hero separate from card text.
- Use paired status colors for info/success/warning/error backgrounds and text,
  covering task states, late deadlines, classwork chips, notices and file labels.
- Align authentication confirmation dialogs, OTP inputs and link text with
  semantic colors. The signup confirmation dialog now uses the current
  surface/background instead of staying white in dark mode.
- Cache-versioned local CSS links are included on the landing, login, register,
  verify email, Dashboard, Classwork, Manage Classwork, Submissions, Member
  Requests, Class Operations and Profile & Security pages, so a fresh deploy
  does not need to wait for stale CSS to expire.

## Reproducible automated contrast testing

`node --test tests/theme-contrast.test.mjs` computes sRGB relative luminance
and (L1 + 0.05)/(L2 + 0.05) WCAG contrast ratios for these cases:

- Main, muted, role link and role accent foregrounds against page, card,
  raised-card and input backgrounds.
- Muted labels and links on role-soft badges.
- All four paired status chips and alerts.
- Sidebar foregrounds against both sidebar gradient endpoints.
- White hero/banner text against both gradient endpoints.
- Selected sidebar labels and primary action labels.

For **four roles × two modes × 28 pairings, 224 checked combinations** all
meet the **WCAG AA 4.5:1 normal text** threshold.

| Role | Light mode minimum | Dark mode minimum |
| --- | ---: | ---: |
| Student (blue) | 4.87:1 | 6.05:1 |
| Moderator (purple) | 4.95:1 | 6.12:1 |
| Admin (indigo) | 5.02:1 | 6.09:1 |
| Developer (silver) | 4.91:1 | 5.39:1 |

Values are rounded to two decimals. Tests calculate from theme variables
declared in the deployed CSS and fail if the minimum drops below 4.5:1.
Additional contract checks require semantic foreground rules across the
known problem selectors and prohibit unscoped global white-text overrides.

**Important qualification:** These are measured CSS foreground/background
pairs, **not exhaustive pixel-level checks of every visible DOM element**.
Alpha overlays, font antialiasing, user-created content, native browser
widgets and interactive focus/hover states still need browser inspection.

## Manual visual acceptance after PR merge

Use existing verified Student and Admin accounts. Check Moderator and verified
Developer accounts if they are available. Record pass/fail and screenshots
(without session tokens, OTPs, passwords or emails).

1. Test both Light and Dark in the Dashboard, Classwork, assignment-format
   picker, submission history (including long filenames), class operations,
   member review and Account settings. Read the tiny labels, not just headings.
2. Open the **sign-up confirmation dialog** on an authorized nonproduction
   test workflow and check both title, instructions and verification link.
   Never repeatedly retry rejected SMTP delivery to generate a dialog.
3. Inspect text in each status: success, error, info, draft, submitted, late
   and unavailable. Check disabled controls, help text and error messages.
4. Test mouse hover, keyboard focus, selected checkboxes, dialogs, form
   validation, mobile sidebar and narrow viewport wrapping.
5. Switch classroom roles while Dark Mode is enabled and verify the role color
   changes without making foreground text unreadable.
6. Confirm all functionality and academic permissions remain unchanged.
   This work only modifies presentation styles and tests.

No changes to Auth, email delivery, classwork RPCs, database schema or private
Storage security were made.
