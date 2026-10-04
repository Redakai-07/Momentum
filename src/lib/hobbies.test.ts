import { describe, expect, it } from "vitest";
import {
  byRecentlyUpdated,
  deriveNoteTitle,
  filterGeneralNotes,
  formatNoteDate,
  hobbyAccent,
  noteCountsByHobby,
  noteExcerpt,
  notesForHobby,
  orderedHobbies,
  orphanedHobbyNotes,
} from "./hobbies";
import type { GeneralNote, Hobby, HobbyAccent, HobbyNote } from "./types";

/**
 * Hobby & Notes logic.
 *
 * This space is deliberately outside the task/scheduling/performance systems,
 * so these tests check only what it is responsible for: finding, grouping and
 * ordering personal notes. The central guarantee under test is the *separation*
 * of the two note concepts — a hobby note must never surface in the general
 * feed, and a general note must never appear inside a hobby.
 */

const G = (id: string, title: string, content: string, updatedAt: string): GeneralNote => ({
  id,
  title,
  content,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt,
});

const HN = (
  id: string,
  title: string,
  content: string,
  updatedAt: string,
  hobbyId: string,
): HobbyNote => ({
  id,
  hobbyId,
  title,
  content,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt,
});

const H = (id: string, name: string, updatedAt: string): Hobby => ({
  id,
  name,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt,
});

/** The scratchpad: general notes only, ever. */
const GENERAL: GeneralNote[] = [
  G("g1", "Idea: offline wiki", "A local-first notes app with no account.", "2026-09-11T10:00:00.000Z"),
  G("g2", "Quote", "Make it work, make it right, make it fast.", "2026-09-13T10:00:00.000Z"),
  G("g3", "Shopping", "Coffee filters, oat milk.", "2026-09-10T10:00:00.000Z"),
];

/** Notes that live inside hobbies. */
const HOBBY_NOTES: HobbyNote[] = [
  HN("h1", "Light meters", "Sunny 16 rule and how to meter for backlight.", "2026-09-10T10:00:00.000Z", "h-photo"),
  HN("h2", "Opening theory", "King's Indian — look at the pawn breaks again.", "2026-09-12T10:00:00.000Z", "h-chess"),
  HN("h3", "Film stock notes", "Portra for skin tones, Ektar for saturated landscapes.", "2026-09-09T10:00:00.000Z", "h-photo"),
];

describe("filterGeneralNotes", () => {
  it("returns every general note, newest updated first, with no query", () => {
    expect(filterGeneralNotes(GENERAL).map((n) => n.id)).toEqual(["g2", "g1", "g3"]);
  });

  it("matches a query against the title, case-insensitively", () => {
    expect(filterGeneralNotes(GENERAL, "idea").map((n) => n.id)).toEqual(["g1"]);
    expect(filterGeneralNotes(GENERAL, "IDEA").map((n) => n.id)).toEqual(["g1"]);
  });

  it("matches a query against the body too", () => {
    expect(filterGeneralNotes(GENERAL, "oat milk").map((n) => n.id)).toEqual(["g3"]);
  });

  it("treats a blank query as no query at all", () => {
    expect(filterGeneralNotes(GENERAL, "   ")).toHaveLength(3);
  });

  it("returns an empty list rather than throwing when there is nothing", () => {
    expect(filterGeneralNotes([], "anything")).toEqual([]);
  });

  it("can never surface a hobby note — they are a different collection", () => {
    // The type system enforces this too, but the guarantee is worth an
    // explicit test: the general feed only ever sees general notes.
    const ids = new Set(filterGeneralNotes(GENERAL, "").map((n) => n.id));
    for (const hobbyNote of HOBBY_NOTES) {
      expect(ids.has(hobbyNote.id)).toBe(false);
    }
  });
});

describe("separation of the two note concepts", () => {
  it("a hobby's notes never include a general note", () => {
    const photoIds = notesForHobby(HOBBY_NOTES, "h-photo").map((n) => n.id);
    expect(photoIds).toEqual(["h1", "h3"]);
    for (const general of GENERAL) {
      expect(photoIds).not.toContain(general.id);
    }
  });

  it("a hobby note belongs to exactly one hobby", () => {
    const photo = notesForHobby(HOBBY_NOTES, "h-photo").map((n) => n.id);
    const chess = notesForHobby(HOBBY_NOTES, "h-chess").map((n) => n.id);
    expect(new Set([...photo, ...chess]).size).toBe(HOBBY_NOTES.length);
    expect(photo.some((id) => chess.includes(id))).toBe(false);
  });
});

describe("grouping and counting", () => {
  it("collects a hobby's notes newest first, without mutating the input", () => {
    const snapshot = HOBBY_NOTES.map((n) => n.id);
    expect(notesForHobby(HOBBY_NOTES, "h-photo").map((n) => n.id)).toEqual(["h1", "h3"]);
    expect(HOBBY_NOTES.map((n) => n.id)).toEqual(snapshot);
  });

  it("counts notes per hobby", () => {
    const counts = noteCountsByHobby(HOBBY_NOTES);
    expect(counts.get("h-photo")).toBe(2);
    expect(counts.get("h-chess")).toBe(1);
    expect(counts.get("h-unknown")).toBeUndefined();
    expect(counts.size).toBe(2);
  });

  it("reports notes whose hobby no longer exists", () => {
    const hobbies = [H("h-photo", "Photography", "2026-09-20T00:00:00.000Z")];
    expect(orphanedHobbyNotes(HOBBY_NOTES, hobbies).map((n) => n.id)).toEqual(["h2"]);
  });

  it("reports nothing orphaned when every hobby exists", () => {
    const hobbies = [
      H("h-photo", "Photography", "2026-09-20T00:00:00.000Z"),
      H("h-chess", "Chess", "2026-09-21T00:00:00.000Z"),
    ];
    expect(orphanedHobbyNotes(HOBBY_NOTES, hobbies)).toEqual([]);
  });

  it("orders hobbies by most recently updated", () => {
    const hobbies = [
      H("a", "A", "2026-09-01T00:00:00.000Z"),
      H("b", "B", "2026-09-20T00:00:00.000Z"),
    ];
    expect(orderedHobbies(hobbies).map((h) => h.id)).toEqual(["b", "a"]);
    expect(byRecentlyUpdated(hobbies).map((h) => h.id)).toEqual(["b", "a"]);
  });
});

describe("note presentation helpers", () => {
  it("collapses whitespace and trims a long excerpt", () => {
    expect(noteExcerpt("  Hello\n\n   world   again  ")).toBe("Hello world again");
    const long = "x".repeat(200);
    const excerpt = noteExcerpt(long, 20);
    expect(excerpt).toHaveLength(21); // 20 chars + ellipsis
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("leaves short content untouched", () => {
    expect(noteExcerpt("Short note")).toBe("Short note");
  });

  it("derives a usable title when the title is blank", () => {
    expect(deriveNoteTitle("  Real title ", "body")).toBe("Real title");
    expect(deriveNoteTitle("", "Some thoughts about lenses and light")).toBe(
      "Some thoughts about lenses and light",
    );
    expect(deriveNoteTitle("", "   ")).toBe("Untitled note");
  });

  it("labels recent dates relatively and older ones absolutely", () => {
    const today = new Date(2026, 8, 14, 12, 0, 0); // 2026-09-14
    expect(formatNoteDate(new Date(2026, 8, 14, 9, 0, 0).toISOString(), today)).toBe("Today");
    expect(formatNoteDate(new Date(2026, 8, 13, 9, 0, 0).toISOString(), today)).toBe("Yesterday");
    expect(formatNoteDate(new Date(2026, 8, 2, 9, 0, 0).toISOString(), today)).toBe("Sep 2, 2026");
  });

  it("returns an empty label for an invalid date instead of 'Invalid Date'", () => {
    expect(formatNoteDate("nonsense")).toBe("");
  });
});

describe("hobbyAccent", () => {
  it("keeps a valid accent", () => {
    expect(hobbyAccent("purple")).toBe("purple");
  });

  it("falls back to a safe default for missing or unknown values", () => {
    expect(hobbyAccent(undefined)).toBe("teal");
    expect(hobbyAccent("chartreuse" as HobbyAccent)).toBe("teal");
  });
});
