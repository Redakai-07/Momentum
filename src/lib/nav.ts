import {
  CalendarDays,
  Compass,
  LayoutList,
  SunMedium,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Today",
    icon: SunMedium,
    match: (p) => p === "/",
  },
  {
    href: "/remainder",
    label: "Remainder",
    icon: LayoutList,
    match: (p) => p.startsWith("/remainder"),
  },
  {
    href: "/occasional",
    label: "Occasional",
    icon: Compass,
    match: (p) => p.startsWith("/occasional"),
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
