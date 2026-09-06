"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  Bell,
  BellRing,
  CheckCircle2,
  Layers,
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
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { Segmented } from "@/components/ui/segmented";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useTheme, type Theme } from "@/components/theme/theme-provider";
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
            checked ? "translate-x-[18px]" : "translate-x-0.5",
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

  const permissionEnabled = permission === "granted";

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div>
        <p className="text-[13.5px] font-medium text-foreground">Android/iOS notifications</p>
        <p className="text-xs text-muted-foreground">
          {permissionEnabled
            ? "Permission granted — reminders can be delivered by the system."
            : "Allow notification permission to receive reminders when Momentum is in the background."}
        </p>
      </div>
      {permissionEnabled ? (
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-success/10 px-2.5 py-1 font-mono text-[11px] font-medium text-success">On</span>
          {process.env.NODE_ENV !== "production" && (
            <button type="button" onClick={() => void testNotification()} className="rounded-md border border-input px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60">
              Test notification
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
      {process.env.NODE_ENV !== "production" && permission !== "granted" && (
        <button type="button" onClick={() => void testNotification()} className="shrink-0 rounded-md border border-input px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60">
          Test notification
        </button>
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
        <div key={c.label} className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
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
  const profileName = useStore((s) => s.profileName);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (!joined) void getFirstRunDate().then(setJoined);
  }, [joined]);

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
  }, [today, history, tasks, logs, now]);

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
        <div className="max-w-[680px]">
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
                    <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-success" strokeWidth={1.75} />
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
        <div className="max-w-[680px] space-y-6">
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

          <section className="rounded-xl border border-dashed border-border px-4 py-4">
            <p className="text-[13px] font-medium text-foreground">Your data</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Everything lives in this app&apos;s local database on this device. No account, no
              cloud, no tracking — Momentum works fully offline.
            </p>
          </section>

          <p className="pb-2 text-center font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Momentum · local-first · your data never leaves this device
          </p>
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
    </PageFrame>
  );
}