# Phase 2 final polish and acceptance

**October 25, 2026.** The audited classwork backend and redesigned dashboard have been merged through PR #21. This polish updates the landing-page links and classroom form guidance to point to the live academic workspace instead of advertising legacy demo behavior.

**Phase 2 technical completion:** Live Supabase-backed dashboard, active-class selector, subject/assignment reads, Admin subject/assignment CRUD, deadlines and status transitions, and atomic audit records. Cross-class and Student write denials verified in rolled-back database integration tests. No demo classwork is seeded. Free Plan file limit capped at 40 MiB.

**Owner's live final acceptance still needed:** Sign into existing confirmed Admin account, create/rename a subject, create an individual and group assignment, change deadline and status; verify that the changes survive refresh. Sign into existing confirmed Student account and verify read-only class-scoped visibility. Test on mobile. The test does not need new signup emails.

**Phase 1 operational hold:** Email delivery remains under investigation. Do not disable verification or claim self-service enrollment ready.

**Phase 3 starts separately:** Secure private files and versioned submissions must be implemented with RLS/storage policies and transactional lifecycle, not the old demo screens.
