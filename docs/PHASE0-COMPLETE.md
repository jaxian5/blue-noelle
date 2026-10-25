# Phase 0 — Architecture Baseline: FORMAL SIGN-OFF
**Project:** Blue Noelle · **Date:** 2026-10-25 · **Scope:** architecture only

## Baseline decision
**Phase 0 architectural deliverables: ACCEPTED.** The September 18 Working Framework's entities, class-scoped permissions, security threat model, file storage abstraction, and application sitemap have been reconciled with deployed Supabase infrastructure.

This is **not** a claim that Phase 1 authentication, Phase 3 file uploads, or Phase 8 administration have passed production readiness testing. The original framework explicitly assigns feature security work to each later phase.

| Original Phase 0 deliverable | Canonical artifact | Decision |
| --- | --- | --- |
| Entity relationship model | [Entity diagram](erd.md) | Accepted |
| Database schema, keys and constraints | `supabase/migrations/` (6 applied), [schema design draft](schema.sql) | Accepted for architectural baseline; security policy regression testing remains per phase |
| Permission matrix | [Permission matrix](permission-matrix.md) | Accepted |
| Storage interface/abstract path specification | [Storage specification](storage-spec.md) + [Supabase ADR](ADR-0001-supabase-architecture.md) | Accepted as specification, not operational storage |
| System architecture | Working Framework §2, §22 + Supabase ADR | Accepted |
| Sitemap | [MVP sitemap](sitemap.md) | Accepted |
| Threat model | [Threat model](threat-model.md) + Supabase ADR trust boundaries | Accepted |
| Audit and timezone invariants | Working Framework §§14, 17, 19 and migrations | Accepted at contract level; comprehensive audit writing is per-phase |

## Verified infrastructure snapshot
- Supabase project `zllphzqalkurnibfctyl`, PostgreSQL 17.
- **19 application tables**, all with RLS enabled; six remote migrations deployed.
- Schema checks include Student XOR Group, current version ownership, compilation source linkage, time snapshot immutability, and same-class chat replies.
- No real production identities or submissions; only one demonstration class metadata record.
- No copy of demo passwords, exposed invite codes or administrator bootstrap secrets.

## Explicit known implementation limitations, assigned to later phases
1. Authentication, invite validation, approvals, passwords, sessions, and rate limiting (Phase 1).
2. Assignment CRUD as live shared records (Phase 2).
3. Private file storage, access control, version transaction serialization, soft-delete visibility (Phases 3 and 5).
4. Current/next schedule calculation (Phase 4).
5. Full audit trail and developer infrastructure (Phases 1, 8, 9).
6. Authenticated-executable SECURITY DEFINER RPC warnings require multi-role testing and ideally movement behind private functions. No direct anonymous execution of the three original RPCs (prior verification). See [Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter).

**Phase 0 is complete as an architecture phase, not as a general declaration of zero software defects.** A defect uncovered later should be filed, assigned, and repaired without retroactively claiming Phase 0 never existed.

## Transition
Phase 1 starts with real Supabase authentication and the exact sequence:
**Secure invite creation → Signup/email confirmation → Redeem class invite → PENDING membership → Moderator/Admin review → ACTIVE membership → Authorized class access.**
No student is granted Moderator, Admin, or Developer privileges merely by knowing a signup code.
