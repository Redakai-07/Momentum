# Momentum — Production Scheduler Test Matrix

Date: 2026-10-03 · Installed stack verified from `package.json` and
`node_modules`:

| Package | Installed |
| --- | --- |
| `@capacitor/core` | ^8.5.1 |
| `@capacitor/android` | ^8.5.1 |
| `@capacitor/local-notifications` | **8.3.1** |

Android project: `minSdk 24`, `compileSdk 36`, `targetSdk 36`, app id
`app.web.momentum`. No custom `AlarmManager`/`BroadcastReceiver` code exists (the
only app Java file is `MainActivity`).

## How to read the statuses

- **PASS** — actually executed in this environment (unit test or static check of
  the installed plugin's Kotlin source).
- **PARTIAL** — the behaviour is verified in code / in the installed plugin, but
  has not been executed on a device. Not a delivery guarantee.
- **NOT TESTED** — requires a physical Android device or emulator run.

No item below is marked PASS on the basis of "it should work".

## What the installed plugin actually does (verified from its Kotlin sources)

- `LocalNotificationManager.schedule()` → `setExactIfPossible`: exact only when
  `isExactNotification && canScheduleExactAlarms()`, otherwise **inexact**
  (`set` / `setAndAllowWhileIdle`). `PendingIntent` is keyed by notification id,
  so re-scheduling the same logical reminder replaces its alarm instead of
  stacking a duplicate.
- `NotificationStorage` persists every scheduled notification in
  SharedPreferences; `getPending()` reads that store (not a live AlarmManager
  query), so it can include delivered-but-undismissed notifications.
- `LocalNotificationRestoreReceiver` is registered for `BOOT_COMPLETED`,
  `LOCKED_BOOT_COMPLETED` and `QUICKBOOT_POWERON`; after a reboot it re-arms
  saved alarms and gives past-due ones a `now + 15 s` catch-up fire. Fired
  one-shots are not re-armed. **Reboot rescheduling is native — no custom code
  is needed.**
- `schedule()` rejects with `NOTIFICATIONS_DISABLED` when the app's
  notifications are off, and `cancel()` keeps delivered-but-visible records
  (marking them cancelled) instead of deleting them.
- The manifest merges `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`,
  `WAKE_LOCK` and `SCHEDULE_EXACT_ALARM`.

## Matrix

| # | Scenario | Status | Evidence / reason |
| --- | --- | --- | --- |
| 1 | Daily task reminder | PASS | `planner.test.ts` — one MEDIUM record at 09:00 + later check-in |
| 2 | Incomplete daily task | PASS | planner arms it; skips only when done/logged |
| 3 | Completed daily task | PASS | planner skips today, reopens tomorrow |
| 4 | Reminder task | PASS | weekly MEDIUM on the configured weekend day |
| 5 | Incomplete Reminder task | PASS | same test suite |
| 6 | Completed Reminder task | PASS | permanent silence (one-off completion) |
| 7 | Occasional task with due date | PASS | HIGH due → overdue days |
| 8 | Occasional task without due date | PASS | LOW 1st/15th check-in, no catch-up |
| 9 | Custom daily section | PASS | `isSectionActiveOnDate` + planner daily rule |
| 10 | Custom weekly section | PASS | only the Monday inside the horizon fires |
| 11 | Custom monthly section | PASS | monthly-last-day section test |
| 12 | Inactive custom section | PASS (decision) / PARTIAL (delivery) | planner says nothing; cancelling previously-armed alarms on section edit is code-path verified but not executed on a device |
| 13 | Explicit user reminder | PASS (decision) / PARTIAL (delivery) | HIGH, exact time, ignores quiet hours; device delivery unverified |
| 14 | Duplicate reminder prevention | PARTIAL | unit tests cover deterministic unique ids, one-per-task-per-day and reconciliation; Android replacement is plugin-source verified |
| 15 | Task completed before reminder | PARTIAL | planner skips + next sync cancels stale ids; not executed on device |
| 16 | Task deleted before reminder | PARTIAL | `deleteTask` reconciles; planner drops the task; not executed |
| 17 | Task moved section | PARTIAL | `updateTask` reconciles and re-evaluates; not executed |
| 18 | App open | PASS (code) / PARTIAL | reconcile runs on launch/resume + 60 s tick; alarms fire natively |
| 19 | App backgrounded | PARTIAL | delivery is an AlarmManager alarm; plugin-source verified only |
| 20 | App killed | NOT TESTED | requires a device |
| 21 | Device locked | NOT TESTED | requires a device |
| 22 | Airplane mode | NOT TESTED | no network is used; requires a device to confirm |
| 23 | Device restart | PARTIAL | native `LocalNotificationRestoreReceiver` verified in the installed source; not executed |
| 24 | Quiet hours | PASS | planner suppresses ordinary, allows explicit/high |
| 25 | Notification permission denied | PARTIAL | queue is cleared; plugin rejects `schedule()`; not executed |
| 26 | Notification permission granted | PARTIAL | live re-read + re-arm paths verified in code; not executed |
| 27 | Android channel disabled | PARTIAL | diagnostics read the OS importance and flag `channelBlocked` (importance 0); not executed |
| 28 | Multiple tasks | PASS | grouping + priority tests (3 tasks → one notification) |
| 29 | Multiple sections | PASS | mixed-section plans in planner tests |

## Failure taxonomy (A–E) and how the system answers each

Recorded in `devLog` (development only) and readable in diagnostics:

| Failure | Signal |
| --- | --- |
| A. Decision said no | `planner.skipped` reasons per task/day (`done_on_day`, `quiet_hours`, `not_checkin_day`, `moment_passed`, …) and `evaluateTaskDay()` |
| B. Scheduling was never called | every mutation/launch/resume/section-edit/settings path calls the single reconciler; `devLog("native schedule synced")` |
| C. Native scheduling failed | `ScheduleOutcome.error` from the plugin (e.g. `NOTIFICATIONS_DISABLED`); tracked list is not overwritten on failure |
| D. Notification was cancelled | `resyncNative` logs; cancelled ids are absent from the pending list and from `scheduledNotificationIds` |
| E. Scheduled but Android did not deliver | `NativeDiagnostics`: `permission`, `channelRegistered`, `channelImportance`, `channelBlocked`, `exactAlarm`, `pending[]`, plus reconciliation's `firedReminders` |

## What still cannot be claimed

Nothing in this matrix proves real delivery. Until a device run covers rows
20–23 and 25–27, the scheduler's reliability claim is limited to: the decision
layer is exhaustively unit-tested, the native calls match the installed API, and
the queue is reconciled on every trigger point.
