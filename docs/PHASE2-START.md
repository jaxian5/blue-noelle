# Phase 2 — Assignments (started)

**Reference:** PROJECT_ Blue Noelle.docx §5 + Phase 2 roadmap  

**Milestone:** *Admin can create classwork; students can see it.*

## Implemented

| Item | Location |
|------|----------|
| Subject create | `admin-assignments.html` + `Phase2.createSubject` |
| Assignment create (Individual/Group) | `Phase2.createAssignment` |
| Status OPEN / CLOSED / ARCHIVED | Status select on admin list |
| Student view | `assignments.html` + dashboard upcoming |
| Store | `localStorage bn_phase2_assignments` + `data/assignments.json` seed |

## Framework rules respected

- Subject **1 → N** Assignments (no M:N)  
- Individual **or** Group — not mixed  
- Assignment status enum  
- Audit: ASSIGNMENT_CREATED, SUBJECT_CREATED, ASSIGNMENT_STATUS_CHANGED  

## Also in this iteration (Phase 1 polish)

- Admin cannot see/revoke Developer invites or accounts  
- Developer cannot create/revoke class invites  
- Invite **Can Expire** ON/OFF toggle  
- Class masterlist: Moderator (name+email) · Admin (+ username, last login, role change)

## Next

- Deadline edit audit (`DEADLINE_CHANGED`)  
- Wire submission page to real assignment ids (Phase 3)  
- Group membership UI (Phase 5)
