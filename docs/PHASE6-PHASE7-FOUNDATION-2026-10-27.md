# Blue Noelle Phase 6 and Phase 7 Development & Acceptance
**Date:** October 27, 2026
**Review:** Pull Request #36
**Phase 5:** Partial approval only. PR #35 is still open and requires mass
testing and real private file-byte acceptance. These phases do not imply
acceptance of Phase 5.

## Scope and architecture
The dormant `ChatMessage`, `Announcement` and `Notification` tables from
Phase 0 are activated only through tightly scoped, authenticated RPCs.
Direct table REST rights remain revoked to `anon` and `authenticated`; RLS
remains enabled. Privileged `bn_private` functions verify `auth.uid()`
against the target classroom's ACTIVE `ClassMembership` on every operation.
Role colors and Developer cosmetics are **not** an authorization source.

Phase 6 is **classroom discussions**. Phase 7 is **announcements and private,
in-app notifications**. Both use visible-tab periodic refresh and explicit
Refresh buttons, not unsafely exposed Postgres Realtime streams. Email
delivery and device/browser push are not implemented here.

## Phase 6: Classroom Discussions

Entry: `pages/discussions.html`, implemented by `js/discussions.js`
and server migration `20261027021547_phase6_class_discussions.sql`.

- ACTIVE Student, Moderator and Admin can view the **latest 60** class
  messages, load older entries in pages of up to 60 and post text.
- Replies reference `parent_id`. The existing composite class ID foreign
  key prevents a reply in a different classroom; server also rejects
  removed/foreign targets.
- Message size is 1–2,000 characters. Posting is limited to 8 per
  author per rolling minute. Every author may edit their own post for
  15 minutes. Self-delete is always available.
- ACTIVE Admin and Moderator can remove other members' posts. Edits/removals
  soft-delete or update the current row, with an `AuditLog` entry for changes.
  Removed entries are excluded from the normal reader.
- Replies create an `CHAT_REPLY` notification addressed to the
  parent author only if still ACTIVE and different from the replier.
- The visible tab refreshes every 20 seconds; manual refresh is always
  available. This is **polling, not guaranteed instantaneous Realtime**.

## Phase 7: Announcements & Inbox

Entry: `pages/announcements.html`, implemented by
`js/announcements.js` and migration
`20261027021553_phase7_announcements_inbox.sql`.

- ACTIVE Admin/Moderator can create, edit, pin/unpin and soft-delete
  announcements with title (3–120 chars) and body (1–4,000 chars).
  Priority is Normal, Important or Urgent. The server also validates
  expiration dates within one year, although expiry controls are not
  yet exposed in the initial form.
- Readers (all ACTIVE roles) see current, non-expired posts; pinned and
  prioritized items are displayed first. List capped at 80 posts.
- Publication records individual `ANNOUNCEMENT` notifications for
  members with ACTIVE membership at posting time (excluding author).
  These are **database inbox records**, not sent emails or push messages.
- The personal inbox returns only the signed-in member's latest
  60 records in the chosen class. Its read action requires matching
  notification ID, `user_id=auth.uid()`, and class ID. Another
  classmate or unapproved account cannot read, dismiss or list them.
- The visible tab refreshes every 30 seconds, with manual Refresh.

## Design
The new pages use the canonical shared sidebar and role-themed
light/dark CSS tokens: Student blue, Moderator purple, Admin indigo,
Developer silver. They display untrusted messages with `textContent`,
not unsanitized HTML. Every class switch sets the corresponding active
membership theme and discards prior classroom data.

## Security & boundaries
- No grants enabling direct chat, announcement or notification table
  access for `anon` or `authenticated`.
- Protected SQL functions require a current verified identity and
  ACTIVE class membership. Staff mutations are role checked on the
  server, regardless of which buttons appear in the UI.
- The original `bn_reply_in_same_class` DB constraint is preserved.
- No public chat files, browser-local fake messages, service-role JS
  credentials, public Realtime channels, or cross-class subscriptions.
- In-app notification retention, staff moderation policy, audit-log
  browsing, reporting flows, and true push/realtime delivery will need
  separate product/operational approvals before broad release.

## Validation

**Rollback-only database suite:** `tests/acceptance/phase6-phase7-db-rollback.sql`
passed after both migrations were deployed. It creates temporary Admin,
Student and Moderator chat/announcement actions, checks own edits versus
other edits, staff removals, reply delivery, Student publication denial,
receipt isolation, outsider cross-class denial, pin/unpin and read receipts.
The entire transaction rolls back.

**Automated repository tests:** `node --test tests/*.test.mjs` and
`tests/phase67-communications.test.mjs` cover permissions, safe
rendering, route consistency and theme contracts.

**Mass browser acceptance required before phase approval:**
1. ACTIVE Student/Admin and a *separate* Moderator account log in and
   navigate between different classrooms. No class cross-leakage.
2. Post and reply from two different Student accounts in the same
   class; verify replies produce exactly one notification to the
   parent author, not unrelated students.
3. Verify edit window and moderation authorization using direct RPCs,
   not just hidden buttons, including expired 15-minute edits.
4. Publish an announcement as Admin, verify visibility to ACTIVE
   Student and Moderator, and ensure a PENDING/removed member does not
   receive or read it.
5. Verify personal inbox ownership and read status across sessions,
   different users and multiple classes.
6. Stress check rate limits, pagination, duplicate delivery, refresh
   after tab wake and simultaneous class switches.
7. Inspect mobile/desktop, light/dark contrast, keyboard navigation,
   reduced motion, and screen readers.
8. Repeat Phase 5 mass testing separately, including real
   PDF/ZIP file-byte retrieval, outsider denial, immutable history
   and private Storage boundaries.
9. Verify all old Phase 2–4 DB suites still pass and Auth email
   deliverability is not assumed fixed.

**Release state:** Phase 6 and 7 MVP code and migrations are implemented.
The website UI awaits PR merge and GitHub Pages deployment. Full
approval requires the multi-account browser evidence above.
