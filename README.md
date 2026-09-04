# Momentum

A personal command center for daily work, long-term goals, and consistency.
Minimal UI on the surface — a real task/time/performance system underneath.

> **Iteration 1 — application shell & UI.** Everything is driven by realistic
> in-memory mock data (seeded on load) so every control is fully functional.
> Data resets on refresh; IndexedDB persistence (Dexie) is the next milestone.

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
- **Zustand** — in-memory client state (seed data; persistence comes later)
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
    mock.ts             deterministic realistic seed (tasks, logs, sections, 430-day history)
    store.ts            Zustand store — actions only, no persistence yet
    date.ts format.ts schedule.ts performance.ts   pure business logic
```

Business logic lives outside components so a Dexie/IndexedDB or cloud-sync layer
can be added without touching the UI.

## Data model notes

- Weekdays are stored as `Date#getDay()` indexes (0 = Sunday), rendered Monday-first.
- A task recurs on a date when its schedule fires **or** it is a one-off with that
  exact due date. Due-date tasks surface as **Special Tasks** on that day.
- `remainingMinutes` = estimate − logged. Completing sets it to 0; reopening
  restores the estimate. Performance = logged minutes ÷ planned minutes per day.
- Streak: a day counts when planned work cleared ≥ 70% (default). Rest days
  (nothing planned) neither extend nor break the streak; today only counts once
  it has crossed the threshold, so a slow morning never looks like a broken streak.
