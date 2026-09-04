import { create } from "zustand";
import { db } from "./db";
import { createSeedState } from "./seed";
import { dateKey, todayKey } from "./date";
import { uid } from "./utils";
import { liveDayRec } from "./performance";
import type {
  CustomSection,
  DailyPerformance,
  Priority,
  Schedule,
  SectionKind,
  Task,
  TimeLog,
} from "./types";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface TaskInput {
  title: string;
  section: SectionKind;
  customSectionId?: string;
  estimatedMinutes: number;
  description?: string;
  nextAction?: string;
  dueDate?: string;
  priority?: Priority;
  schedule?: Schedule;
}

export interface SectionInput {
  name: string;
  icon?: string;
  schedule: Schedule;
}

interface MomentumState {
  /** True once IndexedDB has hydrated (or failed) and the UI can render. */
  ready: boolean;
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  /** Daily performance snapshots, oldest first. */
  history: DailyPerformance[];
  boot: () => Promise<void>;
  addTask: (input: TaskInput) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string, completed?: boolean) => void;
  logTime: (taskId: string, minutes: number, date?: string) => void;
  addCustomSection: (input: SectionInput) => void;
  removeCustomSection: (id: string) => void;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isoDay = (iso?: string): string | null => {
  if (!iso) return null;
  try {
    return dateKey(new Date(iso));
  } catch {
    return null;
  }
};

function replaceToday(history: DailyPerformance[], rec: DailyPerformance): DailyPerformance[] {
  const idx = history.findIndex((h) => h.date === rec.date);
  if (idx === -1) return [...history, rec].sort((a, b) => (a.date < b.date ? -1 : 1));
  const next = [...history];
  next[idx] = rec;
  return next;
}

/**
 * Snapshot one day's record to IndexedDB. Today is always recomputed from
 * the live tasks/logs; historical snapshots are only written when missing
 * so seeded past records stay stable.
 */
async function persistDayRec(tasks: Task[], logs: TimeLog[], key: string): Promise<void> {
  const rec = liveDayRec(tasks, logs, key);
  const existing = await db.performance.get(key);
  const writeable = key === todayKey() || !existing;
  if (!writeable) return;
  if (rec.plannedMinutes > 0 || rec.completedMinutes > 0) {
    await db.performance.put(rec);
  } else if (existing) {
    await db.performance.delete(key);
  }
}

/** Recompute + persist today's snapshot and refresh in-memory history. */
async function syncToday(set: (fn: (s: MomentumState) => Partial<MomentumState>) => void) {
  const s = useStore.getState();
  try {
    const rec = liveDayRec(s.tasks, s.logs, todayKey());
    await persistDayRec(s.tasks, s.logs, todayKey());
    set(() => ({ history: replaceToday(s.history, rec) }));
  } catch (err) {
    console.error("Failed to sync today's performance:", err);
  }
}

/**
 * A new day resets recurring tasks: yesterday's completion/partial progress
 * belongs to yesterday. One-off tasks (due dates, no schedule) keep state.
 */
function applyDayRollover(tasks: Task[], logs: TimeLog[]): { next: Task[]; changed: Task[] } {
  const today = todayKey();
  const loggedToday = new Set(logs.filter((l) => l.date === today).map((l) => l.taskId));
  const changed: Task[] = [];
  const next = tasks.map((t) => {
    if (!t.schedule) return t;
    const doneDay = isoDay(t.completedAt);
    if (t.completed && doneDay !== null && doneDay < today) {
      const n: Task = {
        ...t,
        completed: false,
        completedAt: undefined,
        remainingMinutes: t.estimatedMinutes,
      };
      changed.push(n);
      return n;
    }
    if (
      !t.completed &&
      t.remainingMinutes < t.estimatedMinutes &&
      !loggedToday.has(t.id) &&
      doneDay !== today
    ) {
      const n: Task = { ...t, remainingMinutes: t.estimatedMinutes };
      changed.push(n);
      return n;
    }
    return t;
  });
  return { next, changed };
}

const logError = (where: string) => (err: unknown) => {
  console.error(`Momentum: ${where} failed to persist:`, err);
};

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

let bootPromise: Promise<void> | null = null;

async function doBoot(): Promise<void> {
  const [taskRows, logRows, sectionRows, perfRows] = await Promise.all([
    db.tasks.toArray(),
    db.logs.toArray(),
    db.sections.toArray(),
    db.performance.toArray(),
  ]);
  const seededFlag = await db.meta.get("seeded");

  let tasks = taskRows;
  let logs = logRows;
  let sections = sectionRows;
  let history = perfRows;

  // First run — install the example workspace exactly once.
  if (tasks.length === 0 && !seededFlag?.value) {
    const seed = createSeedState();
    await db.transaction(
      "rw",
      [db.tasks, db.logs, db.sections, db.performance, db.meta],
      async () => {
        if ((await db.tasks.count()) === 0) {
          if (seed.tasks.length > 0) await db.tasks.bulkAdd(seed.tasks);
          if (seed.logs.length > 0) await db.logs.bulkAdd(seed.logs);
          if (seed.sections.length > 0) await db.sections.bulkAdd(seed.sections);
          if (seed.history.length > 0) await db.performance.bulkAdd(seed.history);
          await db.meta.put({ key: "seeded", value: 1 });
        }
      },
    );
    [tasks, logs, sections, history] = await Promise.all([
      db.tasks.toArray(),
      db.logs.toArray(),
      db.sections.toArray(),
      db.performance.toArray(),
    ]);
  }

  const { next, changed } = applyDayRollover(tasks, logs);
  if (changed.length > 0) {
    await db.tasks.bulkPut(changed);
    tasks = next;
  }

  // Make sure today has a snapshot row.
  const today = todayKey();
  if (history.findIndex((h) => h.date === today) === -1) {
    await persistDayRec(tasks, logs, today);
    history = await db.performance.toArray();
  }

  useStore.setState({ ready: true, tasks, logs, sections, history });
}

export const useStore = create<MomentumState>((set, get) => ({
  ready: false,
  tasks: [],
  logs: [],
  sections: [],
  history: [],

  boot: () => {
    if (!bootPromise) {
      bootPromise = doBoot().catch(async (err) => {
        console.error("Momentum: failed to hydrate local database:", err);
        bootPromise = null;
        // Surface whatever we have so the UI is never stuck on a loader.
        const [tasks, logs, sections, history] = await Promise.all([
          db.tasks.toArray(),
          db.logs.toArray(),
          db.sections.toArray(),
          db.performance.toArray(),
        ]);
        useStore.setState({ ready: true, tasks, logs, sections, history });
      });
    }
    return bootPromise;
  },

  /* ------------------------------ Tasks ------------------------------ */

  addTask: (input) => {
    const id = uid();
    const task: Task = {
      id,
      title: input.title.trim(),
      section: input.section,
      customSectionId: input.customSectionId,
      estimatedMinutes: Math.max(0, Math.round(input.estimatedMinutes)),
      remainingMinutes: Math.max(0, Math.round(input.estimatedMinutes)),
      description: input.description?.trim() || undefined,
      nextAction: input.nextAction?.trim() || undefined,
      dueDate: input.dueDate || undefined,
      priority: input.priority,
      schedule: input.schedule,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tasks: [task, ...s.tasks] }));
    db.tasks.add(task).then(() => syncToday(set)).catch(logError("create task"));
    return id;
  },

  updateTask: (id, patch) => {
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        const next: Task = { ...t, ...patch };

        // Keep the "remaining = estimated − logged" invariant when the
        // estimate changes on a task that is still in progress.
        if (
          patch.estimatedMinutes !== undefined &&
          patch.estimatedMinutes !== t.estimatedMinutes &&
          !next.completed
        ) {
          const burned = t.estimatedMinutes - t.remainingMinutes;
          next.remainingMinutes = Math.max(0, next.estimatedMinutes - burned);
        }
        if (next.completed) next.remainingMinutes = 0;
        return next;
      }),
    }));
    const updated = get().tasks.find((t) => t.id === id);
    if (updated) {
      db.tasks.put(updated).then(() => syncToday(set)).catch(logError("update task"));
    }
  },

  deleteTask: (id) => {
    const removedLogDates = new Set(
      get().logs.filter((l) => l.taskId === id).map((l) => l.date),
    );
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      logs: s.logs.filter((l) => l.taskId !== id),
    }));
    db.transaction("rw", [db.tasks, db.logs], async () => {
      await db.tasks.delete(id);
      await db.logs.where("taskId").equals(id).delete();
    })
      .then(() => {
        if (removedLogDates.has(todayKey())) return syncToday(set);
      })
      .catch(logError("delete task"));
  },

  toggleTask: (id, completed) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return;
    const done = completed ?? !task.completed;

    const next: Task = done
      ? {
          ...task,
          completed: true,
          completedAt: task.completedAt ?? new Date().toISOString(),
          remainingMinutes: 0,
        }
      : {
          ...task,
          completed: false,
          completedAt: undefined,
          remainingMinutes: task.estimatedMinutes,
        };

    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? next : t)) }));
    db.tasks.put(next).catch(logError("toggle task"));
  },

  logTime: (taskId, minutes, date) => {
    const state = get();
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || task.completed || minutes <= 0) return;

    const applied = Math.min(Math.round(minutes), Math.max(0, task.remainingMinutes));
    if (applied <= 0) return;
    const logDate = date ?? todayKey();
    const done = task.remainingMinutes - applied <= 0;

    const nextTask: Task = done
      ? {
          ...task,
          completed: true,
          completedAt: new Date().toISOString(),
          remainingMinutes: 0,
        }
      : { ...task, remainingMinutes: Math.max(0, task.remainingMinutes - applied) };

    const log: TimeLog = { id: uid(), taskId, minutes: applied, date: logDate };

    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? nextTask : t)),
      logs: [...s.logs, log],
    }));

    db.transaction("rw", [db.tasks, db.logs], async () => {
      await db.tasks.put(nextTask);
      await db.logs.add(log);
    })
      .then(() => syncToday(set))
      .catch(logError("log time"));
  },

  /* -------------------------- Custom sections ------------------------ */

  addCustomSection: (input) => {
    const section: CustomSection = {
      id: uid(),
      name: input.name.trim(),
      icon: input.icon?.trim() || undefined,
      schedule: input.schedule,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ sections: [...s.sections, section] }));
    db.sections.add(section).catch(logError("create section"));
  },

  removeCustomSection: (id) => {
    if (get().tasks.some((t) => t.customSectionId === id)) return;
    set((s) => ({ sections: s.sections.filter((x) => x.id !== id) }));
    db.sections.delete(id).catch(logError("delete section"));
  },
}));

/* ------------------------------------------------------------------ */
/* Selectors / helpers                                                 */
/* ------------------------------------------------------------------ */

/** Minutes logged today (any date) for a task. */
export function loggedTodayForTask(
  logs: TimeLog[],
  taskId: string,
  date: string = todayKey(),
): number {
  return logs
    .filter((l) => l.taskId === taskId && l.date === date)
    .reduce((s, l) => s + l.minutes, 0);
}

export function isDueSoon(dueKey: string): boolean {
  const today = todayKey();
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() + 3);
  const soon = dateKey(d);
  return dueKey >= today && dueKey <= soon;
}
