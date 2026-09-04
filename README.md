# Momentum

A personal command center for daily work, long-term goals, and consistency.
Minimal UI on the surface — a real task/time/performance system underneath.

> **Iteration 3 — intelligence layer on a functional local-first app.** Tasks,
> time logs, custom sections and daily performance records persist in IndexedDB
> (Dexie). On top: a context-aware reminder queue, earned recovery days, and
> permanent accomplishments for finished goals. The business rules live in pure,
> unit-tested functions (`npm test`), so streaks, recovery and reminders behave
> deterministically — nothing is hardcoded in the UI.

## The three questions it answers

1. **What do I need to do today?** — Today dashboard: special tasks (due dates),
   daily routines, custom sections, remaining workload.
2. **How much time will it take?** — every task carries an estimate and live
   remaining time; log `+15m / +30m / +1h` or a custom amount.
3. **How am I performing?** — Profile: daily/weekly/monthly/yearly performance
   (time-weighted), streak that survives at ≥ 70% days, focus totals, activity.

## Stack

- **Next.js 16** (App Router) + **TypeScript** (strict)
- **Tailwind CSS v4** — semantic tokens, intentional light & dark themes
- **Zustand** — client state, hydrated from and persisted to IndexedDB
- **Dexie.js** — typed local database (`momentum`): tasks, logs, sections, performance
- **Recharts** — minimal profile charts
- **lucide-react**, **clsx** + **tailwind-merge**

## PWA & mobile

- **Installable** — manifest with `id`/`scope`/standalone display, PNG icons at
  192/512 + a 512 maskable, apple-touch-icon, theme-color per scheme.
- **Offline-first** — `public/sw.js` caches the app shell (fonts, icons,
  hashed JS/CSS) and every route you visit; after the first load the app opens
  with no connection, and data lives in IndexedDB anyway. Registering is a
  tiny client component in the root layout (secure contexts only).
- **Mobile-first layout** — bottom tab bar with safe-area insets on phones,
  sidebar on `lg+`, `100dvh` frames, no double-tap-zoom delay on controls.
- Regenerate icons from the SVG mark with `node scripts/gen-icons.mjs` (sharp).

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build (typecheck included)
npm run lint     # eslint
npm test         # unit tests (vitest) — runs the pure intelligence layer
npx tsc --noEmit # typecheck only
```

## Architecture

```
src/
  app/                  five routes: Today, Remainder, Occasional, Calendar, Profile
  components/
    layout/             app shell, sidebar, mobile bottom nav, page frames
    ui/                 primitives: button, form, modal, checkbox, segmented, list
    tasks/              task row, detail modal, create/edit form, time log, day picker
    dashboard/          special-task banner, workload bar
    profile/            stats tiles, week rows, 30-day chart, annual bars, sections manager
    theme/              class-based dark mode, persisted, flash-free
    views/              page-level compositions (client)
  lib/
    types.ts            Task / TimeLog / DailyPerformance / CustomSection models
    db.ts               Dexie schema (tables: tasks, logs, sections, performance,
                        notifications, meta) with a v1→v2 in-place migration
    seed.ts             one-time example workspace (only used when the DB is empty)
    store.ts            Zustand store: hydrates from IndexedDB, persists every mutation
    date.ts format.ts schedule.ts performance.ts   pure business logic
    task-state.ts   lifecycle helpers (done / can-accomplish / toAccomplished)
    activity.ts     recovery-day classification
    config.ts       centralized, tunable rules (recovery + notification defaults)
    notifications/   reminder types + scheduling engine (pure, cooldown-aware)
```

**The intelligence layer is pure and tested** — `src/lib/*.test.ts` cover it:

- **Workload** — planned vs remaining per day from real tasks (estimates,
  schedules, due dates, partial progress, accomplishments excluded).
- **Performance** — daily percentage from logged minutes ÷ planned minutes;
  week / month / year rollups that exclude neutral days.
- **Streak** — threshold-based (≥ 70% default); rest, inactive and earned
  recovery days never break it; a partial in-progress day never breaks it.
- **Recovery days** — earned only after N qualifying days, capped per month,
  never counted as productive time.
- **Accomplishments** — daily/remainder goals can be permanently retired; the
  record (description, estimate, next action, logs) is preserved in place.
- **Notifications** — deterministic scheduling with a configurable cooldown
  after completions, dedupe per task/type/day, cancel-on-complete, snooze/dismiss.
- **Next-task selection** — picks the earliest scheduled open task for the
  "what's next" nudge.

**How persistence works** — every store action updates React state immediately
and writes through to Dexie. On boot the app hydrates from IndexedDB, performs a
day rollover (recurring tasks reset overnight; one-off tasks keep state), and
snapshots today's performance. The daily-performance table is seeded once with
realistic history so streaks/analytics are meaningful immediately; from then on
new days are computed from your actual time logs. Deleting the `momentum`
database resets to the first-run seed (dev tooling only).

## Data model notes

- Weekdays are stored as `Date#getDay()` indexes (0 = Sunday), rendered Monday-first.
- A task recurs on a date when its schedule fires **or** it is a one-off with that
  exact due date. Due-date tasks surface as **Special Tasks** on that day.
- Tasks carry a lifecycle: `active` → `completed` (day-level for recurring
  tasks, permanent for one-offs) → `accomplished` (retired goal, kept as history).
- `remainingMinutes` = estimate − logged. Completing sets it to 0; reopening
  restores the estimate. Performance = logged minutes ÷ planned minutes per day.
- Streak: a day counts when planned work cleared ≥ 70% (default). Rest and
  inactive days (nothing planned) neither extend nor break the streak; earned
  **recovery days** are neutral too; today only counts once it has crossed the
  threshold, so a slow morning never looks like a broken streak.
