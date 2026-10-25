# Blue Noelle · Role-aware post-login workspaces
**Design implementation:** October 26, 2026 · **Scope:** signed-in pages only

## Product decision
Sign-in and an already-authenticated visit to `pages/login.html` now open
`pages/dashboard.html`, **not** the Phase 1 account/membership center.
The signed-in Dashboard is the daily workspace; My Account remains available
as a secondary destination for joining classes, creating the first Admin-owned
class, pending approvals and membership management.

The Phase 1 login, registration and OTP **visual layouts are unchanged**.
Only the successful-login/existing-session/recovery-success destinations in
`js/auth-ui.js` have changed.

## Two distinct dashboards

**ACTIVE Student:** Student-specific welcome and contextual next action, approved
class picker, counts of classes/subjects/open work/due-within-seven-days,
linked open assignments sorted by deadline, subject summary, and a guarded
`bn_p3_details` status for up to six visible assignments. A failed status
lookup is shown as unavailable, never mistakenly as "not submitted".
Each assignment links to the existing private upload/version history UI.

**ACTIVE Admin:** Separate Admin-styled welcome, same class-scoped metrics,
quick actions for Subject creation, Assignment management and membership
review, recent assignments with review links, and a staff-authorized
`bn_class_directory` roster/pending count. There is no fictional reporting,
audit viewer or Phase 4 Class Clock displayed. Authorized administration still
happens in audited existing RPCs.

**ACTIVE Moderator:** Student-style read-only classroom overview plus staff
member-review/operations navigation. No assignment management privileges.

**No ACTIVE membership:** Account owner sees a setup/await-approval message
and a real Continue enrollment link. Admin account type alone never grants
classroom authority.

Multi-class users may switch from an Admin role in Class A to a Student role
in Class B. The dashboard updates both content and navigation for that
specific ACTIVE membership. All data comes through existing Supabase Auth,
RLS SELECT or guarded role checks in RPCs; no local demo assignments or
client-provided role elevation.

## Design vocabulary
- Deep navy navigation rail, bright white working canvas and soft off-white
  surfaces. Student highlights are ocean-blue and teal; Admin highlights are
  violet, without relying on color alone to denote permissions.
- Responsive desktop grid and mobile collapsible navigation.
- Semantic labeled sections, keyboard-visible focus, live status messages,
  safe `textContent` for database-owned fields, and reduced-motion support.
- Post-login Subject/Assignment and Submission pages use
  `css/workspace-pages.css`; Phase 1 public pages remain visually untouched.
- The main Admin/Student dashboard uses `css/dashboard.css` and
  `js/dashboard-live.js`, with the same `pages/dashboard.html` address
  for all ACTIVE roles.

## Acceptance boundaries
`tests/post-login-workspaces.test.mjs` covers successful direct sign-in
redirect, existing-session redirect, role-dependent layout and role switching,
and the absence of demo identity scripts. Existing Phase 2/3 tests must stay
green. This is a frontend PR, not a declaration that Phase 2/3 real-browser
acceptance has passed. Separate owner Admin/Student sessions and real file
bytes still require the acceptance checklist at
`docs/PHASE2-PHASE3-ACCEPTANCE-2026-10-26.md`.

### Human browser review after merging
1. Sign in with existing Admin. Confirm Admin dashboard, recent classwork,
   class selector and staff tools, with no My Account detour.
2. Sign out. Sign in with ACTIVE Student. Confirm Student dashboard, no
   Admin editor links, correct classwork and submission status states.
3. Switch classrooms with different roles (if available); ensure stale
   Admin content disappears. Test browser back/refresh and missing session.
4. Check sidebar navigation, responsive layout, keyboard focus and color
   contrast on desktop/mobile.
5. Then resume separate Phase 2 classwork and Phase 3 Storage **live** acceptance.
