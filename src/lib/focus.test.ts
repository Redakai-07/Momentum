import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOCUS_SETTINGS,
  advancePhase,
  clampFocusSettings,
  elapsedMs,
  focusMinutesWorked,
  formatClock,
  isPhaseComplete,
  normalizeSession,
  pauseSession,
  phaseProgress,
  phaseLabel,
  remainingMs,
  resumeSession,
  startSession,
  targetMs,
  type FocusSettings,
} from "./focus";

const S: FocusSettings = { ...DEFAULT_FOCUS_SETTINGS };
const T0 = new Date(2026, 8, 17, 10, 0).getTime(); // 2026-09-17 10:00 local
const MIN = 60_000;
const HOUR = 60 * MIN;

const started = (at = T0) => startSession("task-1", at, "session-1");

describe("focus settings", () => {
  it("defaults to a standard 25 / 5 / 15 cycle", () => {
    expect(DEFAULT_FOCUS_SETTINGS.focusMinutes).toBe(25);
    expect(DEFAULT_FOCUS_SETTINGS.shortBreakMinutes).toBe(5);
    expect(DEFAULT_FOCUS_SETTINGS.longBreakMinutes).toBe(15);
  });

  it("clamps nonsense values instead of accepting them", () => {
    const s = clampFocusSettings({
      focusMinutes: 9999,
      shortBreakMinutes: -4,
      longBreakMinutes: Number.NaN,
      sessionsBeforeLongBreak: 0,
    });
    expect(s.focusMinutes).toBe(120);
    expect(s.shortBreakMinutes).toBe(1);
    expect(s.longBreakMinutes).toBe(15);
    expect(s.sessionsBeforeLongBreak).toBe(2);
  });

  it("fills in missing values from the defaults", () => {
    expect(clampFocusSettings(null)).toEqual(DEFAULT_FOCUS_SETTINGS);
    expect(clampFocusSettings({}).focusMinutes).toBe(25);
  });
});

describe("focus session — elapsed time comes from timestamps, not ticks", () => {
  it("1. a started session counts down from the full focus block", () => {
    const s = started();
    expect(elapsedMs(s, T0)).toBe(0);
    expect(remainingMs(s, S, T0)).toBe(25 * MIN);
    expect(formatClock(remainingMs(s, S, T0))).toBe("25:00");
  });

  it("2. elapsed time is wall-clock, so a suspended app cannot lose it", () => {
    const s = started();
    // The WebView was frozen for 8 minutes; no interval ran at all.
    const now = T0 + 8 * MIN;
    expect(elapsedMs(s, now)).toBe(8 * MIN);
    expect(remainingMs(s, S, now)).toBe(17 * MIN);
    expect(formatClock(remainingMs(s, S, now))).toBe("17:00");
  });

  it("3. a phase finishes exactly when the clock says so", () => {
    const s = started();
    expect(isPhaseComplete(s, S, T0 + 24 * MIN)).toBe(false);
    expect(isPhaseComplete(s, S, T0 + 25 * MIN)).toBe(true);
  });

  it("4. remaining time never goes negative when overrun", () => {
    const s = started();
    expect(remainingMs(s, S, T0 + 90 * MIN)).toBe(0);
  });

  it("5. pausing banks the elapsed run and freezes the countdown", () => {
    const s = pauseSession(started(), T0 + 10 * MIN);
    expect(s.status).toBe("paused");
    // 20 more minutes pass while paused — the clock must not move.
    expect(elapsedMs(s, T0 + 30 * MIN)).toBe(10 * MIN);
    expect(remainingMs(s, S, T0 + 30 * MIN)).toBe(15 * MIN);
  });

  it("6. resuming picks up exactly where it stopped", () => {
    const paused = pauseSession(started(), T0 + 10 * MIN);
    const resumed = resumeSession(paused, T0 + 40 * MIN);
    expect(resumed.status).toBe("running");
    expect(elapsedMs(resumed, T0 + 40 * MIN)).toBe(10 * MIN);
    expect(remainingMs(resumed, S, T0 + 45 * MIN)).toBe(10 * MIN);
  });

  it("7. pausing twice, or resuming a running session, is a no-op", () => {
    const once = pauseSession(started(), T0 + 5 * MIN);
    expect(pauseSession(once, T0 + 9 * MIN)).toBe(once);
    const running = started();
    expect(resumeSession(running, T0 + 3 * MIN)).toBe(running);
  });

  it("8. progress tracks the phase", () => {
    const s = started();
    expect(phaseProgress(s, S, T0)).toBe(0);
    expect(phaseProgress(s, S, T0 + 12.5 * MIN)).toBe(50);
    expect(phaseProgress(s, S, T0 + 25 * MIN)).toBe(100);
  });
});

describe("focus minutes credited to the task", () => {
  it("9. a full focus block credits the full time", () => {
    const s = started();
    expect(focusMinutesWorked(s, S, T0 + 25 * MIN)).toBe(25);
  });

  it("10. stopping early credits the actual time, not the whole block", () => {
    const s = started();
    // Stopped after 12 minutes — must not book the full 25.
    expect(focusMinutesWorked(s, S, T0 + 12 * MIN)).toBe(12);
  });

  it("11. an abandoned tap records nothing", () => {
    const s = started();
    expect(focusMinutesWorked(s, S, T0 + 5_000)).toBe(0);
  });

  it("12. a very short but real effort still counts as a minute", () => {
    const s = started();
    expect(focusMinutesWorked(s, S, T0 + 40_000)).toBe(1);
  });

  it("13. overrunning a phase cannot credit more than the block", () => {
    const s = started();
    // Left running for an hour: the block was 25 minutes.
    expect(focusMinutesWorked(s, S, T0 + 60 * MIN)).toBe(25);
  });

  it("14. two blocks of 25 add up to 50 minutes of task time", () => {
    const first = started();
    const one = focusMinutesWorked(first, S, T0 + 25 * MIN);

    const breakPhase = advancePhase(first, S, T0 + 25 * MIN);
    expect(breakPhase.phase).toBe("short_break");

    const second = advancePhase(breakPhase, S, T0 + 30 * MIN);
    expect(second.phase).toBe("focus");
    const two = focusMinutesWorked(second, S, T0 + 55 * MIN);

    expect(one + two).toBe(50);
  });

  it("15. a paused run credits only the running part", () => {
    const paused = pauseSession(started(), T0 + 20 * MIN);
    // 40 minutes of wall clock pass, but only 20 were worked.
    expect(focusMinutesWorked(paused, S, T0 + 60 * MIN)).toBe(20);
  });
});

describe("focus cycle", () => {
  it("16. a finished focus block rolls into a short break", () => {
    const next = advancePhase(started(), S, T0 + 25 * MIN);
    expect(next.phase).toBe("short_break");
    expect(next.status).toBe("running");
    expect(remainingMs(next, S, T0 + 25 * MIN)).toBe(5 * MIN);
    expect(next.focusDoneToday).toBe(1);
  });

  it("17. a finished break rolls back into focus", () => {
    const brk = advancePhase(started(), S, T0 + 25 * MIN);
    const next = advancePhase(brk, S, T0 + 30 * MIN);
    expect(next.phase).toBe("focus");
    expect(remainingMs(next, S, T0 + 30 * MIN)).toBe(25 * MIN);
    // A break does not add to the day's block count.
    expect(next.focusDoneToday).toBe(1);
  });

  it("18. every fourth focus block earns the long break", () => {
    let s = started();
    let t = T0;
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      t += 25 * MIN;
      s = advancePhase(s, S, t); // focus → break
      seen.push(s.phase);
      t += 5 * MIN;
      s = advancePhase(s, S, t); // break → focus
    }
    expect(seen).toEqual(["short_break", "short_break", "short_break", "long_break"]);
    expect(s.focusDoneToday).toBe(4);
  });

  it("19. the cadence is configurable", () => {
    const every2: FocusSettings = { ...S, sessionsBeforeLongBreak: 2 };
    const first = advancePhase(started(), every2, T0 + 25 * MIN);
    expect(first.phase).toBe("short_break");
    const second = advancePhase(advancePhase(first, every2, T0), every2, T0);
    expect(second.phase).toBe("long_break");
  });

  it("20. phase labels read naturally", () => {
    expect(phaseLabel("focus")).toBe("Focus");
    expect(phaseLabel("short_break")).toBe("Short break");
    expect(phaseLabel("long_break")).toBe("Long break");
  });

  it("21. target lengths follow the settings", () => {
    expect(targetMs("focus", { ...S, focusMinutes: 50 })).toBe(50 * MIN);
    expect(targetMs("long_break", { ...S, longBreakMinutes: 20 })).toBe(20 * MIN);
  });
});

describe("session recovery after a restart", () => {
  it("22. a session loaded from storage keeps its progress", () => {
    const s = started();
    const reloaded = normalizeSession(s, T0 + 10 * MIN)!;
    expect(elapsedMs(reloaded, T0 + 10 * MIN)).toBe(10 * MIN);
  });

  it("23. a session left running past its end is recognisable as complete", () => {
    // The app was killed mid-block and reopened an hour later.
    const reloaded = normalizeSession(started(), T0 + 60 * MIN)!;
    expect(isPhaseComplete(reloaded, S, T0 + 60 * MIN)).toBe(true);
    expect(focusMinutesWorked(reloaded, S, T0 + 60 * MIN)).toBe(25);
  });

  it("24. a stale session keeps its own date so the day boundary is detectable", () => {
    // Re-dating it to today would hide the fact that it started yesterday, and
    // yesterday's focus time would then be banked against today.
    const reloaded = normalizeSession(started(), T0 + 26 * HOUR)!;
    expect(reloaded.date).toBe("2026-09-17");
  });

  it("25. a clock that moved backwards cannot produce negative elapsed time", () => {
    const s = started(T0 + 30 * MIN);
    const reloaded = normalizeSession(s, T0)!;
    expect(elapsedMs(reloaded, T0)).toBe(0);
  });

  it("26. corrupt records are rejected rather than half-trusted", () => {
    expect(normalizeSession(null)).toBeNull();
    expect(normalizeSession(undefined)).toBeNull();
    expect(normalizeSession({ ...started(), taskId: "" })).toBeNull();
    expect(normalizeSession({ ...started(), id: "" })).toBeNull();
  });

  it("27. a paused session stays paused across a reload", () => {
    const paused = pauseSession(started(), T0 + 7 * MIN);
    const reloaded = normalizeSession(paused, T0 + 40 * MIN)!;
    expect(reloaded.status).toBe("paused");
    expect(elapsedMs(reloaded, T0 + 90 * MIN)).toBe(7 * MIN);
  });

  it("28. a session that crossed midnight still credits the day it was worked", () => {
    // Started at 10:00, reopened the next morning: the session is stale, and the
    // minutes it earned belong to the 17th, not the 18th.
    const reopened = T0 + 26 * HOUR;
    const overnight = normalizeSession(started(), reopened)!;
    expect(overnight.date).toBe("2026-09-17");
    expect(overnight.date).not.toBe("2026-09-18");
    expect(focusMinutesWorked(overnight, S, reopened)).toBe(25);
  });

  it("29. a still-running session credits only the time actually spent", () => {
    const overnight = normalizeSession(started(), T0 + 14 * MIN)!;
    expect(focusMinutesWorked(overnight, S, T0 + 14 * MIN)).toBe(14);
  });
});

describe("formatClock", () => {
  it("counts down with a stable width", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
  });

  it("rounds a partial second up so the last second is visible", () => {
    expect(formatClock(400)).toBe("00:01");
  });
});
