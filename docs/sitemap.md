# Blue Noelle — Page / Sitemap (Phase 0 + MVP)

**Phase 0 deliverable · Version 0.1**  
Reference: Working Framework §13, §20, §21

## Public / unauthenticated

| Path | Purpose |
|------|---------|
| `/index.html` | Landing · philosophy · entry |
| `/pages/login.html` | Canonical Supabase Auth sign-in and password recovery |
| `/pages/register.html` | Account signup → email confirmation → invite redemption → PENDING |

| `/pages/account.html` | Authenticated membership status, sign out, officer navigation |\n\n## Student (MVP core)

| Path | Purpose |
|------|---------|
| `/pages/dashboard.html` | Central command · Class Clock · upcoming work · announcements |
| `/pages/assignments.html` | Subject → Assignment list |
| `/pages/submission.html` | Upload → Organize → Submit pipeline · version history |

*Planned later in roadmap:* Schedule detail, Chat, Notifications center, compiled download UI.

## Moderator

| Path | Purpose |
|------|---------|
| `/pages/moderator.html` | Legacy prototype only, not integrated with Supabase yet |

**Live Phase 1 officer verification:** `/pages/phase1-class-staff.html` uses real Moderator/Admin authorization.\n\n## Admin (Phase 8)

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
