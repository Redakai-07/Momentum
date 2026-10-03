# Momentum — Notification System Audit

Date: 2026-10-03 · Scope: the complete local-notification path from task data to
the Android notification shade. No code was rewritten before this audit.

> **Status: not fixed.** This document explains what exists and where it fails.
> The simplified foundation implemented alongside it is described in §7 — but
> real-device verification (§8) has not happened yet, so no reliability claim is
> made.

---

## 1. Current notification architecture

There are **three layers**, each with its own idea of "should a reminder happen":

```
POSTGRES-LESS / OFFLINE STACK
Task / Section schedule
        │
        ├─ Layer A — in-app queue ......... src/lib/notifications/engine.ts
        │     planNotifications() → creates TaskNotification rows in IndexedDB
        │     (task_start, task_reminder, overdue, special_task, next_task).
        │     Rows are "delivered" the moment their time has passed **while the
        │     app is open**; the store then posts a native notification ~2 s later.
        │
        ├─ Layer B — day planner .......... decision.ts + score.ts
        │     planDayReminder() → one "does today deserve an ordinary nudge"
        │     decision, gated by a weighted score (ORDINARY_MIN_SCORE), a
        │     per-task "already notified today" guard, activity breath, cooldown
        │     and quiet hours. Also `shouldNotify()` — a legacy point-in-time
        │     variant kept only for tests.
        │
        └─ Layer C — native schedule builder ... store.ts buildNativeSchedule()
              Collects Layer A candidates (scheduled/snoozed, today only) +
              Layer B day plan, then applies a **third** set of filters
              (quiet hours, completion cooldown), re-arms past cues at
              now + 15 min, anchors the day plan in meta `ordinaryReminderPlan`,
              slices to 12 records and hands them to Capacitor.
                       │
                       ▼
        service.ts → Capacitor LocalNotifications.schedule()
                       │
                       ▼
        Android AlarmManager → notification channel `momentum-reminders`
```

**Entry points that trigger a native resync** (`syncNotifications` +
`syncNativeNotifications`): boot (`doBoot`), every task mutation (add / update /
delete / toggle / log / accomplish), settings change, permission flows, day
rollover, every app resume, and a **60-second `setInterval` in app-shell.tsx**.
Each call is async and they are **not serialized**.

Native pieces that exist and work:

- `service.ts` — channel creation, permission checks, `schedule`/`cancel`,
  `getPending` diagnostics, FNV-1a stable notification ids, inexact alarms by
  default (exact only when the OS setting is already granted), `allowWhileIdle`
  for alarms less than 24 h out.
- Capacitor `@capacitor/local-notifications` 8.3.1 — its manifest already
  contains `RECEIVE_BOOT_COMPLETED` receivers, so alarms survive a reboot
  **once they were scheduled**.

## 2. Why notifications are unreliable

These are the concrete failure points, in rough order of impact.

1. **The native queue only ever covers "today", and only exists if the app is
   opened.** Nothing schedules tomorrow. A user who does not open the app on a
   given day has no alarm armed for that day. Delivery therefore depends on the
   app being opened frequently, which contradicts the stated offline/native
   design.
2. **Future cues are filtered by present-tense conditions at schedule time.**
   `buildNativeSchedule` drops any ordinary cue whose fire time falls in quiet
   hours or within `completionCooldownMinutes` of `lastMeaningfulActivityAt`.
   Those timestamps are refreshed by the same actions that trigger a sync
   (opening the app, editing a task), so the filter suppresses exactly the runs
   that could have armed the alarm.
3. **The day-level alarm is gated by `already_notified`.** After any reminder
   about the picked task fires (which is the normal case), `planDayReminder`
   returns ineligible and the one guaranteed alarm disappears until the next day.
4. **Score gating (`ORDINARY_MIN_SCORE`) can refuse to arm anything.** The gate
   is a weighted formula (urgency 40, remainingWork 25, inactivity 20,
   dueSoon 15, nextAction 10, scheduleRelevance 10, minus penalties). A day with
   a small, just-touched plan falls below the threshold and schedules nothing.
   Diagnostics would say `no_gap_yet`; the user simply gets silence.
5. **Cues are created only while their moment is still in the future**
   (`engine.ts` step 4: `if (fire >= nowMs)`). Opening the app after a task's
   scheduled start means that start cue is never created at all — the
   catch-up path in Layer C only applies to records that already exist.
6. **`resyncNative` cancels first, then schedules.** Every sync cancels the
   entire tracked set and re-schedules it. If the process dies, permission
   changes, or `schedule()` throws between the two calls, the device is left
   with **no pending alarms at all**. This runs on every mutation and every
   60 s.
7. **Native sync is gated on a cached permission string.** `syncNativeNotifications`
   early-returns (and clears the queue) when `state.notificationPermission !==
   "granted"`. That state is only refreshed at boot/diagnostics. Granting
   permission in Android settings while the app is alive leaves the app
   believing the queue must stay empty.
8. **Double/competing delivery.** A cue can be delivered by its own AlarmManager
   alarm and again by the `deliver:` path that `syncNotifications` posts (2 s in
   the future) when the app happens to be open. The two paths use different ids
   and different keys, so nothing deduplicates them across a race.
9. **Bulk "catch-up" posts at app open.** When the app is opened mid-day,
   `planNotifications` stamps several past cues delivered at once and
   `syncNotifications` posts them all natively — a burst of stale notifications
   rather than one relevant reminder.
10. **Concurrent syncs are unsequenced.** With ~10 sync triggers and no mutual
    exclusion, two runs can interleave cancel/schedule calls and the
    `scheduledNotificationIds` meta write, leaving the tracked list out of sync
    with what Android actually holds.
11. **The 12-record cap** (`records.slice(0, 12)`) silently discards the tail of
    a busy day's queue (kept only because it is sorted by time, so it is a
    truncation risk rather than a guaranteed loss).
12. **OS-level factors that are not code bugs but still matter:** Doze delays
    inexact alarms outside the 24 h `allowWhileIdle` window; aggressive OEM
    battery managers (MIUI, EMUI, OneUI) can drop alarms; notifications are
    silently dropped if permission was revoked after scheduling; the channel
    importance can be lowered by the user permanently.

## 3. Which code is redundant

| Redundancy | Detail |
| --- | --- |
| Three decision systems | `planNotifications` (A), `planDayReminder` (B) and `buildNativeSchedule` (C) each re-decide eligibility with different rules. |
| `shouldNotify` | Legacy point-in-time decision; production code never calls it (only tests do). |
| `score.ts` | 63-line weighted formula feeding a gate whose only documented purpose was to avoid *refusing* to schedule (it says so in its own comment). |
| Duplicate native delivery | `syncNotifications`' `deliver:` block vs. armed alarms — two ids/keys for one reminder. |
| Quiet hours + cooldown UI | Settings that no longer correspond to a behaviour anyone can predict: they are applied at scheduling time (Layer C) and at present time (Layer B) with different outcomes. (Removed from the Settings UI; stored values are simply ignored.) |
| `ordinaryReminderPlan` meta anchor | Exists only to stabilise the day plan (Layer B) across syncs; disappears with it. |
| `catchupSlot` (now + 15 min re-arm) | Only needed because Layer A cannot create past cues; the new planner handles past moments once, explicitly. |
| `notificationDecision` diagnostics | Computed on every diagnostics refresh but rendered nowhere. |

## 4. Which logic should remain

- `service.ts` as a thin, correct Capacitor wrapper — channel, permission,
  ids, inexact-first schema, `getPending` diagnostics, test/welcome sends.
- The in-app notification queue (`engine.ts` + `notifications` Dexie table) as
  the **UI reminder strip** source — it is a UI feature, not a delivery
  mechanism. Its native side-effects must be removed.
- Task/section recurrence (`schedule.ts`, `task-state.ts`, rollover) — correct
  and already date-aware.
- The focus (Pomodoro) alarm path (`armFocusAlarm`) — a separate, legitimate
  one-shot AlarmManager user.
- Snooze / dismiss data on the in-app queue.
- `devLog` gating (dev-only console output).

## 5. Which logic should be simplified

- Replace A + B + C with **one deterministic planner** whose output is the
  native queue.
- Reminder eligibility becomes explicit, not earned: a task in a section has a
  **time**, and the OS is given the alarm for each day it occurs.
- Delete `score.ts`, `decision.ts`, `shouldNotify`, the day-plan anchor,
  quiet-hours/cooldown gating of scheduled alarms, and the `deliver:` path.
- Cap concept: one reminder per task per day (`taskId:date` key) — no
  re-notification, no duplicate identity.
- Keep quiet hours only as a *label* in settings if it is kept at all; an
  explicit user-chosen reminder time always wins.
- Diagnostics show the planned week and the attentive `skipped` reasons instead
  of a score.

## 6. Native Android dependencies

Real, and already covered by the plugin:

- `@capacitor/local-notifications` schedules through `AlarmManager`;
  **JS is not required at fire time**.
- The plugin's manifest registers `BOOT_COMPLETED` / `LOCKED_BOOT_COMPLETED`
  receivers, so previously scheduled alarms are restored after a device restart.
- Notification channel `momentum-reminders` (importance HIGH, public
  visibility) must exist before the first post; created idempotently.
- Android 13+ runtime notification permission; `checkPermissions` is live and
  cheap, and must be re-read (not cached) whenever the queue is rebuilt.
- Android 12+ exact-alarm access. Momentum schedules **inexact** alarms unless
  access is already granted; inexact alarms are always delivered (system
  window), with `allowWhileIdle` inside 24 h.
- Battery optimisation / OEM task killers are outside app control; diagnostics
  must show what Android actually holds (`getPending`) so a missing reminder can
  be distinguished from a missing alarm.

Not dependencies, and must not be reintroduced: FCM/OneSignal, a service worker,
a background JS loop, or any assumption that the WebView stays alive.

## 7. Simplified architecture (implemented; product philosophy in planner.ts)

```
Task ── remindAt? / notifyTime? ──┐
Section schedule (isSectionActiveOnDate) ─┼─► evaluateReminder(context)
Settings times ───────────────────┘        │   priority · quiet hours · cooldown
                                           │   one record per task per day,
                                           │   section records grouped by moment
                                           ▼
                     reconcile vs getPending()  → anchored / fired sets
                                           │
                                           ▼
                     service.resyncNative()  (schedule first; cancel only stale ids)
                                           │
                                           ▼
                     Android AlarmManager → notification shade  (offline, no JS)
```

Rules (each covered by planner.test.ts):

- **Daily tasks** — one MEDIUM reminder at the task's time (own time → section
  start → default 09:00), plus at most one day-level later check-in at 17:00
  while work is open. Silent once completed or logged for the day.
- **Reminder (remainder) tasks** — one MEDIUM weekly check-in on the chosen
  weekend day while incomplete; permanent silence after completion. With a due
  date: HIGH due/overdue reminders instead.
- **Occasional tasks** — HIGH due/overdue reminders when dated; otherwise a LOW
  twice-a-month check-in (1st and 15th).
- **Custom sections** — recurrence is asked of the section
  (`isSectionActiveOnDate`), never re-implemented per task. Inactive section →
  no reminders.
- **Explicit user reminders** (`task.remindAt`, or a per-task `notifyTime`) —
  HIGH, fire exactly when asked, never suppressed by quiet hours.
- **Priority** — HIGH supersedes MEDIUM/LOW; a task already given a HIGH
  reminder that day is not mentioned again.
- **No barrage** — reminders that share a moment are grouped into one
  notification ("3 tasks planned: DSA, ML, Reading"); same reason never fires
  twice in a day.
- **Quiet hours 22:30 → 07:00** — ordinary (MEDIUM/LOW) reminders skip the
  window; important and user-created ones do not.
- **Activity reset** — a check-in stays quiet within 30 minutes of meaningful
  activity; completing/logging a task cancels that day's routine reminders on
  the next sync.
- A passed moment **today** is re-armed once at `now + 15 min` (never for LOW
  reminders); a past moment on another day is dropped.
- Snoozing replaces that task's reminder for today with the snooze moment.
- Every sync is serialized; permission is re-read live; unchanged alarms are not
  cancelled.

Reconciliation (the part that keeps re-syncs from lying):

- `getPendingIds()` asks Android what it is *actually* holding. Tracked alarms
  still pending are `anchored` — and a catch-up moment is never moved forward
  while its alarm is still pending (no more sliding reminders on every sync).
- A tracked alarm that is gone from the pending list and whose moment has passed
  is recorded in `firedReminders` for that day, so opening the app later does
  not re-arm and re-show a reminder the user already received.
- `resyncNative` schedules before cancelling, and only cancels ids that are not
  in the new set — a failure or process death can no longer empty the queue.

The native queue is deliberately short: the evaluator reasons over a 7-day
horizon, but only the **next meaningful reminders** are armed — at most 12, all
within 48 hours. A fired reminder is never immediately replaced; the next
reconciliation (launch, resume, task/section/settings change, 60 s tick) arms
what comes next. This avoids both an infinite stream and a queue that dies when
the app is not opened for a day.

Reconciliation triggers, all of which run the same single reconciler: app
launch, app resume, task create/edit/delete/complete, meaningful time log,
accomplish, custom-section create/edit/delete (a section's schedule owns the
reminder days of its tasks), and any reminder-settings change.

Documented limits: an app untouched for more than 48 hours runs out of armed
reminders (the next open re-arms them); worst-case OEM/doze delays can shift an
inexact alarm by the system's window.

## 8. Tests required

Unit (pure planner):

1. Daily task at default time produces one record per day across the horizon.
2. Per-task `notifyTime` overrides the section/default time.
3. Custom section only produces records on days its schedule occurs.
4. Reminder task without due date reminds only on the configured weekend day.
5. Reminder task with due date reminds on the due date and while overdue.
6. Occasional task without due date reminds on the configured days of month.
7. Completed / already-logged tasks are skipped for that day.
8. A passed reminder time today becomes a catch-up at now + 15 min, once.
9. Past days are never re-armed; a passed time for a future day is preserved.
10. `enabled: false` yields an empty plan.
11. Record cap keeps the earliest records.

Integration / device (still unexecuted — the actual proof):

12. Test notification with the app killed and the screen locked.
13. Weekly reminder fires with the app untouched for 8 days (alarm survives
    process death and reboot).
14. Reboot the phone before a pending reminder; verify it still fires.
15. Permission denied → granted from Android settings while the app is alive →
    next sync arms the queue (live permission re-read).
16. Rebuild the queue repeatedly (mutations + resume + 60 s tick) and confirm
    `getPending` matches `scheduledNotificationIds` (no lost/duplicate alarms).
17. Quiet hours, cooldown and score settings no longer change delivery.

---

### What remains before "fixed" can be claimed

- Implement the foundation in §7 (done in the same change as this audit).
- Verify on a physical Android device with the app killed, screen locked, after
  a reboot, and after 24 h+ untouched.
- Confirm `getPending` shows the expected week of alarms and that exactly one
  notification arrives per task per day.
