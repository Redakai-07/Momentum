import Dexie, { type Table } from "dexie";
import type {
  CustomSection,
  DailyPerformance,
  Task,
  TimeLog,
} from "./types";
import type { TaskNotification } from "./notifications/types";

export interface MetaRow {
  key: string;
  /** Numeric flags (e.g. `seeded`) or JSON settings blobs. */
  value: unknown;
}

/**
 * Local-first persistence.
 *
 * v1 — core tables (tasks with a `completed` flag, logs, sections, performance).
 * v2 — tasks move to a `status` lifecycle (active/completed/accomplished),
 *      notification records are added, meta accepts JSON blobs. Existing rows
 *      are migrated in place, nothing is wiped.
 */
export class MomentumDB extends Dexie {
  tasks!: Table<Task, string>;
  logs!: Table<TimeLog, string>;
  sections!: Table<CustomSection, string>;
  /** Snapshot of each day's planned vs completed minutes (for streaks). */
  performance!: Table<DailyPerformance, string>;
  meta!: Table<MetaRow, string>;
  notifications!: Table<TaskNotification, string>;

  constructor() {
    super("momentum");
    this.version(1).stores({
      tasks: "id, section, completed, dueDate",
      logs: "id, taskId, date",
      sections: "id",
      performance: "date",
      meta: "key",
    });
    this.version(2)
      .stores({
        tasks: "id, section, status, dueDate",
        logs: "id, taskId, date",
        sections: "id",
        performance: "date",
        meta: "key",
        notifications: "id, taskId, status",
      })
      .upgrade(async (tx) => {
        // Backfill the new lifecycle status from the old completed flag.
        await tx
          .table<Task, string>("tasks")
          .toCollection()
          .modify((t) => {
            if (!t.status) {
              t.status = (t as unknown as { completed?: boolean }).completed
                ? "completed"
                : "active";
            }
          });
      });
  }
}

export const db = new MomentumDB();
