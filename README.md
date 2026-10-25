> **Backend update (October 25, 2026):** Supabase now contains all 19 Phase 0 entity tables with Row Level Security. A sample classroom metadata row was migrated from the repository; no plaintext demonstration accounts, public sample invites, or browser-local assignments were copied. The existing demo login/submissions are **not** production ready. See [migration report](docs/MIGRATION-REPORT-2026-10-25.md), [Blue Noelle sign in](pages/login.html), [real registration](pages/register.html), [membership status](pages/account.html), and [classwork import](pages/import-local-data.html).

# PROJECT: Blue Noelle

**Architecture: Phase 0 formally accepted (October 25, 2026).**  
**Live implementation:** Phase 1 invited registration and moderation RPCs deployed; real-account acceptance testing and first trusted Admin bootstrap still pending. Phase 2 assignments remain a separate localStorage demo.

Authoritative reference: *PROJECT_ Blue Noelle.docx* + `docs/PHASE0-COMPLETE.md`, `docs/ADR-0001-supabase-architecture.md`, and `docs/PHASE1-LIVE-REGISTRATION.md`. The old `PHASE1-COMPLETE.md` applies to the **demo only**.

> The database enforces invariants. The backend enforces business rules. The frontend enforces usability.

---

**Canonical authentication:** `pages/login.html` → `pages/account.html`; register via `pages/register.html`; approved officers use `pages/phase1-class-staff.html`. See [AUTH-ENTRY](docs/AUTH-ENTRY.md). The old demo dashboard/assignments are not linked as authenticated academic destinations.\n\n## Project layout

```
blue-noelle/
├── index.html
├── css/main.css
├── js/core.js
├── data/roles.json              # TEMP test accounts only
├── docs/
│   ├── PHASE0-COMPLETE.md       # Checklist + locked invariants
│   ├── schema.sql               # PostgreSQL draft
│   ├── permission-matrix.md
│   ├── storage-spec.md
│   ├── threat-model.md
│   └── sitemap.md
└── pages/
    ├── login.html · register.html
    ├── dashboard.html · assignments.html · submission.html
    ├── moderator.html · admin.html · developer.html
```

## Historical prototype data

Demo accounts and intentionally public sample credentials remain in `data/roles.json` exclusively for the isolated legacy frontend. **Never use them as real accounts or import their passwords into Supabase.**

## Philosophy

**Upload → Organize → Submit/Share → Compile → Download → Track**

---

## Guidelines: create / expand / fix

Always check the Blue Noelle documentation (Working Framework) before changing behaviour.

### Create

1. **New page** — Copy header + Class Clock (student-facing) + load `core.js`. Gate by role using `BN.getCurrentUser()`.
2. **New permission** — Add to `docs/permission-matrix.md` and `BN.can()` in the same change.
3. **New entity** — Create a versioned Supabase migration under `supabase/migrations/`; update the ER diagram and acceptance tests. The old `docs/schema.sql` is a non-executable historical draft.
4. **New file upload path** — Follow `docs/storage-spec.md` (`storage_key` opaque, hierarchy under class/assignment/submission/version).

### Expand

| Goal | Where to start |
|------|----------------|
| Real auth | Phase 1 · Supabase Auth + trusted invite redemption and moderator review. Start with `pages/login.html`, `pages/register.html` and `pages/account.html`; staff review lives in `pages/phase1-class-staff.html`. |
| Real submissions | Phase 3 · true MVP boundary |
| Groups + PDF compile | Phase 5 · compilation is a separate artifact |
| Class chat | Phase 6 · controlled scope, not Discord 2.0 |
| Admin operations | Phase 8 · class-scoped only |
| System ops | Phase 9 · Developer · every action audited |

### Fix

| Symptom | Check |
|---------|--------|
| Sidebar missing version/feedback | `ensureSidebarMarkup()` footer in `js/core.js` |
| Dark mode lost | `localStorage.bn_theme` + `BN.setTheme` on boot |
| Wrong role redirect | Exact strings: `Student` \| `Moderator` \| `Admin` \| `Developer` |
| Late flag wrong | Must use `BN.computeLateness`; never store permanent `is_late` |
| Ownership invalid | DB CHECK: student_id XOR group_id |
| Feedback chat does nothing | Expected until Phase 6 — use Email developer |

### Sidebar footer (required)

- Text: **Blue Noelle (Version 0.1: Phase 0)**
- Link: **Found bugs or have feedback? Click here** → modal with:
  - Class chat (Phase 6 placeholder)
  - Email developer (`dev@bluenoelle.local`)

---

## Phase 0 locked invariants (do not reopen casually)

1. Submission owner = Student XOR Group  
2. Late is computed from immutable timestamps  
3. Versions append-only  
4. Compilation ≠ SubmissionVersion  
5. Soft-delete academic records  
6. Class-scoped roles; Developer platform-level  
7. UTC storage · Asia/Manila display  
8. Storage abstraction (`storage_key`)  
9. Security continuous per phase  
10. Audit includes `actor_role_at_time`  

See `docs/PHASE0-COMPLETE.md` for the full checklist.

## Next

**Phase 1 real-account acceptance testing**. Bootstrap the first Admin through a trusted operator after Supabase signup, verify invite issuance, PENDING review, ACTIVE membership and cross-class RLS. Only then retire the old demo login and continue Phase 2.
