import { addDays, addDaysKey, todayKey } from "./date";
import type { CustomSection, DailyPerformance, Task, TimeLog } from "./types";

/* Deterministic PRNG so seeded data is stable between renders. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampPct = (v: number) => Math.max(8, Math.min(99, Math.round(v)));

/**
 * Generates ~14 months of believable daily performance history ending
 * yesterday. The most recent 7 active days all clear the 70% threshold so
 * the seeded "7 day streak" is real (today counts in live once achieved).
 */
export function generateHistory(): DailyPerformance[] {
  const rnd = mulberry32(20260904);
  const today = todayKey();
  const DAYS = 430;
  const recs: DailyPerformance[] = [];

  for (let i = -DAYS; i <= -1; i++) {
    const key = addDaysKey(today, i);
    const dow = new Date(key + "T12:00:00").getDay();
    const weekend = dow === 0 || dow === 6;

    let planned: number;
    if (weekend) {
      planned = rnd() < 0.35 ? 0 : 90 + Math.round(rnd() * 150);
    } else {
      planned = 200 + Math.round(rnd() * 240);
    }

    // Slow seasonal waves + noise → a human-looking series.
    const wave = 62 + 15 * Math.sin(i / 6.5) + 7 * Math.sin(i / 2.7 + 1);
    let pct = wave + (rnd() - 0.5) * 34;
    if (rnd() < 0.09) pct = 30 + rnd() * 25; // occasional bad day

    // Force the last 7 days to be good (seeded 7-day streak) with a
    // clearly-failed day right before so the math is honest.
    if (i >= -7) {
      pct = 78 + rnd() * 19;
      planned = Math.max(planned, 180);
    }
    if (i === -8) {
      pct = 42;
      planned = 300;
    }

    pct = clampPct(pct);
    const completed =
      planned > 0 ? Math.round(planned * (pct / 100)) : 0;

    recs.push({
      date: key,
      plannedMinutes: planned,
      completedMinutes: completed,
      percentage: planned > 0 ? pct : null,
    });
  }
  return recs;
}

/* ------------------------------------------------------------------ */
/* Task / section / log seeds                                          */
/* ------------------------------------------------------------------ */

const iso = (offsetDays: number, h = 9, m = 0) => {
  const d = addDays(new Date(), offsetDays);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

interface SeedState {
  tasks: Task[];
  logs: TimeLog[];
  sections: CustomSection[];
  history: DailyPerformance[];
}

const SEC_RESEARCH = "sec-research";
const SEC_FITNESS = "sec-fitness";

export function createSeedState(): SeedState {
  const today = todayKey();
  const yesterday = addDaysKey(today, -1);

  const sections: CustomSection[] = [
    {
      id: SEC_RESEARCH,
      name: "Research",
      icon: "🧪",
      schedule: { type: "daily", startTime: "20:00", endTime: "21:00" },
      createdAt: iso(-46),
    },
    {
      id: SEC_FITNESS,
      name: "Fitness",
      icon: "🏃",
      schedule: {
        type: "weekly",
        days: [1, 3, 5],
        startTime: "18:30",
        endTime: "19:30",
      },
      createdAt: iso(-30),
    },
  ];

  const T = (
    t: Omit<Task, "id" | "createdAt" | "remainingMinutes"> & {
      id: string;
      createdAtOffset?: number;
      remaining?: number;
    },
  ): Task => {
    const { remaining, createdAtOffset, ...rest } = t;
    return {
      createdAt: iso(createdAtOffset ?? -20, 7, 0),
      remainingMinutes:
        remaining ?? (rest.status === "active" ? rest.estimatedMinutes : 0),
      ...rest,
    };
  };

  const tasks: Task[] = [
    // --- Daily list (recurring every day) ---
    T({
      id: "t-college",
      title: "College Work",
      section: "daily",
      estimatedMinutes: 45,
      description:
        "Keep up with coursework — worksheets, assignments and upcoming exams.\n\nCurrent focus: finish the DBMS lab worksheet and revise unit 4 notes.",
      nextAction: "Finish the DBMS lab 6 worksheet",
      priority: "medium",
      schedule: { type: "daily", startTime: "09:00", endTime: "09:45" },
      status: "completed",
      completedAt: iso(0, 9, 40),
      createdAtOffset: -40,
    }),
    T({
      id: "t-dsa",
      title: "DSA Practice",
      section: "daily",
      estimatedMinutes: 90,
      description:
        "Daily problem-solving practice.\n\nTopic rotation:\n1. Arrays & Two Pointers\n2. Sliding Window\n3. Graphs\n4. Dynamic Programming",
      nextAction: "Complete the 3Sum problem using the two-pointer approach",
      priority: "high",
      schedule: { type: "daily", startTime: "18:00", endTime: "19:30" },
      status: "active",
      remaining: 60, // 30m already logged today
      createdAtOffset: -60,
    }),
    T({
      id: "t-ml",
      title: "Machine Learning",
      section: "daily",
      estimatedMinutes: 90,
      description:
        "Core ML curriculum — theory, maths and hands-on implementation.\n\nTopics:\n1. Linear Regression\n2. Logistic Regression\n3. Decision Trees\n4. Random Forest\n5. SVM",
      nextAction: "Study Linear Regression — lecture 3",
      priority: "high",
      schedule: { type: "daily", startTime: "19:30", endTime: "21:00" },
      status: "active",
      createdAtOffset: -52,
    }),

    // --- Custom section task (scheduled under Research) ---
    T({
      id: "t-research",
      title: "Research",
      section: "custom",
      customSectionId: SEC_RESEARCH,
      estimatedMinutes: 60,
      description:
        "Read and digest papers related to the ongoing research area.\n\nPipeline: skim → full read → notes in the research vault.",
      nextAction: "Find and read 2 relevant papers on the current topic",
      priority: "medium",
      schedule: { type: "daily", startTime: "20:00", endTime: "21:00" },
      status: "active",
      createdAtOffset: -35,
    }),

    // --- Remainder list ---
    T({
      id: "t-paper",
      title: "Submit Research Paper",
      section: "remainder",
      estimatedMinutes: 60,
      description:
        "Final submission for the conference deadline.\n\nChecklist:\n- [x] Camera-ready formatting\n- [ ] Abstract final pass\n- [ ] Upload to the portal\n- [ ] Confirm receipt email",
      nextAction: "Write the final abstract and upload the camera-ready PDF",
      dueDate: today,
      priority: "high",
      status: "active",
      createdAtOffset: -14,
    }),
    T({
      id: "t-portfolio",
      title: "Finish Portfolio",
      section: "remainder",
      estimatedMinutes: 60,
      description:
        "Ship the personal site before applications open.\n\n- Projects page with case studies\n- About + resume download\n- Deploy",
      nextAction: "Add the ML project case study to the projects page",
      dueDate: today,
      priority: "medium",
      status: "active",
      createdAtOffset: -9,
    }),
    T({
      id: "t-learn-ml",
      title: "Learn Machine Learning",
      section: "remainder",
      estimatedMinutes: 120,
      description:
        "The complete ML roadmap.\n\nTopics:\n1. Linear Regression\n2. Logistic Regression\n3. Decision Trees\n4. Random Forest\n5. SVM\n\nResources:\n- Course playlist\n- Notes\n- Hands-on implementation",
      nextAction: "Study Linear Regression — lecture 3",
      dueDate: addDaysKey(today, 6),
      priority: "high",
      status: "active",
      createdAtOffset: -18,
    }),
    T({
      id: "t-contact-form",
      title: "Fix portfolio contact form",
      section: "remainder",
      estimatedMinutes: 30,
      description: "The form submits but never delivers — check the service mapping.",
      dueDate: yesterday,
      priority: "low",
      status: "active",
      createdAtOffset: -5,
    }),
    T({
      id: "t-paper-read",
      title: "Read research paper: Attention Is All You Need",
      section: "remainder",
      estimatedMinutes: 45,
      description: "Annotate while reading. Note the architecture diagram by hand.",
      priority: "medium",
      status: "active",
      createdAtOffset: -3,
    }),

    // --- Occasional (bucket list) ---
    T({
      id: "t-interstellar",
      title: "Watch Interstellar",
      section: "occasional",
      estimatedMinutes: 180,
      description: "Rewatch on a big screen. Hans Zimmer score, full volume. 🌌",
      status: "active",
      createdAtOffset: -25,
    }),
    T({
      id: "t-book",
      title: "Read a book",
      section: "occasional",
      estimatedMinutes: 0,
      description:
        "Pick from the shelf:\n- The Psychology of Money\n- Deep Work\n- Atomic Habits",
      status: "active",
      createdAtOffset: -24,
    }),
    T({
      id: "t-hampi",
      title: "Visit Hampi",
      section: "occasional",
      estimatedMinutes: 0,
      description: "Ruins at sunrise. Take the camera. Weekend trip plan needed.",
      status: "active",
      createdAtOffset: -22,
    }),
    T({
      id: "t-photography",
      title: "Learn photography basics",
      section: "occasional",
      estimatedMinutes: 0,
      description: "Aperture, shutter speed, ISO — then a photo walk.",
      status: "active",
      createdAtOffset: -21,
    }),

    // --- Accomplishments (permanently finished goals, kept as history) ---
    T({
      id: "t-accomp-mtech",
      title: "M.Tech Software Engineering",
      section: "remainder",
      estimatedMinutes: 120,
      description:
        "Post-graduation in Software Engineering — coursework, the minor thesis and the final viva.\n\nDone is better than perfect, and this one is done.",
      status: "accomplished",
      accomplishedAt: iso(-55),
      createdAtOffset: -430,
    }),
    T({
      id: "t-accomp-portfolio",
      title: "Full Stack Portfolio",
      section: "daily",
      estimatedMinutes: 60,
      description:
        "Personal site with case studies, resume and a working contact form — shipped and live.",
      status: "accomplished",
      accomplishedAt: iso(-10),
      createdAtOffset: -140,
    }),
  ];

  // Remaining minutes for completed / partial bookkeeping:
  const logs: TimeLog[] = [
    { id: "l-1", taskId: "t-college", minutes: 45, date: today }, // done
    { id: "l-2", taskId: "t-dsa", minutes: 30, date: today }, // partial
    { id: "l-3", taskId: "t-dsa", minutes: 90, date: yesterday },
    { id: "l-4", taskId: "t-ml", minutes: 60, date: yesterday },
    { id: "l-5", taskId: "t-research", minutes: 60, date: addDaysKey(today, -2) },
    { id: "l-6", taskId: "t-dsa", minutes: 60, date: addDaysKey(today, -2) },
    { id: "l-7", taskId: "t-ml", minutes: 90, date: addDaysKey(today, -3) },
    { id: "l-8", taskId: "t-college", minutes: 45, date: addDaysKey(today, -4) },
    { id: "l-9", taskId: "t-dsa", minutes: 75, date: addDaysKey(today, -4) },
    { id: "l-10", taskId: "t-research", minutes: 60, date: addDaysKey(today, -5) },
    { id: "l-11", taskId: "t-ml", minutes: 45, date: addDaysKey(today, -6) },
    // History for accomplished goals (kept even though the task is retired).
    { id: "l-12", taskId: "t-accomp-mtech", minutes: 120, date: addDaysKey(today, -320) },
    { id: "l-13", taskId: "t-accomp-mtech", minutes: 120, date: addDaysKey(today, -280) },
    { id: "l-14", taskId: "t-accomp-mtech", minutes: 90, date: addDaysKey(today, -210) },
    { id: "l-15", taskId: "t-accomp-mtech", minutes: 150, date: addDaysKey(today, -150) },
    { id: "l-16", taskId: "t-accomp-mtech", minutes: 120, date: addDaysKey(today, -90) },
    { id: "l-17", taskId: "t-accomp-portfolio", minutes: 60, date: addDaysKey(today, -18) },
    { id: "l-18", taskId: "t-accomp-portfolio", minutes: 90, date: addDaysKey(today, -15) },
    { id: "l-19", taskId: "t-accomp-portfolio", minutes: 60, date: addDaysKey(today, -12) },
  ];

  return { tasks, logs, sections, history: generateHistory() };
}
