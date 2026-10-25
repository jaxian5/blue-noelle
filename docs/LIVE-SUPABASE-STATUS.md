# Live Supabase migration status (2026-10-25)

Project `zllphzqalkurnibfctyl` is ACTIVE_HEALTHY. Applied through the connected Supabase MCP:

| Remote migration version | Name | Related repository SQL |
|---|---|---|
| 20261025024400 | initial_classroom | `20261024000000_initial_classroom.sql` |
| 20261025024408 | class_operations | `20261024010000_class_operations.sql` |
| 20261025024435 | harden_class_rpc_anon_permissions | `20261025024435_harden_class_rpc_anon_permissions.sql` |

The first two SQL files existed in GitHub before deployment, so **their filenames do not match the server-generated migration versions**. Don't blindly run `supabase db push` from this tree: reconcile remote/local migration history in the CLI before any new push, or it may try to rerun the first two migrations.

Verified: eight public tables exist, all have RLS enabled; initial records are empty; `anon` cannot execute the three privileged `bn_*` RPCs. The security advisor still flags authenticated-access SECURITY DEFINER functions. These need authorization testing with actual role-separated accounts before production.

No accounts or classroom rows were seeded, no login credentials added, and Phase 1 browser demonstration has not been migrated.

Next: harden ownership-changing UPDATE operations and database-side schedule audit, create a trusted first Admin identity and class, test user separation, then migrate assignment administration and class schedule screens to the live backend.
