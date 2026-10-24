# Supabase integration preparation · October 2026

**Status: project URL and browser publishable key have been configured in `js/supabase-config.js`.** Project reference: `zllphzqalkurnibfctyl`. This enables Supabase client initialization on pages that load the adapter; migrations, authentication and RLS have **not** been tested against the hosted project, and no accounts or live data have been migrated.

## Architecture

- Supabase Auth owns passwords and sign-in; do not move `data/roles.json` passwords into the new database.
- PostgreSQL stores User profiles, classes, memberships, subjects and assignments. Membership role remains **class-scoped**; Developer is platform-level only.
- RLS limits normal browser queries. Only trusted backend/Edge Functions may verify members, distribute invite codes or change roles.
- Existing Phase 2 browser/localStorage demo is unchanged. `js/supabase-adapter.js` is an opt-in read-only adapter, not wired into production pages.
- Migration implements **only Phase 1/2 starter tables**. `docs/schema.sql` remains a design draft and must **not** be run alongside the migration: it duplicates table definitions and uses a separate password_hash model.

## Create and connect a hosted project

1. Create a Supabase project in the Supabase dashboard (manual owner step).
2. In your local repository install Supabase CLI (see docs) and link: `npx supabase login`, `npx supabase link --project-ref zllphzqalkurnibfctyl`.
3. Review the migration and test against a disposable project/local stack **before** running `npx supabase db push` on the hosted project. CLI local stack requires a Docker-compatible runtime.
4. Set the project's Site URL and redirect allowlist to your real hosted origin when implementing Supabase Auth.
5. The existing tracked `js/supabase-config.js` now contains the project's public URL and publishable key. The Class Operations page loads this config with `supabase-js` and the adapter. This is public GitHub Pages browser configuration; thoroughly validate RLS and migrations before onboarding real users.
6. Never commit `sb_secret_...`, legacy `service_role`, database passwords, or connection strings. `.env.example` is for tooling documentation, not automatically consumed by static HTML/GitHub Pages. Static sites cannot securely store server secrets.
7. Creating the Supabase project and including its URL in code does **not** apply the SQL migrations or create an Admin account. Connect the Supabase plugin to administer this project from ChatGPT, or run the migrations through an authorized local CLI workflow.

## Test criteria before switching off demo mode

- Sign-in/sign-out, pending registration and admin approval implemented with trusted server-side handling.
- User profiles created through audited server logic after Auth signup; no client privilege escalation.
- RLS: an active Student can read only their class's subjects/assignments; an Admin can create only in a class where they are active Admin; nonmembers cannot access data.
- An Admin's assignments appear for a student on a different device after login.
- Avoid broad table access; ensure all sensitive updates (role, class association, assignment owner) go through audited server endpoints.
- Timezone: UTC timestamps in DB, Asia/Manila for display, as baseline requires.

## Known incomplete security work

This starter is **not a production security boundary** until UPDATE column protection, invite redemption, trusted member enrollment, audit logging, storage policies, and runtime tests are built. Existing client-only demo accounts must never be used as real accounts.
