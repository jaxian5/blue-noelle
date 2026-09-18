# PROJECT: Blue Noelle

**Version 0.4 · Phase 2 complete · September 2026**  
Status: **Phase 0 locked** · **Phase 1 complete** (auth, verification, invite links, password UX).

Authoritative reference: *PROJECT_ Blue Noelle.docx* + `docs/PHASE1-COMPLETE.md`.

> The database enforces invariants. The backend enforces business rules. The frontend enforces usability.

---

## Project layout

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

## Test accounts (temporary)

| Role | Username | Password |
|------|----------|----------|
| Student | jdelacruz | Student@2026 |
| Moderator | msantos | Moderator@2026 |
| Admin | areyes | Admin@2026 |
| Developer | devblue | Developer@2026 |

## Philosophy

**Upload → Organize → Submit/Share → Compile → Download → Track**

---

## Guidelines: create / expand / fix

Always check the Blue Noelle documentation (Working Framework) before changing behaviour.

### Create

1. **New page** — Copy header + Class Clock (student-facing) + load `core.js`. Gate by role using `BN.getCurrentUser()`.
2. **New permission** — Add to `docs/permission-matrix.md` and `BN.can()` in the same change.
3. **New entity** — Update `docs/schema.sql` first; enforce invariants in SQL, not only in UI.
4. **New file upload path** — Follow `docs/storage-spec.md` (`storage_key` opaque, hierarchy under class/assignment/submission/version).

### Expand

| Goal | Where to start |
|------|----------------|
| Real auth | Phase 1 · replace `roles.json` login with hashed passwords + sessions |
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

**Phase 2 polishing and finalization**
