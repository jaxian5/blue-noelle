# Phase 0 — Complete

**PROJECT: Blue Noelle · Version 0.1: Phase 0 · September 2026**  
Status: **Decisions locked · Deliverables recorded · Frontend shell finalized**

## Documentation source of truth

Working Framework PDF (Phase 0 Baseline). All implementation must conform to invariants and decisions recorded there.

**Key architectural rule**  
> The database enforces invariants. The backend enforces business rules. The frontend enforces usability.

## Phase 0 deliverables (checklist)

| Deliverable | Location |
|-------------|----------|
| System architecture & conceptual model | Working Framework §2, §22 |
| PostgreSQL schema draft | `docs/schema.sql` |
| Permission matrix | `docs/permission-matrix.md` |
| File storage specification | `docs/storage-spec.md` |
| Threat model | `docs/threat-model.md` |
| Page / sitemap | `docs/sitemap.md` |
| Test role credentials (temporary) | `data/roles.json` |
| UI shell (student + staff directories) | `pages/*`, `css/main.css`, `js/core.js` |

## Locked invariants (do not reopen without deliberate change control)

1. Submission owner = Student **XOR** Group (DB CHECK).  
2. Late is **computed**; never a permanent `is_late` boolean.  
3. Versions append-only; `current_version_id` pointer updates.  
4. Compilation is a **separate artifact**, not a version.  
5. Soft-delete on academic records; physical purge is maintenance.  
6. Class-scoped roles via ClassMembership; Developer is platform-level.  
7. All timestamps stored UTC; display and schedule evaluation in Asia/Manila.  
8. Storage abstracted (`storage_key` + metadata); local disk first.  
9. Security continuous per phase — not deferred to Phase 10.  
10. Audit records include `actor_role_at_time`.

## Immediate next step

**Begin Phase 1 — Authentication & Class Membership**

- Real password hashing, secure sessions, rate limiting  
- Invite code validation against Class  
- Moderator verification queue wired to membership status  
- Basic audit logging for USER_APPROVED / USER_REJECTED  

Milestone: *A verified student can securely enter their class.*

## Version string (UI)

Sidebar footer: **Blue Noelle (Version 0.1: Phase 0)**
