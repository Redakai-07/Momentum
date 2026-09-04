import Dexie, { type Table } from "dexie";
import type {
  CustomSection,
  DailyPerformance,
  Task,
  TimeLog,
} from "./types";

export interface MetaRow {
  key: string;
  value: number;
}

/**
 * Local-first persistence. Schema v1 covers everything Momentum needs;
 * a future cloud-sync layer can subscribe to these tables.
 */
export class MomentumDB extends Dexie {
  tasks!: Table<Task, string>;
  logs!: Table<TimeLog, string>;
  sections!: Table<CustomSection, string>;
  /** Snapshot of each day's planned vs completed minutes (for streaks). */
  performance!: Table<DailyPerformance, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("momentum");
    this.version(1).stores({
      tasks: "id, section, completed, dueDate",
      logs: "id, taskId, date",
      sections: "id",
      performance: "date",
      meta: "key",
    });
  }
}

export const db = new MomentumDB();
