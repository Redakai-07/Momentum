"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame } from "lucide-react";
import { NAV_ITEMS, LIST_LINKS } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { liveDayRec, pickDayRec, currentStreak } from "@/lib/performance";
import { dateKey } from "@/lib/date";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { useAndroidBackButton } from "@/lib/modal-stack";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ShellInner>{children}</ShellInner>
    </ThemeProvider>
  );
}

function ShellInner({ children }: { children: ReactNode }) {
  const boot = useStore((s) => s.boot);
  const ready = useStore((s) => s.ready);
  const syncNotifications = useStore((s) => s.syncNotifications);
  const syncNative = useStore((s) => s.syncNativeNotifications);
  const markInteraction = useStore((s) => s.markInteraction);

  // Intercept Android/iOS back button and browser history pop so that
  // modals (Create Task, Task Detail) close first instead of exiting the app.
  useAndroidBackButton();

  useEffect(() => {
    boot();
  }, [boot]);

  // Reconcile the reminder queue while the app is open: every minute and on
  // return to the tab, notifications flip from scheduled to delivered.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      void syncNotifications();
      void syncNative();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        markInteraction();
        void syncNotifications();
        void syncNative();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, syncNotifications, syncNative, markInteraction]);

  return (
    <div className="min-h-dvh">
      <DesktopSidebar />
      <div className="flex min-h-dvh flex-col lg:pl-[228px]">
        <main className="w-full flex-1 min-w-0 px-5 pb-28 pt-6 sm:px-8 lg:px-10 lg:pb-16 lg:pt-10">
          {children}
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StreakMini() {
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const history = useStore((s) => s.history);
  const tasks = useStore((s) => s.tasks);
  const logs = useStore((s) => s.logs);
  const sections = useStore((s) => s.sections);

  let streak: number | null = null;
  if (ready && now) {
    const key = dateKey(now);
    const live = liveDayRec(tasks, logs, key, sections);
    const recs = history.map((h) => pickDayRec(history, null, h.date));
    streak = currentStreak([...recs, live], key);
  }

  return (
    <Link
      href="/profile"
      className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-card/60 px-3 py-2 transition-colors hover:border-border hover:bg-card"
    >
      <Flame className="h-4 w-4 shrink-0 text-signal" fill="currentColor" strokeWidth={0} />
      <span className="tnum text-sm font-semibold text-foreground">
        {streak ?? "—"}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        day streak
      </span>
    </Link>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[228px] flex-col border-r border-border bg-sidebar lg:flex">
      <div className="flex items-center gap-2.5 px-5 pt-7">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-md border border-foreground/12 bg-card shadow-soft">
          <span className="h-[8px] w-[8px] rounded-full bg-primary" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          Momentum
        </span>
      </div>

      <nav aria-label="Main" className="mt-7 flex-1 overflow-y-auto px-3">
        <p className="mb-1.5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Focus
        </p>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                    active
                      ? "bg-muted/80 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground/80",
                    )}
                    strokeWidth={1.75}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="mb-1.5 mt-5 px-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
          Lists
        </p>
        <ul className="space-y-0.5">
          {LIST_LINKS.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                    active
                      ? "bg-muted/80 font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground/80",
                    )}
                    strokeWidth={1.75}
                  />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-4 py-4">
        <StreakMini />
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/88 pb-[max(env(safe-area-inset-bottom),6px)] backdrop-blur-lg lg:hidden"
    >
      <div className="grid grid-cols-3">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-[52px] flex-col items-center justify-center gap-1 py-1.5",
                active ? "text-foreground" : "text-muted-foreground/80",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-10 place-items-center rounded-full transition-colors",
                  active && "bg-primary/10",
                )}
              >
                <Icon
                  className={cn("h-[18px] w-[18px]", active && "text-primary")}
                  strokeWidth={active ? 2 : 1.75}
                />
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium tracking-wide",
                  active ? "text-primary" : "text-muted-foreground/80",
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
