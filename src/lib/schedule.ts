import { parseKey } from "./date";
import type { CustomSection, MonthOccurrence, Schedule, Task } from "./types";

/** Does a schedule fire on the given date? */
export function scheduleOccursOn(schedule: Schedule, date: Date): boolean {
  if (schedule.type === "daily") return true;
  if (schedule.type === "monthly-date") {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    if (schedule.dayOfMonth === "last") return date.getDate() === lastDay;
    return schedule.dayOfMonth !== undefined && date.getDate() === schedule.dayOfMonth &&
      schedule.dayOfMonth >= 1 && schedule.dayOfMonth <= lastDay;
  }
  if (schedule.type === "monthly-weekday") {
    if (schedule.weekday === undefined || !schedule.occurrence) return false;
    const matches: Date[] = [];
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const candidate = new Date(date.getFullYear(), date.getMonth(), day);
      if (candidate.getDay() === schedule.weekday) matches.push(candidate);
    }
    const index = occurrenceIndex(schedule.occurrence, matches.length);
    return index !== null && matches[index]?.getDate() === date.getDate();
  }
  const days = schedule.days;
  if (!days || days.length === 0) return false;
  return days.includes(date.getDay() as (typeof days)[number]);
}

function occurrenceIndex(occurrence: MonthOccurrence, count: number): number | null {
  if (occurrence === "first") return 0;
  if (occurrence === "second") return count >= 2 ? 1 : null;
  if (occurrence === "third") return count >= 3 ? 2 : null;
  if (occurrence === "fourth") return count >= 4 ? 3 : null;
  return count > 0 ? count - 1 : null;
}

/** Resolve the section-owned schedule, retaining legacy task schedules safely. */
export function scheduleForTask(task: Task, sections: CustomSection[] = []): Schedule | null {
  // Existing installs may have per-task recurrence. Keep it authoritative for
  // those records; newly-created tasks omit this field and inherit below.
  if (task.schedule) return task.schedule;
  if (task.section === "daily") return { type: "daily" };
  if (task.section === "custom" && task.customSectionId) {
    return sections.find((section) => section.id === task.customSectionId)?.schedule ?? null;
  }
  return null;
}

/**
 * A task is "present" on a date when it recurs that day (schedule) or
 * is a one-off with that exact due date. Completed tasks stay present so
 * the calendar can show history.
 */
export function taskOccursOn(task: Task, key: string, sections: CustomSection[] = []): boolean {
  // Accomplished goals left the rotation — their history lives separately.
  if (task.status === "accomplished") return false;
  const date = parseKey(key);
  const schedule = scheduleForTask(task, sections);
  if (schedule) {
    return scheduleOccursOn(schedule, date);
  }
  return task.dueDate === key;
}

export interface DayGroup {
  id: string;
  title: string;
  icon?: string;
  tasks: Task[];
}

export interface DayBreakdown {
  /** Open tasks whose due date is today — the Special Tasks. */
  specials: Task[];
  /** Completed special tasks from today. */
  specialsDone: Task[];
  /** Recurring (daily + custom-section) tasks grouped by section. */
  groups: DayGroup[];
}

/**
 * What the Today dashboard should show for `key`: recurring tasks grouped
 * by section, plus due-today specials. Remainder/occasional one-offs only
 * reach the dashboard through the special channel (their due date).
 */
export function breakdownForDay(
  tasks: Task[],
  sections: CustomSection[],
  key: string,
): DayBreakdown {
  const onDay = tasks.filter((t) => taskOccursOn(t, key, sections));

  const specials: Task[] = [];
  const specialsDone: Task[] = [];
  for (const t of onDay) {
    if (t.section !== "daily" && t.section !== "custom" && t.dueDate === key) {
      (t.status === "completed" ? specialsDone : specials).push(t);
    }
  }

  const groups: DayGroup[] = [];
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  const builtins: { id: string; title: string; icon?: string; tasks: Task[] }[] = [
    { id: "builtin-daily", title: "Daily", tasks: [] },
  ];
  const customGroups = new Map<string, DayGroup>();

  for (const t of onDay) {
    if (t.section === "daily") {
      builtins[0].tasks.push(t);
    } else if (t.section === "custom" && t.customSectionId) {
      const section = sectionById.get(t.customSectionId);
      const id = section?.id ?? t.customSectionId;
      let g = customGroups.get(id);
      if (!g) {
        g = {
          id,
          title: section?.name ?? "Custom",
          icon: section?.icon,
          tasks: [],
        };
        customGroups.set(id, g);
      }
      g.tasks.push(t);
    }
  }

  if (builtins[0].tasks.length > 0) groups.push(builtins[0]);
  for (const s of sections) {
    // Always surface every custom section on Home — even empty ones — so users
    // can see their sections and add tasks to them.
    let g = customGroups.get(s.id);
    if (!g) {
      g = { id: s.id, title: s.name, icon: s.icon, tasks: [] };
    }
    groups.push(g);
  }

  const sortTasks = (a: Task, b: Task) => {
    const ad = a.status === "active" ? 0 : 1;
    const bd = b.status === "active" ? 0 : 1;
    if (ad !== bd) return ad - bd;
    const ta = a.schedule?.startTime ?? "";
    const tb = b.schedule?.startTime ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.title.localeCompare(b.title);
  };
  for (const g of groups) g.tasks.sort(sortTasks);

  return { specials, specialsDone, groups };
}

/** Tasks to list for a calendar day (recurring + due), sorted. */
export function tasksForDay(tasks: Task[], key: string, sections: CustomSection[] = []): Task[] {
  return tasks
    .filter((t) => taskOccursOn(t, key, sections))
    .sort((a, b) => {
      const ta = scheduleForTask(a, sections)?.startTime ?? "99";
      const tb = scheduleForTask(b, sections)?.startTime ?? "99";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.title.localeCompare(b.title);
    });
}
