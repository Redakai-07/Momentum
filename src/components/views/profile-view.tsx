"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Award,
  Bell,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Layers,
  NotebookPen,
  Settings2,
  UserRound,
} from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useMounted, useNow } from "@/lib/hooks";
import { getFirstRunDate, useStore } from "@/lib/store";
import { dateKey, addDays, startOfWeek } from "@/lib/date";
import { PROFILE, type DailyPerformance } from "@/lib/types";
import {
  liveDayRec,
  currentStreak,
  longestStreak,
  weeklyAggregate,
  monthlyAggregate,
  yearlyAggregate,
  type DayRec,
} from "@/lib/performance";
import { COOLDOWN_OPTIONS } from "@/lib/config";
import {
  Panel,
  WeeklyRows,
} from "@/components/profile/performance-viz";
import { ActivityFeed, StreakTile } from "@/components/profile/profile-stats";
import { CustomSectionManager } from "@/components/profile/custom-section-manager";
import { DataBackupSection } from "@/components/profile/data-backup";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { Segmented } from "@/components/ui/segmented";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useTheme, type AccentColor, type Theme } from "@/components/theme/theme-provider";
import { formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tab = "overview" | "accomplishments" | "settings";

function historyRec(h: DailyPerformance): DayRec {
  return {
    date: h.date,
    plannedMinutes: h.plannedMinutes,
    completedMinutes: h.completedMinutes,
    percentage: h.percentage,
    kind: h.kind,
  };
}

function monthYearLabel(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function ToggleRow({
  checked,
  onChange,
  label,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div>
        <p className="text-[13.5px] font-medium text-foreground">{label}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-card shadow-soft transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

function NameRow() {
  const profileName = useStore((s) => s.profileName);
  const setProfileName = useStore((s) => s.setProfileName);
  const [draft, setDraft] = useState(profileName);
  const [saved, setSaved] = useState(profileName);

  // Keep the draft in sync if the saved name changes elsewhere.
  if (profileName !== saved) {
    setSaved(profileName);
    setDraft(profileName);
  }

  const trimmed = draft.trim();
  const dirty = trimmed.length > 0 && trimmed !== profileName;

  return (
    <div className="py-2.5">
      <p className="text-[13.5px] font-medium text-foreground">Your name</p>
      <p className="text-xs text-muted-foreground">
        Shown in the daily greeting and on your profile.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) {
              e.preventDefault();
              setProfileName(draft);
            }
          }}
          maxLength={40}
          placeholder="Your name"
          aria-label="Your name"
        />
        <Button
          size="sm"
          variant="soft"
          disabled={!dirty}
          onClick={() => setProfileName(draft)}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function PermissionRow() {
  const permission = useStore((s) => s.notificationPermission);
  const requestPermission = useStore((s) => s.requestNotificationPermission);
  const refreshPermission = useStore((s) => s.refreshNotificationPermission);
  const testNotification = useStore((s) => s.testNotification);
  const lastTest = useStore((s) => s.lastTestNotification);
  const diagnostics = useStore((s) => s.notificationDiagnostics);
  const requestExactAlarm = useStore((s) => s.requestExactAlarmAccess);
  const [sending, setSending] = useState(false);

  const permissionEnabled = permission === "granted";
  const isDev = process.env.NODE_ENV !== "production";

  const sendTest = async () => {
    setSending(true);
    try {
      await testNotification();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-medium text-foreground">Android/iOS notifications</p>
          <p className="text-xs text-muted-foreground">
            {permissionEnabled
              ? "Permission granted — reminders are delivered by the system, even in the background."
              : permission === "denied"
                ? "Blocked. Momentum cannot show reminders until you allow them in Android settings."
                : "Allow notification permission to receive reminders when Momentum is in the background."}
          </p>
        </div>
        {permissionEnabled ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="rounded-full bg-success/10 px-2.5 py-1 font-mono text-[11px] font-medium text-success">
              On
            </span>
            {isDev && (
              <button
                type="button"
                disabled={sending}
                onClick={() => void sendTest()}
                className="rounded-md border border-input px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50"
              >
                {sending ? "Scheduling…" : "Send test notification"}
              </button>
            )}
          </div>
        ) : permission === "denied" ? (
          <button
            type="button"
            onClick={() => void refreshPermission()}
            className="shrink-0 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
          >
            Check again
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void requestPermission()}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Allow
          </button>
        )}
      </div>

      {/* Development-only: the real acceptance test is an Android notification
          in the shade while Momentum is not in the foreground. */}
      {isDev && lastTest && (
        <p
          role="status"
          className={cn(
            "mt-2 rounded-md border px-2.5 py-1.5 text-xs leading-relaxed",
            lastTest.ok
              ? "border-success/30 bg-success/5 text-foreground"
              : "border-destructive/30 bg-destructive/5 text-foreground",
          )}
        >
          {lastTest.message}
          {lastTest.warning && (
            <span className="block text-muted-foreground">{lastTest.warning}</span>
          )}
          {lastTest.error && (
            <span className="block text-muted-foreground">{lastTest.error}</span>
          )}
        </p>
      )}

      {isDev && diagnostics && (
        <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-2.5">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Delivery diagnostics (dev)
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px] tnum">
            <dt className="text-muted-foreground">Platform</dt>
            <dd className="text-foreground">{diagnostics.platform}</dd>
            <dt className="text-muted-foreground">Permission</dt>
            <dd className="text-foreground">{diagnostics.permission}</dd>
            <dt className="text-muted-foreground">Channel</dt>
            <dd className="text-foreground">
              {diagnostics.channelId} · {diagnostics.channelRegistered ? "registered" : "missing"}
            </dd>
            <dt className="text-muted-foreground">Exact alarms</dt>
            <dd className="text-foreground">
              {diagnostics.exactAlarm} {diagnostics.exactAlarm === "denied" && "(inexact — still delivered)"}
            </dd>
            <dt className="text-muted-foreground">Queued with Android</dt>
            <dd className="text-foreground">{diagnostics.pendingCount}</dd>
          </dl>
          {diagnostics.pending.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {diagnostics.pending.slice(0, 4).map((p) => (
                <li key={p.id} className="truncate">
                  #{p.id} · {p.title}
                  {p.at ? ` · ${new Date(p.at).toLocaleString()}` : ""}
                </li>
              ))}
            </ul>
          )}
          {diagnostics.platform === "native" && diagnostics.exactAlarm === "denied" && (
            <button
              type="button"
              onClick={() => void requestExactAlarm()}
              className="mt-2 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/60"
            >
              Enable precise timing (optional)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PeriodGrid({
  today,
  week,
  month,
  year,
}: {
  today: DayRec;
  week: { percentage: number | null; completedMinutes: number; plannedMinutes: number };
  month: { percentage: number | null; completedMinutes: number; plannedMinutes: number };
  year: { percentage: number | null; completedMinutes: number; plannedMinutes: number };
}) {
  const cells = [
    { label: "Today", agg: today, tone: "default" as const },
    { label: "Week", agg: week, tone: "default" as const },
    { label: "Month", agg: month, tone: "default" as const },
    { label: "Year", agg: year, tone: "default" as const },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="surface rounded-2xl px-4 py-3.5">
          <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {c.label}
          </p>
          <p className="mt-1.5 tnum text-[26px] font-semibold leading-none tracking-tight text-foreground">
            {c.agg.percentage === null ? "—" : `${c.agg.percentage}%`}
          </p>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {formatMinutes(c.agg.completedMinutes)} of {formatMinutes(c.agg.plannedMinutes)}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ProfileView() {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  const tasks = useStore((s) => s.tasks);
  const logs = useStore((s) => s.logs);
  const sections = useStore((s) => s.sections);
  const history = useStore((s) => s.history);
  const notificationSettings = useStore((s) => s.notificationSettings);
  const setNotificationSettings = useStore((s) => s.setNotificationSettings);
  const refreshNotificationDiagnostics = useStore((s) => s.refreshNotificationDiagnostics);
  const profileName = useStore((s) => s.profileName);
  const { theme, setTheme, accentColor, setAccentColor } = useTheme();

  useEffect(() => {
    if (!joined) void getFirstRunDate().then(setJoined);
  }, [joined]);

  // Opening Settings is the moment the notification pipeline actually matters,
  // so re-read the live native state (permission can change outside the app).
  useEffect(() => {
    if (ready && tab === "settings") void refreshNotificationDiagnostics();
  }, [ready, tab, refreshNotificationDiagnostics]);

  const today = useMemo(() => (mounted && now ? dateKey(now) : null), [mounted, now]);

  const data = useMemo(() => {
    if (!today || !now) return null;
    const hist: DayRec[] = history.map(historyRec);
    const live = liveDayRec(tasks, logs, today, sections);
    const all: DayRec[] = [...hist, live];
    const byKey = new Map(all.map((r) => [r.date, r]));
    const get = (key: string): DayRec =>
      byKey.get(key) ?? { date: key, plannedMinutes: 0, completedMinutes: 0, percentage: null };

    // This calendar week, Monday first (future days marked pending).
    const monday = startOfWeek(now);
    const weekRows: (DayRec & { pending?: boolean })[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(monday, i);
      const key = dateKey(d);
      weekRows.push(
        key <= today
          ? { ...get(key), pending: false }
          : { ...get(key), pending: true },
      );
    }

    const weekly = weeklyAggregate(all, today);
    const monthly = monthlyAggregate(all, today);
    const yearly = yearlyAggregate(all, today);
    const streak = currentStreak(all, today);
    const best = Math.max(longestStreak(hist), streak);

    return { live, weekRows, weekly, monthly, yearly, streak, best };
  }, [today, history, tasks, logs, sections, now]);

  const accomplishments = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "accomplished")
        .sort((a, b) => ((b.accomplishedAt ?? "") < (a.accomplishedAt ?? "") ? -1 : 1)),
    [tasks],
  );

  const loggedByTask = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of logs) map.set(l.taskId, (map.get(l.taskId) ?? 0) + l.minutes);
    return map;
  }, [logs]);

  const joinedLabel = joined
    ? new Date(joined + "T12:00:00").toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <PageFrame>
      <div className="mb-6 flex items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Profile
          </p>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]">
            {profileName}
          </h1>
          {joinedLabel && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Using Momentum since {joinedLabel}
            </p>
          )}
        </div>
        <Segmented<Tab>
          options={[
            { value: "overview", label: "Performance" },
            { value: "accomplishments", label: "Accomplishments" },
            { value: "settings", label: "Settings" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {!mounted || !ready || !data || !data.live ? (
        <ListSkeleton rows={6} />
      ) : tab === "overview" ? (
        /* ----------------------------- Overview ----------------------------- */
        <div className="space-y-5">
          <StreakTile current={data.streak} best={data.best} />

          <PeriodGrid
            today={data.live}
            week={data.weekly}
            month={data.monthly}
            year={data.yearly}
          />

          <Panel
            eyebrow="This week"
            title="Daily performance"
            right={
              <span className="font-mono text-xs tnum text-muted-foreground">
                threshold {Math.round(PROFILE.streakThreshold * 100)}%
              </span>
            }
          >
            <WeeklyRows recs={data.weekRows} />
          </Panel>

          <Panel eyebrow="Recent" title="Activity">
            <div className="max-h-64 overflow-y-auto">
              <ActivityFeed logs={logs} tasks={tasks} />
            </div>
          </Panel>
        </div>
      ) : tab === "accomplishments" ? (
        /* ------------------------- Accomplishments -------------------------- */
        <div className="max-w-170">
          <div className="mb-3 flex items-center gap-2 px-0.5">
            <Award className="h-4 w-4 text-success" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Accomplishments
            </h2>
            <span className="font-mono text-[10.5px] tnum text-muted-foreground">
              {accomplishments.length} completed goal{accomplishments.length === 1 ? "" : "s"}
            </span>
          </div>

          {accomplishments.length === 0 ? (
            <EmptyState
              icon={<Award className="h-4 w-4" strokeWidth={1.5} />}
              title="No accomplishments yet"
              body="Finish a daily routine or a reminder task permanently from its details, and it will be kept here."
            />
          ) : (
            <ListShell>
              {accomplishments.map((t) => {
                const logged = loggedByTask.get(t.id) ?? 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:bg-muted/45"
                  >
                    <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-success" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-foreground">
                        {t.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {t.section === "daily" ? "Daily" : "Reminder"} · accomplished{" "}
                        {monthYearLabel(t.accomplishedAt)}
                        {logged > 0 && (
                          <>
                            {" "}
                            · <span className="tnum">{formatMinutes(logged)}</span> logged
                          </>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </ListShell>
          )}
        </div>
      ) : (
        /* ------------------------------ Settings ----------------------------- */
        <div className="max-w-170 space-y-6">
          <section>
            <div className="mb-2 flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Profile</h2>
            </div>
            <div className="rounded-xl border border-border bg-card/60 px-4">
              <NameRow />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">Appearance</h2>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Theme</p>
                <p className="text-xs text-muted-foreground">Calm by default — pick what feels right.</p>
              </div>
              <Segmented<Theme>
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "system", label: "System" },
                ]}
                value={theme}
                onChange={setTheme}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3.5">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Accent color</p>
                <p className="text-xs text-muted-foreground">Choose a subtle highlight for actions and selections.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2" aria-label="Accent color">
                {([
                  ["default", "Default", "hsl(174 62% 32%)"],
                  ["blue", "Blue", "hsl(214 70% 43%)"],
                  ["purple", "Purple", "hsl(270 52% 45%)"],
                  ["green", "Green", "hsl(145 52% 32%)"],
                  ["orange", "Orange", "hsl(25 76% 43%)"],
                  ["red", "Red", "hsl(4 65% 43%)"],
                  ["pink", "Pink", "hsl(333 58% 45%)"],
                  ["teal", "Teal", "hsl(174 62% 32%)"],
                ] as [AccentColor, string, string][]).map(([value, label, color]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    aria-pressed={accentColor === value}
                    title={label}
                    onClick={() => setAccentColor(value)}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 border-transparent shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      accentColor === value && "border-foreground ring-2 ring-ring/40 ring-offset-1",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Reminders
              </h2>
            </div>
            <div className="divide-y divide-border/60 rounded-xl border border-border bg-card/60 px-4">
              <ToggleRow
                checked={notificationSettings.enabled}
                onChange={(v) => setNotificationSettings({ enabled: v })}
                label="Notifications"
                sub="Master switch for local task reminders."
              />
              <ToggleRow
                checked={notificationSettings.taskReminders}
                onChange={(v) => setNotificationSettings({ taskReminders: v })}
                label="Daily reminders"
                sub="A gentle nudge when the day&apos;s plan is still waiting."
              />
              <ToggleRow
                checked={notificationSettings.specialTaskReminders}
                onChange={(v) => setNotificationSettings({ specialTaskReminders: v })}
                label="Special / due reminders"
                sub="For tasks due today — even during the quiet period."
              />
              <ToggleRow
                checked={notificationSettings.overdueReminders}
                onChange={(v) => setNotificationSettings({ overdueReminders: v })}
                label="Overdue reminders"
                sub="One quiet check each morning for overdue work."
              />
              <ToggleRow
                checked={notificationSettings.quietHoursEnabled}
                onChange={(v) => setNotificationSettings({ quietHoursEnabled: v })}
                label="Quiet hours"
                sub="No ordinary reminders while you sleep."
              />

              <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">Quiet hours window</p>
                  <p className="text-xs text-muted-foreground">
                    Ordinary reminders are suppressed between these times.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    type="time"
                    value={notificationSettings.quietStart}
                    onChange={(e) => setNotificationSettings({ quietStart: e.target.value })}
                    aria-label="Quiet hours start"
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 font-mono text-xs tnum text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60"
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <input
                    type="time"
                    value={notificationSettings.quietEnd}
                    onChange={(e) => setNotificationSettings({ quietEnd: e.target.value })}
                    aria-label="Quiet hours end"
                    className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 font-mono text-xs tnum text-foreground focus:outline-none focus:ring-2 focus:ring-ring/60"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-[13.5px] font-medium text-foreground">Reminder cooldown</p>
                  <p className="text-xs text-muted-foreground">
                    How long Momentum waits before another ordinary nudge.
                  </p>
                </div>
                <Segmented
                  className="[&>button]:w-auto"
                  options={COOLDOWN_OPTIONS.map((o) => ({
                    value: String(o.value),
                    label: o.label,
                  }))}
                  value={String(notificationSettings.cooldownMinutes)}
                  onChange={(v) => setNotificationSettings({ cooldownMinutes: Number(v) })}
                />
              </div>

              <PermissionRow />

              <p className="py-3 text-xs leading-relaxed text-muted-foreground">
                <Bell className="mr-1 inline h-3 w-3" />
                Reminders are scheduled locally on this device and work offline.
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-2 px-0.5">
              <Layers className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                My sections
              </h2>
            </div>
            <CustomSectionManager />
          </section>

          {/* Optional personal space — kept off Home on purpose. */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 px-0.5">
              <NotebookPen className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Hobby &amp; Notes
              </h2>
            </div>
            <Link
              href="/hobbies"
              className="surface lift flex items-center gap-3.5 rounded-xl px-4 py-3.5"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <NotebookPen className="h-4.5 w-4.5" strokeWidth={1.6} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium text-foreground">
                  Open Hobby &amp; Notes
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Interests, ideas and notes. Separate from your daily plan — nothing here
                  becomes a task.
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground/50"
                strokeWidth={2}
              />
            </Link>
          </section>

          <section className="rounded-xl border border-dashed border-border px-4 py-4">
            <p className="text-[13px] font-medium text-foreground">Streak &amp; recovery rules</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A normal day keeps your streak at{" "}
              <span className="tnum font-mono text-foreground/80">
                {Math.round(PROFILE.streakThreshold * 100)}%
              </span>{" "}
              of planned time. Rest days (nothing planned) are neutral. A missed day after
              sustained good days can count as a recovery day instead of a break, up to two per
              month — protecting consistency without pretending the day was productive.
            </p>
          </section>

          {/* Replaces the old read-only "Your data" note: the same promise, now
              with the export/import controls that make it actionable. */}
          <DataBackupSection />

          <p className="pb-2 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Momentum · local-first · your data never leaves this device
          </p>
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
    </PageFrame>
  );
}