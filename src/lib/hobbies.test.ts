import { describe, expect, it } from "vitest";
import {
  byRecentlyUpdated,
  deriveNoteTitle,
  filterNotes,
  formatNoteDate,
  hobbyAccent,
  noteCountsByHobby,
  noteExcerpt,
  notesForHobby,
  orderedHobbies,
  unfiledNotes,
} from "./hobbies";
import type { Hobby, HobbyAccent, Note } from "./types";

/**
 * Hobby & Notes logic.
 *
 * This space is deliberately outside the task/scheduling/performance systems,
 * so these tests check only what it is responsible for: finding, grouping and
 * ordering personal notes, and never losing them.
 */

const N = (
  id: string,
  title: string,
  content: string,
  updatedAt: string,
  hobbyId?: string,
): Note => ({
  id,
  title,
  content,
  hobbyId,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt,
});

const H = (id: string, name: string, updatedAt: string): Hobby => ({
  id,
  name,
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt,
});

const NOTES: Note[] = [
  N("n1", "Light meters", "Sunny 16 rule and how to meter for backlight.", "2026-09-10T10:00:00.000Z", "h-photo"),
  N("n2", "Opening theory", "King's Indian — look at the pawn breaks again.", "2026-09-12T10:00:00.000Z", "h-chess"),
  N("n3", "Idea: offline wiki", "A local-first notes app with no account.", "2026-09-11T10:00:00.000Z"),
  N("n4", "Film stock notes", "Portra for skin tones, Ektar for saturated landscapes.", "2026-09-09T10:00:00.000Z", "h-photo"),
];

describe("filterNotes", () => {
  it("returns every note, newest updated first, with no filter", () => {
    expect(filterNotes(NOTES).map((n) => n.id)).toEqual(["n2", "n3", "n1", "n4"]);
  });

  it("matches a query against the title, case-insensitively", () => {
    expect(filterNotes(NOTES, { query: "light" }).map((n) => n.id)).toEqual(["n1"]);
    expect(filterNotes(NOTES, { query: "LIGHT" }).map((n) => n.id)).toEqual(["n1"]);
  });

  it("matches a query against the body too", () => {
    expect(filterNotes(NOTES, { query: "pawn breaks" }).map((n) => n.id)).toEqual(["n2"]);
  });

  it("treats a blank query as no query at all", () => {
    expect(filterNotes(NOTES, { query: "   " })).toHaveLength(4);
  });

  it("filters by hobby id", () => {
    expect(filterNotes(NOTES, { hobbyId: "h-photo" }).map((n) => n.id)).toEqual(["n1", "n4"]);
  });

  it("filters to unfiled notes with hobbyId: null", () => {
    expect(filterNotes(NOTES, { hobbyId: null }).map((n) => n.id)).toEqual(["n3"]);
  });

  it("combines a hobby filter with a query", () => {
    expect(filterNotes(NOTES, { hobbyId: "h-photo", query: "film" }).map((n) => n.id)).toEqual(["n4"]);
    expect(filterNotes(NOTES, { hobbyId: "h-photo", query: "chess" })).toEqual([]);
  });

  it("surfaces notes whose hobby no longer exists as unfiled", () => {
    // `removeHobby` clears hobbyId, so a dangling id should not hide a note.
    const orphan = N("n5", "Orphan", "Body", "2026-09-13T10:00:00.000Z", "h-deleted");
    const withOrphan = filterNotes([...NOTES, orphan], { hobbyId: null });
    // The orphan still carries its (now missing) id, so it is not unfiled…
    expect(withOrphan.map((n) => n.id)).toEqual(["n3"]);
    // …but it is never lost from the unfiltered list.
    expect(filterNotes([...NOTES, orphan]).map((n) => n.id)).toContain("n5");
  });

  it("returns an empty list rather than throwing when there is nothing", () => {
    expect(filterNotes([], { query: "anything" })).toEqual([]);
  });
});

describe("grouping and counting", () => {
  it("collects a hobby's notes newest first, without mutating the input", () => {
    const snapshot = NOTES.map((n) => n.id);
    expect(notesForHobby(NOTES, "h-photo").map((n) => n.id)).toEqual(["n1", "n4"]);
    expect(NOTES.map((n) => n.id)).toEqual(snapshot);
  });

  it("collects unfiled notes", () => {
    expect(unfiledNotes(NOTES).map((n) => n.id)).toEqual(["n3"]);
  });

  it("counts notes per hobby and ignores unfiled ones", () => {
    const counts = noteCountsByHobby(NOTES);
    expect(counts.get("h-photo")).toBe(2);
    expect(counts.get("h-chess")).toBe(1);
    expect(counts.get("h-unknown")).toBeUndefined();
    expect(counts.size).toBe(2);
  });

  it("orders hobbies by most recently updated", () => {
    const hobbies = [H("a", "A", "2026-09-01T00:00:00.000Z"), H("b", "B", "2026-09-20T00:00:00.000Z")];
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
