import { describe, expect, it } from "vitest";
import { applyRecoveryKinds, usedRecoveries } from "./activity";
import { isNeutralRec, type DayRec } from "./performance";
import { addDaysKey } from "./date";

const TODAY = "2026-03-11";

const rec = (date: string, planned: number, done: number): DayRec => ({
  date,
  plannedMinutes: planned,
  completedMinutes: done,
  percentage: planned > 0 ? Math.round((done / planned) * 100) : null,
});

/** `n` consecutive qualifying days ending the day before `endInclusive`. */
function goodRun(endInclusive: string, n: number): DayRec[] {
  const out: DayRec[] = [];
  for (let i = n; i >= 1; i--) {
    out.push(rec(addDaysKey(endInclusive, -i), 200, 170)); // 85%
  }
  return out;
}

describe("recovery-day qualification", () => {
  it("marks an earned missed day as recovery after enough consistency", () => {
    const full = [...goodRun(TODAY, 5), rec(TODAY, 200, 40)]; // missed today
    const out = applyRecoveryKinds(full, addDaysKey(TODAY, 1));
    const last = out[out.length - 1];
    expect(last.kind).toBe("recovery");
    expect(isNeutralRec(last)).toBe(true); // keeps the streak intact
    expect(last.percentage).toBe(20); // still honestly recorded as a 20% day
  });

  it("leaves an unearned missed day as normal (breaks the streak)", () => {
    const full = [
      rec(addDaysKey(TODAY, -2), 200, 170), // only two good days before
      rec(addDaysKey(TODAY, -1), 200, 170),
      rec(TODAY, 200, 40), // missed
    ];
    const out = applyRecoveryKinds(full, addDaysKey(TODAY, 1));
    const last = out[out.length - 1];
    expect(last.kind).toBe("normal");
    expect(isNeutralRec(last)).toBe(false);
  });

  it("never classifies today — an in-progress day is not yet a failure", () => {
    const full = [...goodRun(TODAY, 5), rec(TODAY, 200, 40)];
    const out = applyRecoveryKinds(full, TODAY); // today is still today
    const last = out[out.length - 1];
    expect(last.kind).toBe("normal");
    expect(isNeutralRec(last)).toBe(false);
  });

  it("caps recoveries at two per calendar month", () => {
    const pad = (day: number) => `2026-03-${String(day).padStart(2, "0")}`;
    const rows: DayRec[] = [
      // February run earns the very first March miss.
      ...goodRun("2026-03-01", 5), // Feb 24–28
      rec(pad(1), 200, 170), // Mar 1
      rec(pad(2), 200, 40), // missed → recovery #1
      ...goodRun(pad(8), 5), // Mar 3–7
      rec(pad(8), 200, 40), // missed → recovery #2
      ...goodRun(pad(14), 5), // Mar 9–13
      rec(pad(14), 200, 40), // missed → budget spent → normal
    ];
    const out = applyRecoveryKinds(rows, pad(20));
    const missed = out.filter((r) =>
      r.date === pad(2) || r.date === pad(8) || r.date === pad(14),
    );
    expect(missed.map((r) => r.kind)).toEqual(["recovery", "recovery", "normal"]);
    expect(usedRecoveries(out, "2026-03")).toBe(2);
  });

  it("a prior unearned failed day blocks a later failed day in the window", () => {
    const full = [
      rec(addDaysKey(TODAY, -4), 200, 170),
      rec(addDaysKey(TODAY, -3), 200, 170),
      rec(addDaysKey(TODAY, -2), 200, 40), // fails without enough run
      rec(addDaysKey(TODAY, -1), 200, 40), // its window contains the failure above
    ];
    const out = applyRecoveryKinds(full, TODAY);
    expect(out.slice(-2).map((r) => r.kind)).toEqual(["normal", "normal"]);
  });

  it("classifies rest days (nothing planned) as inactive, never recovery", () => {
    const full = [rec(addDaysKey(TODAY, -1), 0, 0), rec(TODAY, 0, 0)];
    const out = applyRecoveryKinds(full, addDaysKey(TODAY, 1));
    expect(out.map((r) => r.kind)).toEqual(["inactive", "inactive"]);
  });

  it("keeps strong days as normal working days", () => {
    const out = applyRecoveryKinds([rec(TODAY, 200, 190)], addDaysKey(TODAY, 1));
    expect(out[0].kind).toBe("normal");
    expect(isNeutralRec(out[0])).toBe(false);
  });
});
