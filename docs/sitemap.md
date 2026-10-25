> **Reconciliation (2026-10-25):** This sitemap is the original MVP blueprint; [ADR-0001](ADR-0001-supabase-architecture.md) defines the Supabase deployment, and the Phase 1 real registration pilot uses dedicated `phase1-onboarding.html` and `phase1-class-staff.html` pages until the demo cutover is tested.\n\n# Blue Noelle — Page / Sitemap (Phase 0 + MVP)

**Phase 0 deliverable · Version 0.1**  
Reference: Working Framework §13, §20, §21

## Public / unauthenticated

| Path | Purpose |
|------|---------|
| `/index.html` | Landing · philosophy · entry |
| `/pages/login.html` | Sign in (test: roles.json → future API) |
| `/pages/register.html` | Invite-code registration → PENDING |

## Student (MVP core)

| Path | Purpose |
|------|---------|
| `/pages/dashboard.html` | Central command · Class Clock · upcoming work · announcements |
| `/pages/assignments.html` | Subject → Assignment list |
| `/pages/submission.html` | Upload → Organize → Submit pipeline · version history |

*Planned later in roadmap:* Schedule detail, Chat, Notifications center, compiled download UI.

## Moderator

| Path | Purpose |
|------|---------|
| `/pages/moderator.html` | Directory · verification queue · chat reports · monitoring |

## Admin (Phase 8)

| Path | Purpose |
|------|---------|
| `/pages/admin.html` | Directory · users · assignments · groups · audit · settings |

## Developer (Phase 9)

| Path | Purpose |
|------|---------|
| `/pages/developer.html` | System status · storage · logs · backups · maintenance · diagnostics |

## Shared chrome (all authenticated pages)

- Header + role-aware nav  
- Class Clock strip (permanent on student-facing pages)  
- Profile chip → account sidebar (info, avatar, dark mode, sign out, version, feedback)  

## MVP definition check (§21)

Complete at end of Phase 4 (or Phase 3 + basic dashboard):

- [x] Auth UI shell (login, register, roles, membership concept)  
- [x] Academics UI shell (assignments, submissions, file upload demo)  
- [x] Time UI shell (Class Clock strip)  
- [x] Dashboard shell (upcoming, statuses)  

Chat, compilation, notifications, advanced sharing, analytics, full developer tooling → after Phase 0.
