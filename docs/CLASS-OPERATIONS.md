# Class operations preview

This branch adds a Supabase-backed management preview at `pages/class-operations.html`.

## Features
- Active Admin can list members, change role/status (via audited PostgreSQL RPC), add/delete recurring timetable slots and dated exceptions.
- Active Moderator can read a class directory and schedule but cannot mutate them on this screen.
- Local demo accounts do **not** authorize Supabase operations. A real Supabase Auth session and matching active ClassMembership are required.

## Setup
1. Merge the Supabase foundation PR first (already merged).
2. Apply migrations in order: `20261024000000_initial_classroom.sql`, then `20261024010000_class_operations.sql`. Test in a disposable Supabase project first.
3. The public `js/supabase-config.js` is now tracked with the confirmed URL `https://zllphzqalkurnibfctyl.supabase.co`. Replace its `sb_publishable_REPLACE_ME` placeholder with the publishable key, then verify RLS before real users sign in. Never publish a secret/service_role key.
4. Register a test user in Supabase Auth and insert its profile and initial Admin membership using the trusted Supabase dashboard/SQL console **once**. There is intentionally no unauthenticated bootstrap/admin promotion endpoint. The UUID for the profile must match auth.users.id. Seed a Class record first.
5. Sign in on Class Operations using that test account, and test Admin vs Moderator on separate accounts.

## Remaining work
- No automatic registration provisioning or invite-code workflow yet.
- Moderator approval/rejection of pending accounts is not yet connected to Supabase; existing Phase 1 demo verification is localStorage-only.
- Class-name lookup, subject selection, full schedule edit, overlapping-slot constraints, per-date exceptions with replacement times, dashboard Class Clock integration, and server-side audit of schedule changes are not yet built.
- The shared UI is a partial administration preview, **not production-ready**. RLS and functions need live database integration tests.
- `supabase-config.js` is tracked for static hosting but still contains a placeholder key, so this screen remains unconnected until you supply the publishable key and deploy SQL migrations. Static browser configuration is public; never add server credentials.
