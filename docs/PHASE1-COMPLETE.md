# Phase 1 — Legacy demo complete; live implementation in progress

**PROJECT: Blue Noelle · Version 0.2 · Phase 1**  
**Reference:** PROJECT_ Blue Noelle.docx — Authentication & Class Membership  

**DEMO ONLY (not production milestone):** *A verified student can securely enter their class* via invite → PENDING → Moderator approval → login.

## Framework checklist

| Item | Status |
|------|--------|
| Login | Done (rate-limited demo) |
| Registration + invite code | Done |
| Verification (approve / reject) | Done — `moderator-verification.html` |
| Roles / Class membership concept | Done |
| Profiles (sidebar) | Done |
| Permissions matrix (client helper) | Done |
| Basic audit logging | Done (local demo store) |
| Password hashing | **Deferred to backend** (documented) |
| Secure HTTP sessions | **Deferred to backend** |
| Login rate limiting | Done (client demo) |

## Invite Code invariants (§19) enforced in UI logic

- Belongs to one Class (`class_id` required on create)  
- Can expire (`expires_at`)  
- Can be revoked (`revoked_at`)  
- Optional usage limit (`max_uses`)  
- Create Invite Link: Admin Users directory  
- Codes stored in `data/invite-codes.json` + session extras (`localStorage bn_invite_codes_extra`)

## Password security UX

1. Invite code required **once per browser session**.  
2. Unlock stored in `sessionStorage.bn_password_unlocked` — cleared on sign-out or full refresh.  
3. **View** ↔ **Hide** toggle for password visibility.  
4. **Edit** still requires unlock; after unlock, edit panel opens without re-prompt until session ends.

## Pages added

| Page | Role |
|------|------|
| `pages/admin-users.html` | Admin — users list, Create Invite Link, revoke codes |
| `pages/moderator-verification.html` | Moderator — full verification queue |

## Remaining for production Phase 1

1. Server password hashing (bcrypt/argon2).  
2. HTTP-only secure session cookies.  
3. Persist users, memberships, invite codes, audit to PostgreSQL (`docs/schema.sql`).  
4. Increment `use_count` on successful registration against real InviteCode row.

## Live Supabase Phase 1 handoff\n\nThe real signup/invite/approval workflow is implemented separately in [Phase 1 Live Registration](PHASE1-LIVE-REGISTRATION.md). It requires the first trusted Admin bootstrap and end-to-end multi-user testing before the original milestone can be signed off. The legacy browser password-view and localStorage stores are explicitly **unsafe for real users**.\n\n## Next phase

**Phase 2 — Assignments**  
Admin creates subjects/assignments; students can see them.
