import { create } from "zustand";
import { createSeedState } from "./mock";
import { todayKey, addDaysKey } from "./date";
import { uid } from "./utils";
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
  ready: boolean;
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  history: DailyPerformance[];
  boot: () => void;
  addTask: (input: TaskInput) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string, completed?: boolean) => void;
  logTime: (taskId: string, minutes: number, date?: string) => void;
  addCustomSection: (input: SectionInput) => void;
  removeCustomSection: (id: string) => void;
}

const seed = createSeedState();

export const useStore = create<MomentumState>((set) => ({
  ready: false,
  tasks: [],
  logs: [],
  sections: [],
  history: [],

  boot: () =>
    set((s) =>
      s.ready
        ? s
        : {
            ready: true,
            tasks: seed.tasks,
            logs: seed.logs,
            sections: seed.sections,
            history: seed.history,
          },
    ),

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
    return id;
  },

  updateTask: (id, patch) =>
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
    })),

  deleteTask: (id) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      logs: s.logs.filter((l) => l.taskId !== id),
    })),

  toggleTask: (id, completed) =>
    set((s) => ({
      tasks: s.tasks.map((t) => {
        if (t.id !== id) return t;
        const done = completed ?? !t.completed;
        if (done) {
          return {
            ...t,
            completed: true,
            completedAt: t.completedAt ?? new Date().toISOString(),
            remainingMinutes: 0,
          };
        }
        return {
          ...t,
          completed: false,
          completedAt: undefined,
          // Restore today's full estimate when re-opening a task.
          remainingMinutes: t.estimatedMinutes,
        };
      }),
    })),

  logTime: (taskId, minutes, date) =>
    set((s) => {
      const task = s.tasks.find((t) => t.id === taskId);
      if (!task || task.completed || minutes <= 0) return s;

      const applied = Math.min(Math.round(minutes), Math.max(0, task.remainingMinutes));
      if (applied <= 0) return s;

      const done = task.remainingMinutes - applied <= 0;
      const log: TimeLog = {
        id: uid(),
        taskId,
        minutes: applied,
        date: date ?? todayKey(),
      };

      return {
        tasks: s.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                remainingMinutes: Math.max(0, t.remainingMinutes - applied),
                ...(done
                  ? {
                      completed: true,
                      completedAt: new Date().toISOString(),
                      remainingMinutes: 0,
                    }
                  : {}),
              }
            : t,
        ),
        logs: [...s.logs, log],
      };
    }),

  addCustomSection: (input) =>
    set((s) => ({
      sections: [
        ...s.sections,
        {
          id: uid(),
          name: input.name.trim(),
          icon: input.icon?.trim() || undefined,
          schedule: input.schedule,
          createdAt: new Date().toISOString(),
        },
      ],
    })),

  removeCustomSection: (id) =>
    set((s) => {
      if (s.tasks.some((t) => t.customSectionId === id)) return s;
      return { sections: s.sections.filter((x) => x.id !== id) };
    }),
}));

/** All logs recorded today for a task (for "already logged today" hints). */
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
  const soon = addDaysKey(today, 3);
  return dueKey >= today && dueKey <= soon;
}
