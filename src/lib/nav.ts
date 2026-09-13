import {
  CalendarDays,
  Home,
  ListChecks,
  NotebookPen,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

/**
 * Primary destinations — the mobile bottom navigation. Deliberately small:
 * Daily / Reminder / Occasional live on Home, and custom sections stay
 * under Profile → Settings → My sections.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Home",
    icon: Home,
    match: (p) => p === "/",
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: CalendarDays,
    match: (p) => p.startsWith("/calendar"),
  },
  {
    href: "/profile",
    label: "Profile",
    icon: UserRound,
    match: (p) => p.startsWith("/profile"),
  },
];

/** Secondary lists — reachable from Home and the desktop sidebar, not from
 *  the mobile bottom bar. Hobby & Notes deliberately lives here (and under
 *  Profile) so it never crowds the productivity dashboard. */
export const LIST_LINKS: NavItem[] = [
  {
    href: "/remainder",
    label: "Reminder",
    icon: ListChecks,
    match: (p) => p.startsWith("/remainder"),
  },
  {
    href: "/occasional",
    label: "Occasional",
    icon: Sparkles,
    match: (p) => p.startsWith("/occasional"),
  },
  {
    href: "/hobbies",
    label: "Hobby & Notes",
    icon: NotebookPen,
    match: (p) => p.startsWith("/hobbies"),
  },
];
