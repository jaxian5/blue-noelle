# Blue Noelle — Threat Model (Phase 0)

**Phase 0 deliverable · Version 0.1 · 1–2 page summary**  
Reference: Working Framework §18

## What we protect

- Student accounts and personal information  
- Student files and submission history  
- Class information and administrative functions  

## Threat actors

| Actor | Example risks |
|-------|----------------|
| Unauthenticated outsider | Account attacks, file access, spam |
| Normal student | Unauthorized files, other users’ submissions, privilege escalation |
| Moderator | Excessive administrative access beyond class scope |
| Admin | High-impact accidental or malicious class actions |
| Developer | System-level compromise |

## Security is continuous (not deferred to Phase 10)

| Phase | Security focus |
|-------|----------------|
| 1 | Authentication: hashing, sessions, rate limits |
| 2 | Assignment authorization |
| 3 | File security: access control, validation, non-public storage |
| 4 | Schedule / data exposure |
| 5 | Group authorization |
| 6 | Chat abuse / sanitization / rate limiting |
| 8 | Administrative authorization & sensitive-action confirmation |
| 9 | System security, strongest access controls, emergency procedures |

## Design controls already locked in Phase 0

- Database enforces ownership XOR and related invariants.  
- Soft-delete for academic records; audit log with `actor_role_at_time`.  
- Class-scoped roles; Developer platform-level and heavily audited.  
- Storage keys opaque; no public guessable paths.  
- Late computed from immutable timestamps, not a mutable flag.  

## Residual / deferred

- Virus scanning  
- Email / browser push abuse surface  
- Full object-storage IAM policies (when moving off local disk)  

Revisit this document at the start of each phase’s security checklist.
