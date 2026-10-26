# Blue Noelle Phase 4 · Class Clock 2.9 Integration
**Implementation date:** October 26, 2026
**PR:** #33 · **Source framework:** [jaxian5/class-clock](https://github.com/jaxian5/class-clock)
**Target application:** `jaxian5/blue-noelle`, GitHub Pages + Supabase
**Status:** Implemented on feature branch; production database migration applied; final role-based browser acceptance pending.

## Framework and feature lineage

Phase 4 uses the standalone **Class Clock v2.9c.3** repository as its primary
product and interaction framework, without copying its separate Supabase
credentials, authentication, data tables, or the personal BSIT 2-1 timetable.

| Standalone Class Clock | Blue Noelle Phase 4 |
| --- | --- |
| Current time, upcoming class, live countdown | `BNClassClock.evaluate()` + authenticated `class-clock.html` |
| Weekly schedule grouped by day | 7-day rolling timetable from `ScheduleSlot` |
| Today schedule, current/next/previous indicators | Clock hero, today's session cards, Dashboard preview |
| Skip/NO_CLASSES/Shift overrides | Global holiday/cancelled, targeted cancellation and targeted reschedule through `ScheduleException` |
| Tasks view, upcoming deadline countdown | Live OPEN Blue Noelle `Assignment` deadlines; no browser-local demo task-completion records |
| Browser class/task notifications | Explicit opt-in Class Clock reminders while the page is open; **not** Phase 7 platform-wide notifications |
| Standalone Admin schedule and task UI | Existing protected `Schedule & Members` + Phase 2 assignment editors |
| Standalone hardcoded Supabase client/tables | Blue Noelle's shared `BNBackend` Auth, `ClassMembership` RLS and audit triggers |
| Standalone class sample `schedule.json` | **NOT imported**. Each Blue Noelle class owns its own timetable. |

### Code modules
- `js/class-clock-core.js`: pure, deterministic Class Clock state machine.
  Reads recurring slots, dated exceptions, subjects, assignments and a supplied
  timestamp. Calculates current/next/previous, countdown, 7-day weekly board,
  due tasks and warnings without network or global browser time zone.
- `pages/class-clock.html` + `js/class-clock-page.js`: class selector,
  live hero, today and week schedule, tasks and opt-in browser reminders.
  Authenticated class membership and Supabase RLS limit all reads.
- `css/class-clock.css`: responsive workspace UI using semantic dark/light
  surface, text and Student/Moderator/Admin/Developer role palette variables.
- `js/dashboard-clock.js`: isolated live clock preview for both Student and
  Admin dashboard. Clock failures never blank classwork or the main dashboard.
- `pages/class-operations.html`, `js/class-operations-ui.js` and
  `js/class-operations.js`: subject-linked slots and optional targeted
  exceptions in the existing audited Admin schedule editor.

## Time model and exact state rules

All displayed dates/times use **Asia/Manila**, independent of browser or OS
time zone. A modern Manila wall-clock minute maps to UTC instant at GMT+8.
Recurring slots represent local wall times; assignment deadlines remain
stored as UTC `timestamptz` and are never reconstructed from a local
browser date. The clock polls the current time every second and refreshes
the server schedule periodically while open.

**Current** means `start <= now < end`. **Next** is the first session
whose start is strictly after now. If nothing remains today, search forward
for the next available weekly occurrence (including a future-week repeat).
The hero counts toward the current session's end or the next session's
start. Midnight and weekly transitions are date-keyed to Manila.

**Dated exceptions are evaluated before calculating the clock:**

1. Whole-class `holiday` or `cancelled` with no target suppresses all
   recurring and special sessions on that specific date.
2. Targeted `holiday` or `cancelled` suppresses only the selected
   `ScheduleSlot` instance for that date.
3. `rescheduled` MUST target a recurring slot and provide two valid
   replacement times. The original weekly pattern remains unchanged.
4. A standalone `special` event with start/end times becomes a dated
   session. Without times, its note is displayed informationally.
5. Legacy unscoped reschedules are never arbitrarily applied when multiple
   recurring sessions exist; the engine warns. (Existing deployment had
   no exceptions when migration was applied.)
6. If one-day overrides create overlapping sessions, the engine warns so
   the Admin can resolve it. Database enforcement currently rejects
   overlaps between **recurring** sessions only.

Assignment countdown selects the closest future OPEN deadline and separately
displays overdue open tasks. An Admin changing the deadline does not mutate
submitted version history.

## Database schema and authority

**Applied to connected Supabase:**
`supabase/migrations/20261026030605_phase4_clock_semantics.sql`

- Adds nullable `ScheduleException.schedule_slot_id` referencing a
  recurring `ScheduleSlot`. Deleting a slot also deletes its targeted
  exceptions, with inherited audit triggers.
- Rejects reschedules without an explicit target and invalid date/day or
  cross-class targets.
- Rejects overlapping weekly `ScheduleSlot` insert/updates, using an
  advisory transaction lock for concurrent Admin edits.
- Rejects cross-class/deleted `Subject` associations in recurring slots.
- Adds indexes for class/day lookups and constraints preventing duplicate
  targeted overrides and duplicate class-wide cancellations.

Existing `ScheduleSlot` and `ScheduleException` RLS and trusted audit
triggers are retained. No new public write role or credential is introduced.
Clock rendering is read-only for Students; only ACTIVE Admins can change
schedule records. Moderator membership review is unchanged.

## Test evidence

- `tests/phase4-class-clock.test.mjs`: current/next, precise countdown,
  midnight, weekly wrap, classwide/targeted overrides, specials, dates,
  overdue/open task filtering and input validation.
- `tests/acceptance/phase4-clock-db-rollback.sql`:
  **PASS on connected Supabase**. Validates adjacent sessions, overlap
  rejection, subject isolation (when a second-class subject is present),
  scoped reschedules, correct weekday, duplicate overrides and six
  audit events. Entire fixture and audit changes rolled back.
- Other existing automated tests and Phase 2/3 database acceptance suites
  remain separate release gates.

**Do not call the phase production-accepted from CI alone.** A browser
check is still needed with actual authenticated Admin/Student accounts.

## Phase 4 final browser acceptance

1. Merge PR #33 and confirm GitHub Pages deployment succeeds. An ACTIVE
   Student should see **Class Clock** in the same sidebar and be denied
   Schedule & Members write access.
2. An ACTIVE Admin creates subject-linked Monday sessions (09:00–10:00,
   10:00–11:00). These should appear in the same selected classroom's
   Class Clock, Dashboard preview and week timetable after refresh.
3. Create an overlapping class (09:30–10:30); database/UI must reject it.
   Attempt cross-class subject association; it must be rejected.
4. Cancel just one of the Monday sessions by choosing its target ID.
   The other remains. Add a class-wide holiday; both disappear that date,
   but they return in the following week.
5. Reschedule the first Monday session to 14:00–15:00 for one date. It
   shifts only on that date, and persists after reload. Try an invalid
   date/weekday and missing replacement times; both must fail.
6. Create a timed Special event and an untimed Special note. Both should
   appear as appropriate in the schedule without changing the weekly
   template.
7. Verify the countdown before, during, immediately after a class, over
   midnight, and at the start of the next week. Run the same checks in
   a browser with system timezone outside Manila.
8. Add and edit a real assignment deadline. Confirm upcoming/open and
   overdue lists, refreshed timestamps, and preserved Phase 3 version
   snapshots.
9. Opt into browser reminders voluntarily. Verify permission requests
   only occur on click; reminders appear while the tab is open.
   The page makes no promise of background/system-wide delivery.
10. Switch between two ACTIVE classes. Verify all week/today/task data
    changes, colors follow the active role, and no other classroom's
    records are visible. Verify dark/light and mobile layouts.
11. Test actual Student versus Admin access (including direct URLs), and
    record visual/browser results without passwords, tokens or OTPs.

## Remaining product boundaries

- This module does **not** implement Phase 5 compilation, Phase 6 community,
  or Phase 7 server-side notification inboxes.
- Browser reminders do not run after the page closes and are not a durable
  notification service. A later notification phase may extend them.
- Day-specific override overlap is displayed as a warning, not yet blocked
  by a second database overlap constraint.
- Real browser/live acceptance remains outstanding. Existing Phase 1 SMTP
  delivery and Phase 2/3 final file-integrity gates remain independent.
