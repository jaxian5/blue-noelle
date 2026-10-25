# Blue Noelle · Phase 2/3 finalization · Acceptance Round 2
**Date:** October 26, 2026 · **Status:** database and CI regressions passed; live browser acceptance remains pending.

## Implementation included in PR #29
- Authenticated left navigation is consistent on Dashboard, Classwork, Manage Classwork, Submissions, Member Requests, Class Operations and Profile & Security. Small screens use collapsible navigation; active links are highlighted. Privileged links appear only with an ACTIVE Admin/Moderator membership and **never** replace database permissions.
- Assignment file formats use a collapsed native details/summary checkbox picker. Documents, images and media are grouped. The summary shows the selection count, with a clear-all action.
- **Zero selected formats = all supported formats** (existing database contract). Selecting formats stores exact MIME strings in `required_file_types`, at most 12. Previously saved nonstandard MIME strings remain selectable and are not silently erased when editing.
- Classwork's heading no longer incorrectly calls the Admin's workspace a Student workspace.

## Automated evidence
- Latest PR branch CI: `node --test tests/*.test.mjs`: **74 passed, 0 failed**.
- **Phase 2 rollback SQL: PASS** against linked live Supabase project on October 26: class-scoped Admin subjects/assignments, edits/status, expected audit trail, Manila deadline, Student/outsider read/write denials.
- **Phase 3 rollback SQL: PASS** against the same Supabase project: Version 1 -> Version 2 historical deadline/timestamp, group-owned versioning, authenticated Storage **metadata** RLS and outsider denials.
- Both SQL tests rolled back their fixtures. No production academic assignment/submission/storage records were changed by the tests.
- Tests in this PR check the new MIME checkbox values are sent unchanged to the existing audited RPC and date conversion remains in Asia/Manila. No new schema, table, bucket or RLS policy is needed.

## Browser acceptance procedure: both existing verified accounts
Use **separate, authenticated Admin and Student browser profiles** after merging PR #29 and after GitHub Pages publishes the merge. Record date, browser, account role, result and evidence. Never save email codes, passwords, bearer tokens or service-role keys.

### Gate A · Navigation and editor UI
1. As Admin, start from the dashboard and visit **Classwork → Manage Classwork → Submissions → Member Requests → Class Operations → Profile & Security**. On every page, the left sidebar remains fixed on desktop; the active route is indicated, and the links navigate back correctly.
2. Repeat on a phone-size viewport. Sidebar navigation collapses, opens with the menu button, is keyboard accessible and does not cover content.
3. Sign in as Student. The same menu is visible, but **Manage Classwork**, **Member Requests** and **Class Operations** are not authorized, and direct URLs to privileged pages must reject access.
4. As Admin, open Manage Classwork. Create an assignment with **PDF** and **PNG** selected under the collapsed formats panel. Confirm the summary shows *2 formats selected*. Save; reload; edit the assignment; verify both checkboxes are still checked.
5. Uncheck PNG, save and reload: the restriction must become PDF-only. Use **Clear selections**, save, reload: the assignment must allow all otherwise supported file types.
6. Verify an existing assignment with uncommon MIME values preserves those values on editing. Try selecting over 12 MIME types and verify the interface enforces the cap.
7. Verify deadline entry and display specifically use **Asia/Manila**, including browsers with non-Manila system timezones.

### Gate B · Phase 2 real persistence and authority
1. Admin creates and edits subject/assignment; Student sees ONLY work in their ACTIVE classroom.
2. Admin changes status OPEN/CLOSED and deadline. Student views should reflect both after refresh. Staff changes must create correct class-scoped audit events.
3. Admin privileges must fail for an ordinary Student (including direct RPC attempts), and outsiders must not read other classes' work.
4. Preserve existing records: use clearly named QA fixtures, and avoid altering genuine coursework. If cleanup must be done, follow the normal application workflow and keep history.

### Gate C · Phase 3 actual Storage and versioning
1. Student uploads a **real** small PDF to a PDF-only assignment. It transitions PENDING → READY, can be submitted, and can be downloaded as identical bytes. Compare `sha256sum` of original and downloaded file.
2. Attempt PNG when only PDF is allowed; the interface must reject it and no file/upload metadata should be created. When PNG is permitted, perform a successful real PNG upload/download.
3. Create submitted Version 1, Admin changes assignment deadline, Student submits Version 2. Verify Version 1's historical submission timestamp and deadline remain unchanged, and Version 2 uses the new deadline.
4. Staff reviews individual and group submissions. Verify only group members can participate in a particular group-owned submission.
5. **Real cross-account denial:** Use a *second* separately verified Student account (not merely the Admin) to attempt access to the first Student's files using its own authenticated browser session. Both Storage reads and submission data must be denied.
6. Refresh/reopen downloaded files, verify expiration/closed-assignment behavior, ensure oversized/unsupported uploads fail, and confirm no browser or storage console errors.

## Release decision
- Round 2 automated regressions: **PASS**.
- Navigation and file checkbox UX live-browser verification: **PENDING** until PR merge and manual sign-off.
- Phase 2 final owner/browser acceptance: **PENDING**.
- Phase 3 final real-byte Storage, version and cross-account acceptance: **PENDING**.
- No change to the separate Phase 1 email-delivery limitation.
