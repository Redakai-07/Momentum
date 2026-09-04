# Momentum

A personal command center for daily work, long-term goals, and consistency.
Minimal UI on the surface — a real task/time/performance system underneath.

> **Iteration 2 — functional local-first app.** The full UI now runs on real
> IndexedDB persistence (Dexie). Tasks, time logs, custom sections and daily
> performance records survive refreshes and reloads. On a truly first run the
> example workspace is seeded once; after that everything you see is your data.

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
- PWA-ready: manifest, theme-color, standalone meta, viewport-fit, app icon

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build (typecheck included)
npm run lint     # eslint
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
    db.ts               Dexie schema (tables: tasks, logs, sections, performance, meta)
    seed.ts             one-time example workspace (only used when the DB is empty)
    store.ts            Zustand store: hydrates from IndexedDB, persists every mutation
    date.ts format.ts schedule.ts performance.ts   pure business logic
```

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
- `remainingMinutes` = estimate − logged. Completing sets it to 0; reopening
  restores the estimate. Performance = logged minutes ÷ planned minutes per day.
- Streak: a day counts when planned work cleared ≥ 70% (default). Rest days
  (nothing planned) neither extend nor break the streak; today only counts once
  it has crossed the threshold, so a slow morning never looks like a broken streak.
