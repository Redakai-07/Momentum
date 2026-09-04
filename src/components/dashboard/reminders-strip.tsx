"use client";

import { Bell, Clock3, X } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { notificationMessage } from "@/lib/notifications/engine";
import { dateKey } from "@/lib/date";
import { cn } from "@/lib/utils";

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function RemindersStrip() {
  const now = useNow(30_000);
  const notifications = useStore((s) => s.notifications);
  const tasks = useStore((s) => s.tasks);
  const dismissNotification = useStore((s) => s.dismissNotification);
  const snoozeNotification = useStore((s) => s.snoozeNotification);
  const snoozeMinutes = useStore((s) => s.notificationSettings.snoozeMinutes);

  if (!now) return null;
  const today = dateKey(now);
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));

  const delivered = notifications.filter(
    (n) =>
      n.date === today &&
      n.status === "delivered" &&
      !n.dismissedAt &&
      n.type !== "special_task",
  );
  const pending = notifications
    .filter((n) => n.date === today && n.type !== "special_task")
    .filter((n) => {
      if (n.status === "scheduled" && new Date(n.scheduledAt).getTime() > now.getTime())
        return true;
      if (n.status === "snoozed") return true;
      return false;
    });

  if (delivered.length === 0 && pending.length === 0) return null;

  return (
    <section>
      <p className="mb-2 px-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Reminders
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card/70">
        {delivered.map((n) => {
          const title = titleOf.get(n.taskId);
          if (!title) return null;
          return (
            <div
              key={n.id}
              className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-0"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-signal-soft text-signal">
                <Bell className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              <p className="min-w-0 flex-1 truncate text-[13px] text-foreground/90">
                {notificationMessage(n, title)}
              </p>
              <button
                type="button"
                onClick={() => snoozeNotification(n.id)}
                title={`Remind again in ${snoozeMinutes} minutes`}
                aria-label={`Snooze for ${snoozeMinutes} minutes`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => dismissNotification(n.id)}
                aria-label="Dismiss reminder"
                title="Dismiss"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
        {pending.length > 0 && (
          <div className="space-y-1 px-4 py-2.5">
            {pending.map((n) => {
              const title = titleOf.get(n.taskId);
              if (!title) return null;
              const when = n.status === "snoozed" ? n.snoozedUntil : n.scheduledAt;
              return (
                <div key={n.id} className="flex items-center gap-2.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "h-1 w-1 shrink-0 rounded-full",
                      n.status === "snoozed" ? "bg-signal/70" : "bg-muted-foreground/40",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {notificationMessage(n, title)}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] tnum">
                    {when ? timeLabel(when) : ""}
                    {n.status === "snoozed" && (
                      <button
                        type="button"
                        onClick={() => dismissNotification(n.id)}
                        aria-label="Dismiss reminder"
                        className="ml-1.5 text-muted-foreground/70 hover:text-foreground"
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
