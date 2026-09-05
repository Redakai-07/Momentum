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
  /** Numeric flags (e.g. legacy `seeded`) or JSON settings blobs. */
  value: unknown;
}

/**
 * Task/log/section IDs installed by the old development build's demo seed.
 * Used by the v3 migration to remove ONLY these known demo records — any
 * task the user created themselves is never touched.
 */
const LEGACY_DEMO_TASK_IDS = [
  "t-college",
  "t-dsa",
  "t-ml",
  "t-research",
  "t-paper",
  "t-portfolio",
  "t-learn-ml",
  "t-contact-form",
  "t-paper-read",
  "t-interstellar",
  "t-book",
  "t-hampi",
  "t-photography",
  "t-accomp-mtech",
  "t-accomp-portfolio",
] as const;

const LEGACY_DEMO_SECTION_IDS = ["sec-research", "sec-fitness"] as const;

/**
 * Local-first persistence.
 *
 * v1 — core tables (tasks with a `completed` flag, logs, sections, performance).
 * v2 — tasks move to a `status` lifecycle (active/completed/accomplished),
 *      notification records are added, meta accepts JSON blobs. Existing rows
 *      are migrated in place, nothing is wiped.
 * v3 — the demo/example dataset from the old development build is removed
 *      (only when the legacy `seeded` flag marks it as demo data). A fresh
 *      installation starts with zero records and is never seeded.
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
    this.version(3)
      .stores({
        tasks: "id, section, status, dueDate",
        logs: "id, taskId, date",
        sections: "id",
        performance: "date",
        meta: "key",
        notifications: "id, taskId, status",
      })
      .upgrade(async (tx) => {
        const meta = tx.table<MetaRow, string>("meta");
        const seeded = await meta.get("seeded");
        if (!seeded?.value) return; // genuine user data — preserve everything

        // Remove the known demo tasks, their logs and their notifications.
        const demoIds: string[] = [...LEGACY_DEMO_TASK_IDS];
        const tasks = tx.table<Task, string>("tasks");
        await tasks.bulkDelete(demoIds);

        const logsTable = tx.table<TimeLog, string>("logs");
        const allLogs = await logsTable.toArray();
        const demoLogIds = allLogs
          .filter((l) => demoIds.includes(l.taskId))
          .map((l) => l.id);
        if (demoLogIds.length > 0) await logsTable.bulkDelete(demoLogIds);

        await tx
          .table<CustomSection, string>("sections")
          .bulkDelete([...LEGACY_DEMO_SECTION_IDS]);

        const notifs = tx.table<TaskNotification, string>("notifications");
        const demoNotifIds = (await notifs.toArray())
          .filter((n) => demoIds.includes(n.taskId))
          .map((n) => n.id);
        if (demoNotifIds.length > 0) await notifs.bulkDelete(demoNotifIds);

        // If nothing user-created remains, the seeded performance history is
        // demo data too. Otherwise keep it from the earliest real task onward
        // (the seeded rows all predate any real usage).
        const remainingTasks = await tasks.toArray();
        if (remainingTasks.length === 0) {
          await tx.table<DailyPerformance, string>("performance").clear();
          await logsTable.clear();
          await notifs.clear();
        } else {
          const earliest = remainingTasks
            .map((t) => t.createdAt)
            .sort()[0];
          const cutoff = earliest ? earliest.slice(0, 10) : null;
          if (cutoff) {
            const perf = tx.table<DailyPerformance, string>("performance");
            const oldKeys = (await perf.toArray())
              .filter((p) => p.date < cutoff)
              .map((p) => p.date);
            if (oldKeys.length > 0) await perf.bulkDelete(oldKeys);
          }
        }

        await meta.delete("seeded");
      });
    this.version(4)
      .stores({
        tasks: "id, section, status, dueDate",
        logs: "id, taskId, date",
        sections: "id",
        performance: "date",
        meta: "key",
        notifications: "id, taskId, status",
      })
      .upgrade(async (tx) => {
        // v4 — notification intelligence state. Everything lives in the meta
        // key/value table, so nothing structural changes; this only backfills
        // defaults for existing installs. Genuine user data is untouched.
        const meta = tx.table<MetaRow, string>("meta");
        const defaults: Array<[string, unknown]> = [
          ["lastNotificationAt", null],
          ["lastMeaningfulActivityAt", null],
          ["lastTaskCompletionAt", null],
          ["lastInteractionAt", null],
          ["notificationPermissionState", null],
          ["scheduledNotificationIds", []],
        ];
        for (const [key, value] of defaults) {
          const existing = await meta.get(key);
          if (!existing) await meta.put({ key, value });
        }

        // Normalize the settings blob: add quiet-hours defaults where they
        // are missing. Stored cooldown/completion values are left alone —
        // the user's explicit choice always wins.
        const row = await meta.get("notificationSettings");
        if (row?.value && typeof row.value === "object") {
          const s = row.value as Record<string, unknown>;
          const next = { ...s };
          if (next.quietHoursEnabled === undefined) next.quietHoursEnabled = true;
          if (next.quietStart === undefined) next.quietStart = "22:30";
          if (next.quietEnd === undefined) next.quietEnd = "07:00";
          if (JSON.stringify(next) !== JSON.stringify(s)) {
            await meta.put({ key: "notificationSettings", value: next });
          }
        }
      });
  }
}

export const db = new MomentumDB();
