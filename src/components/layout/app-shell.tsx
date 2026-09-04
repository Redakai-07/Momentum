"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Flame, Monitor, Moon, Sun } from "lucide-react";
import { NAV_ITEMS } from "@/lib/nav";
import { useStore } from "@/lib/store";
import { PROFILE } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { currentStreak } from "@/lib/performance";
import { liveDayRec, pickDayRec } from "@/lib/performance";
import { ThemeProvider, useTheme } from "@/components/theme/theme-provider";

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

  useEffect(() => {
    boot();
  }, [boot]);

  // Reconcile the reminder queue while the app is open: every minute and on
  // return to the tab, notifications flip from scheduled to delivered.
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => {
      void syncNotifications();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNotifications();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, syncNotifications]);

  return (
    <div className="min-h-dvh">
      <DesktopSidebar />
      <div className="flex min-h-dvh flex-col lg:pl-[240px]">
        <main className="w-full flex-1 px-4 pb-32 pt-6 sm:px-6 md:px-8 lg:px-10 lg:pb-16 lg:pt-10">
          {children}
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BrandRow() {
  return (
    <div className="flex items-center justify-between px-5 pt-6">
      <div className="flex items-center gap-2.5">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-md border border-foreground/12 bg-card shadow-soft">
          <span className="h-[8px] w-[8px] rounded-full bg-primary" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-foreground">
          Momentum
        </span>
      </div>
      <ThemeToggle />
    </div>
  );
}

function ThemeToggle() {
  const { theme, effective, cycle } = useTheme();
  const Icon = theme === "system" ? Monitor : effective === "dark" ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${theme} — click to change`}
      aria-label={`Theme: ${theme}, click to cycle`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.75} />
    </button>
  );
}

function StreakMini() {
  const ready = useStore((s) => s.ready);
  const now = useNow();
  const history = useStore((s) => s.history);
  const tasks = useStore((s) => s.tasks);
  const logs = useStore((s) => s.logs);

  let streak: number | null = null;
  if (ready && now) {
    const key = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const live = liveDayRec(tasks, logs, key);
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

function ProfileLink() {
  return (
    <Link
      href="/profile"
      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/70"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary">
        {PROFILE.name.charAt(0)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">
          {PROFILE.name}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          Personal workspace
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={2} />
    </Link>
  );
}

function DesktopSidebar() {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[240px] flex-col border-r border-border bg-sidebar lg:flex">
      <BrandRow />
      <nav aria-label="Main" className="mt-6 flex-1 overflow-y-auto px-3">
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
      </nav>
      <div className="space-y-1 border-t border-border px-4 py-4">
        <StreakMini />
        <ProfileLink />
      </div>
    </aside>
  );
}

function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
    >
      <div className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5",
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
