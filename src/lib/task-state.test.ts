import { describe, expect, it } from "vitest";
import { canAccomplish, toAccomplished } from "./task-state";
import type { Task } from "./types";

const base = (o: Partial<Task> & { id: string; title: string }): Task => ({
  section: "daily",
  estimatedMinutes: 90,
  remainingMinutes: 90,
  status: "active",
  createdAt: "2026-01-05T09:00:00.000Z",
  ...o,
});

describe("accomplishment conversion", () => {
  it("converts an active task into an accomplished goal", () => {
    const task = base({
      id: "dsa",
      title: "DSA Preparation",
      nextAction: "Finish the trees chapter",
      description: "Full prep track",
      estimatedMinutes: 120,
    });
    const out = toAccomplished(task, "2026-09-04T18:00:00.000Z");

    expect(out.status).toBe("accomplished");
    expect(out.accomplishedAt).toBe("2026-09-04T18:00:00.000Z");
    expect(out.completedAt).toBe("2026-09-04T18:00:00.000Z");
    expect(out.remainingMinutes).toBe(0);
  });

  it("preserves the original record (history is never destroyed)", () => {
    const task = base({
      id: "mtech",
      title: "M.Tech Software Engineering",
      section: "remainder",
      description: "Coursework + thesis\n\nDone is better than perfect.",
      nextAction: "Defend the thesis",
      dueDate: "2026-08-30",
      priority: "high",
      schedule: undefined,
      customSectionId: undefined,
      createdAt: "2025-07-01T09:00:00.000Z",
    });
    const out = toAccomplished(task, "2026-09-04T18:00:00.000Z");

    expect(out.id).toBe("mtech");
    expect(out.title).toBe("M.Tech Software Engineering");
    expect(out.section).toBe("remainder");
    expect(out.description).toBe(task.description);
    expect(out.nextAction).toBe("Defend the thesis");
    expect(out.dueDate).toBe("2026-08-30");
    expect(out.priority).toBe("high");
    expect(out.createdAt).toBe("2025-07-01T09:00:00.000Z");
    expect(out.estimatedMinutes).toBe(90);
    // Time logs keep referencing the same id, so the history stays intact.
    expect(out.id).toBe(task.id);
  });

  it("keeps an existing completedAt when already completed today", () => {
    const task = base({
      id: "college",
      title: "College Work",
      status: "completed",
      completedAt: "2026-09-04T08:30:00.000Z",
      remainingMinutes: 0,
    });
    const out = toAccomplished(task, "2026-09-04T18:00:00.000Z");
    expect(out.completedAt).toBe("2026-09-04T08:30:00.000Z");
    expect(out.accomplishedAt).toBe("2026-09-04T18:00:00.000Z");
  });
});

describe("canAccomplish — which tasks may become accomplishments", () => {
  it("allows active and completed daily tasks", () => {
    expect(canAccomplish(base({ id: "a", title: "Daily", status: "active" }))).toBe(true);
    expect(
      canAccomplish(
        base({ id: "b", title: "Daily done", status: "completed", completedAt: "2026-09-01T00:00:00.000Z" }),
      ),
    ).toBe(true);
  });

  it("allows active and completed remainder tasks", () => {
    expect(
      canAccomplish(base({ id: "c", title: "Goal", section: "remainder" })),
    ).toBe(true);
  });

  it("rejects occasional (bucket-list) tasks", () => {
    expect(
      canAccomplish(base({ id: "d", title: "Watch Interstellar", section: "occasional" })),
    ).toBe(false);
  });

  it("rejects custom-section and already-accomplished tasks", () => {
    expect(
      canAccomplish(
        base({ id: "e", title: "Research", section: "custom", customSectionId: "sec-1" }),
      ),
    ).toBe(false);
    expect(
      canAccomplish(
        base({
          id: "f",
          title: "Done goal",
          status: "accomplished",
          accomplishedAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe(false);
  });
});
