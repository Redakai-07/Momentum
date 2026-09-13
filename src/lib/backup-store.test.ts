import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for the export/import actions against a real (in-memory)
 * IndexedDB.
 *
 * These exist because the guarantees that matter most here are not expressible
 * as pure functions: an import must replace everything or nothing, it must not
 * duplicate records when run twice, and it must refuse to run when it cannot
 * first save a safety copy of what it is about to overwrite.
 */

const shared = vi.hoisted(() => ({
  saved: [] as { filename: string; json: string }[],
  fail: false,
}));

vi.mock("./backup-io", () => ({
  MAX_BACKUP_BYTES: 64 * 1024 * 1024,
  saveBackup: async (json: string, filename: string) => {
    if (shared.fail) return { ok: false, error: "downloads blocked" };
    shared.saved.push({ filename, json });
    return { ok: true, destination: "downloaded" as const };
  },
  readBackupFile: async () => ({ ok: true, text: "" }),
  formatBytes: () => "0 B",
}));

import { parseBackup, BACKUP_FORMAT, BACKUP_VERSION, type MomentumBackup } from "./backup";
import { addDays, dateKey, todayKey } from "./date";
import { currentStreak } from "./performance";
import type { CustomSection, DailyPerformance, Hobby, Note, Task, TimeLog } from "./types";

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

type Db = Awaited<typeof import("./db")>["db"];
type Store = Awaited<typeof import("./store")>["useStore"];

/**
 * Fresh modules per test: `boot()` is memoised per module instance, so a new
 * instance is what gives each test a clean hydrate against the same in-memory
 * database.
 */
async function setup(): Promise<{ db: Db; useStore: Store }> {
  vi.resetModules();
  const { db } = await import("./db");
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  const { useStore } = await import("./store");
  await useStore.getState().boot();
  return { db, useStore };
}

async function clearAll(db: Db): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
}

const daysAgo = (n: number) => dateKey(addDays(new Date(), -n));

/* ---------------------------- fixtures ---------------------------- */

const dailyTask: Task = {
  id: "t-dsa",
  title: "DSA Practice",
  section: "daily",
  estimatedMinutes: 60,
  remainingMinutes: 20,
  status: "active",
  createdAt: "2026-08-01T08:00:00.000Z",
};

const reminderTask: Task = {
  id: "t-form",
  title: "Submit scholarship form",
  section: "remainder",
  estimatedMinutes: null,
  remainingMinutes: 0,
  status: "completed",
  createdAt: "2026-08-02T08:00:00.000Z",
  completedAt: "2026-08-02T09:00:00.000Z",
};

const occasionalTask: Task = {
  id: "t-movie",
  title: "Watch Interstellar",
  section: "occasional",
  estimatedMinutes: null,
  remainingMinutes: 0,
  status: "active",
  createdAt: "2026-08-03T08:00:00.000Z",
};

const customTask: Task = {
  id: "t-paper",
  title: "Read research paper",
  section: "custom",
  customSectionId: "sec-research",
  estimatedMinutes: 45,
  remainingMinutes: 45,
  status: "active",
  createdAt: "2026-08-04T08:00:00.000Z",
};

const researchSection: CustomSection = {
  id: "sec-research",
  name: "Research",
  icon: "🔬",
  schedule: { type: "weekly", days: [1, 3, 5] },
  createdAt: "2026-08-04T08:00:00.000Z",
};

const photoHobby: Hobby = {
  id: "h-photo",
  name: "Photography",
  icon: "📷",
  accent: "blue",
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
};

const filedNote: Note = {
  id: "n-filed",
  hobbyId: "h-photo",
  title: "Golden hour",
  content: "Shoot 20 minutes before sunset.",
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-06T10:00:00.000Z",
};

const looseNote: Note = {
  id: "n-loose",
  title: "Loose thought",
  content: "No hobby attached.",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

/** Three consecutive qualifying days, ending yesterday. */
function qualifyingLogs(): TimeLog[] {
  return [1, 2, 3].map((n) => ({
    id: `l-${n}`,
    taskId: "t-dsa",
    minutes: 60,
    date: daysAgo(n),
  }));
}

function qualifyingPerformance(): DailyPerformance[] {
  return [1, 2, 3].map((n) => ({
    date: daysAgo(n),
    plannedMinutes: 60,
    completedMinutes: 60,
    percentage: 100,
  }));
}

async function seedWorkspace(db: Db): Promise<void> {
  await db.tasks.bulkPut([dailyTask, reminderTask, occasionalTask, customTask]);
  await db.sections.bulkPut([researchSection]);
  await db.logs.bulkPut(qualifyingLogs());
  await db.performance.bulkPut(qualifyingPerformance());
  await db.hobbies.bulkPut([photoHobby]);
  await db.notes.bulkPut([filedNote, looseNote]);
  await db.meta.bulkPut([
    { key: "profileName", value: "Aditi" },
    { key: "accentColor", value: "purple" },
    { key: "firstRunAt", value: "2026-08-01T00:00:00.000Z" },
    {
      key: "notificationSettings",
      value: {
        enabled: true,
        cooldownMinutes: 30,
        taskReminders: true,
        specialTaskReminders: false,
        overdueReminders: true,
        quietHoursEnabled: true,
        quietStart: "23:00",
        quietEnd: "06:30",
        morningHour: 9,
        snoozeMinutes: 30,
        completionCooldownMinutes: 30,
      },
    },
    // Device facts that must never travel with a backup.
    { key: "notificationPermissionState", value: "denied" },
    { key: "scheduledNotificationIds", value: [{ id: 42 }] },
  ]);
}

beforeEach(() => {
  shared.saved.length = 0;
  shared.fail = false;
});

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

describe("exportBackup", () => {
  it("writes a complete, parseable backup and records the time", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();

    const result = await useStore.getState().exportBackup();
    expect(result.ok).toBe(true);
    expect(shared.saved).toHaveLength(1);
    expect(shared.saved[0].filename).toMatch(/^momentum-backup-\d{4}-\d{2}-\d{2}\.json$/);

    const parsed = parseBackup(shared.saved[0].json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.data.tasks.map((t) => t.id).sort()).toEqual([
      "t-dsa",
      "t-form",
      "t-movie",
      "t-paper",
    ]);
    expect(parsed.backup.data.sections[0].schedule).toEqual({ type: "weekly", days: [1, 3, 5] });
    expect(parsed.backup.data.notes).toHaveLength(2);
    expect(parsed.backup.data.performance.length).toBeGreaterThanOrEqual(3);
    expect(parsed.backup.data.settings.meta.profileName).toBe("Aditi");
    expect(parsed.backup.data.settings.meta.accentColor).toBe("purple");
    expect(parsed.backup.data.settings.meta.notificationPermissionState).toBeUndefined();
    expect(parsed.backup.data.settings.meta.scheduledNotificationIds).toBeUndefined();

    expect(useStore.getState().lastBackupAt).toBeTruthy();
    expect(await db.meta.get("lastBackupAt")).toBeTruthy();
  });

  it("surfaces a failure instead of claiming success", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();

    shared.fail = true;
    const result = await useStore.getState().exportBackup();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(useStore.getState().lastBackupAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

describe("importBackup", () => {
  it("restores a full workspace into an empty install with no duplicates", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();

    const exported = await useStore.getState().exportBackup();
    expect(exported.ok).toBe(true);
    const parsed = parseBackup(shared.saved[0].json);
    if (!parsed.ok) throw new Error(parsed.error);

    const expected = {
      tasks: await db.tasks.count(),
      logs: await db.logs.count(),
      sections: await db.sections.count(),
      performance: await db.performance.count(),
      hobbies: await db.hobbies.count(),
      notes: await db.notes.count(),
    };

    // Simulate a fresh installation: the local database is gone.
    await clearAll(db);
    expect(await db.tasks.count()).toBe(0);

    const result = await useStore.getState().importBackup(parsed.backup);
    expect(result.ok).toBe(true);

    expect(await db.tasks.count()).toBe(expected.tasks);
    expect(await db.logs.count()).toBe(expected.logs);
    expect(await db.sections.count()).toBe(expected.sections);
    expect(await db.hobbies.count()).toBe(expected.hobbies);
    expect(await db.notes.count()).toBe(expected.notes);

    // Historical snapshots come back untouched, and today's is rebuilt from
    // the restored tasks rather than carried over stale from the backup.
    const perfRows = await db.performance.toArray();
    expect(perfRows.filter((p) => p.date !== todayKey())).toHaveLength(expected.performance);
    const todayRow = perfRows.find((p) => p.date === todayKey());
    expect(todayRow?.plannedMinutes).toBeGreaterThan(0);

    // History, dates and relationships survive.
    const logs = await db.logs.toArray();
    expect(logs.map((l) => l.date).sort()).toEqual(qualifyingLogs().map((l) => l.date).sort());
    const restoredSection = await db.sections.get("sec-research");
    expect(restoredSection?.schedule).toEqual({ type: "weekly", days: [1, 3, 5] });
    const restoredTask = await db.tasks.get("t-paper");
    expect(restoredTask?.customSectionId).toBe("sec-research");
    const restoredNote = await db.notes.get("n-filed");
    expect(restoredNote?.hobbyId).toBe("h-photo");
    expect((await db.tasks.get("t-form"))?.estimatedMinutes).toBeNull();

    // Settings are restored and device facts are left alone.
    expect((await db.meta.get("profileName"))?.value).toBe("Aditi");
    expect((await db.meta.get("accentColor"))?.value).toBe("purple");
    expect(useStore.getState().profileName).toBe("Aditi");
    expect(useStore.getState().notificationSettings.cooldownMinutes).toBe(30);
    expect(useStore.getState().notificationSettings.quietStart).toBe("23:00");
    expect(useStore.getState().notificationSettings.taskReminders).toBe(true);
    expect(useStore.getState().notificationSettings.specialTaskReminders).toBe(false);

    // No duplicate primary keys anywhere.
    for (const table of ["tasks", "logs", "sections", "hobbies", "notes"] as const) {
      const ids = (await db.table(table).toArray()).map((r: { id: string }) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("recomputes the streak from the restored history", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();
    await useStore.getState().exportBackup();
    const parsed = parseBackup(shared.saved[0].json);
    if (!parsed.ok) throw new Error(parsed.error);

    await clearAll(db);
    await useStore.getState().importBackup(parsed.backup);

    const history = useStore.getState().history;
    expect(history.filter((h) => h.percentage === 100).length).toBeGreaterThanOrEqual(3);
    expect(currentStreak(history, todayKey())).toBe(3);
  });

  it("is idempotent — importing the same backup twice does not duplicate data", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();
    await useStore.getState().exportBackup();
    const parsed = parseBackup(shared.saved[0].json);
    if (!parsed.ok) throw new Error(parsed.error);

    await clearAll(db);
    await useStore.getState().importBackup(parsed.backup);
    const afterFirst = {
      tasks: await db.tasks.count(),
      logs: await db.logs.count(),
      notes: await db.notes.count(),
    };

    await useStore.getState().importBackup(parsed.backup);
    expect({
      tasks: await db.tasks.count(),
      logs: await db.logs.count(),
      notes: await db.notes.count(),
    }).toEqual(afterFirst);
  });

  it("saves the data being replaced before overwriting it", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();

    const incoming = parseBackup(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        data: {
          tasks: [
            {
              id: "t-new",
              title: "Incoming task",
              section: "daily",
              estimatedMinutes: 30,
              remainingMinutes: 30,
              status: "active",
              createdAt: new Date().toISOString(),
            },
          ],
          logs: [],
          sections: [],
          performance: [],
          hobbies: [],
          notes: [],
          settings: { meta: {}, theme: null },
        },
      }),
    );
    if (!incoming.ok) throw new Error(incoming.error);

    const result = await useStore.getState().importBackup(incoming.backup);
    expect(result.ok).toBe(true);
    expect(result.safety?.ok).toBe(true);
    expect(result.safety?.filename).toMatch(/^momentum-pre-import-backup-/);

    // The safety copy holds the workspace that was just replaced.
    const safety = shared.saved.find((s) => s.filename.startsWith("momentum-pre-import-backup"));
    expect(safety).toBeTruthy();
    const safetyParsed = parseBackup(safety!.json);
    if (!safetyParsed.ok) throw new Error(safetyParsed.error);
    expect(safetyParsed.backup.data.tasks.map((t) => t.title).sort()).toEqual([
      "DSA Practice",
      "Read research paper",
      "Submit scholarship form",
      "Watch Interstellar",
    ]);

    // And the new data won.
    const titles = (await db.tasks.toArray()).map((t) => t.title);
    expect(titles).toEqual(["Incoming task"]);
  });

  it("refuses to import when it cannot first save a safety copy", async () => {
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();

    shared.fail = true;
    const result = await useStore.getState().importBackup({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        tasks: [],
        logs: [],
        sections: [],
        performance: [],
        hobbies: [],
        notes: [],
        settings: { meta: {}, theme: null },
      },
    });
    shared.fail = false;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/safety copy/i);
    // Nothing was touched.
    expect(await db.tasks.count()).toBe(4);
    expect((await db.tasks.get("t-dsa"))?.title).toBe("DSA Practice");
  });

  it("leaves existing data untouched when the write fails part-way", async () => {
    // The rollback is intentional, so Dexie's ConstraintError noise is not a
    // test failure — silence it to keep the output readable.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, useStore } = await setup();
    await seedWorkspace(db);
    await useStore.getState().boot();
    const before = await db.tasks.toArray();

    // A backup that bypassed validation: duplicate ids make the first write
    // fail, which must roll the whole transaction back.
    const dirty: MomentumBackup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        tasks: [
          { ...dailyTask, id: "dup", title: "Should never persist" },
          { ...dailyTask, id: "dup", title: "Should never persist either" },
        ],
        logs: [],
        sections: [],
        performance: [],
        hobbies: [],
        notes: [],
        settings: { meta: {}, theme: null },
      },
    };

    const result = await useStore.getState().importBackup(dirty);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/left unchanged/i);

    expect(await db.tasks.toArray()).toEqual(before);
    expect(await db.logs.count()).toBe(3);
    expect(await db.notes.count()).toBe(2);
    expect((await db.meta.get("profileName"))?.value).toBe("Aditi");
    quiet.mockRestore();
  });
});
