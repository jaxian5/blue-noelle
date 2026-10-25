# Phase 2 live kickoff: Subjects & Assignments

**Date:** October 25, 2026  
**Phase 0:** Accepted. **Phase 1:** Approved by project owner.  
**Phase 2:** NOW STARTED, first real-Supabase reading slice in this PR.

## Decision: Email delivery is a parallel operational incident

The existing **Brevo → recipient** delivery issue (Gmail `550 5.7.1` and a missing Outlook message despite Brevo's "Delivered" event) does NOT block implementing Phase 2 reads/writes for **already verified Supabase Auth accounts**. Supabase sessions are JWT/refresh-token-based; viewing or modifying table rows within an authenticated session does not send confirmation emails.

It DOES block reliably onboarding **new** Admins and Students, and email-based password recovery. Therefore **public self-service registration readiness is NOT approved**, even though Phase 1's classroom permission/registration milestone remains approved. Never disable email confirmation, auto-confirm unverified accounts or expose service-role keys to work around delivery problems. Keep the investigation open and do not promise open-enrollment production readiness.

Verified snapshot taken Oct 25: **5 Auth users** (2 confirmed, 3 unconfirmed), **1** Admin-owned classroom, **2** ACTIVE memberships, **0** Subjects, **0** Assignments. No existing data was modified during this audit.

## Authoritative database readiness

Already in production Supabase:
- `Subject` holds `class_id`, `name`, `created_by`, `deleted_at` and RLS restricts reads to ACTIVE members of the class, inserts to ACTIVE Admin with `created_by = auth.uid()`.
- `Assignment` belongs to one `Subject` and enforces `status IN ('OPEN','CLOSED','ARCHIVED')`; RLS checks class membership through the parent Subject.
- Authenticated SELECT and INSERT grants exist. **UPDATE and DELETE are not granted to the browser**. Do not make an unaudited front-end status/deadline update.
- Unauthenticated visitors have no SELECT privileges on Subject or Assignment.
- Existing `pages/assignments.html`, `pages/admin-assignments.html` and `js/phase2-assignments.js` remain *old, isolated demo prototypes*, using localStorage and legacy demo identity. They are not production classroom routes and must not be linked as such.

## First production-safe slice (this PR)

`pages/classwork.html` + `js/phase2-classwork.js`, accessible through `pages/account.html` for verified ACTIVE members:

- Supabase Auth `getUser()` check, no demo-identity fallback.
- Load only the current user's ACTIVE `ClassMembership` rows, then the class rows allowed by RLS.
- Let an ACTIVE Student select among multiple enrolled classrooms.
- Fetch live `Subject` by selected class and `Assignment` by the visible Subject IDs. No browser-local assignment storage and no untrusted HTML insertion.
- Display assignment type (Individual/Group), status (OPEN/CLOSED/ARCHIVED), description/instructions, and deadline in `Asia/Manila`.
- Read-only by design. No made-up records and no live database mutations.
- Basic automated tests verify anonymous redirect, PENDING deny, scoped queries, hostile selector change guard, and no demo dependencies.

## Next Phase 2 milestones (separate PRs)

1. **Admin create** Subject and Assignment through audited, least-privilege database operations. On creation record `SUBJECT_CREATED` and `ASSIGNMENT_CREATED` with the actual Admin actor/class scope; validate names and parent Subject linkage. The current table has CREATE RLS, but audit creation must be implemented atomically before real writes are exposed.
2. **Admin edit and status** via controlled database RPCs or audited database triggers, including `DEADLINE_CHANGED` and `ASSIGNMENT_STATUS_CHANGED`, `updated_at` maintenance and strict class scoping. No direct unrestricted UPDATE grant.
3. **Student viewing acceptance:** test real Student and Admin using existing verified accounts, no additional test emails necessary; test new class isolation in transactional fixtures, rolled back.
4. **Navigation migration:** retire or redirect legacy localStorage-based academic routes only after their replacement covers the necessary functions, and ensure the dashboard reads live assignments with multi-class selection.
5. **Phase 2 approval gate:** Admin can create and manage subjects/assignments, Student can view only approved classrooms, cross-class restrictions pass, transitions audited, status/deadline logic tested, 0 unintended data exposures. Public new-account enrollment remains separately gated on reliable SMTP/OTP.

**Do not claim Phase 2 approved or production complete until these criteria pass.** This PR is only the kickoff and secure read path.
