import type { GeneralNote, Hobby, HobbyAccent, HobbyNote } from "./types";

/**
 * Hobby & Notes business logic.
 *
 * Pure functions only — no React, no Dexie, no Capacitor. The store owns
 * persistence and the views own presentation, so search, filtering and
 * ordering stay testable and behave identically everywhere.
 *
 * The two note concepts are deliberately kept apart here as well as in the
 * data model:
 *
 * - **General notes** (`GeneralNote`) are a standalone scratchpad. They have no
 *   hobby, and no function in this module can ever move one into a hobby.
 * - **Hobby notes** (`HobbyNote`) always carry a `hobbyId` and are only ever
 *   reachable through that hobby.
 */

/** Curated accents. Each has light/dark variants defined in globals.css. */
export const HOBBY_ACCENTS: { value: HobbyAccent; label: string }[] = [
  { value: "teal", label: "Teal" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "pink", label: "Pink" },
  { value: "sand", label: "Sand" },
];

const ACCENTS = new Set<string>(HOBBY_ACCENTS.map((a) => a.value));

/** Safe to hand straight to a `data-hobby-accent` attribute. */
export function hobbyAccent(accent: HobbyAccent | undefined): HobbyAccent {
  return accent && ACCENTS.has(accent) ? accent : "teal";
}

/** A few friendly suggestions for a brand-new, empty workspace. */
export const HOBBY_SUGGESTIONS: { name: string; icon: string; accent: HobbyAccent }[] = [
  { name: "Reading", icon: "📚", accent: "sand" },
  { name: "Photography", icon: "📷", accent: "blue" },
  { name: "Music", icon: "🎧", accent: "purple" },
  { name: "Chess", icon: "♟️", accent: "teal" },
  { name: "Drawing", icon: "🎨", accent: "pink" },
  { name: "Fitness", icon: "🏃", accent: "green" },
];

/** Most recently updated first — the ordering every list uses. */
export function byRecentlyUpdated<T extends { updatedAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/* ------------------------------------------------------------------ */
/* General notes                                                       */
/* ------------------------------------------------------------------ */

/** Case-insensitive substring match across a note's title and body. */
export function noteMatchesQuery(
  note: { title: string; content: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q);
}

/**
 * General notes matching an optional query, newest-updated first.
 *
 * There is no hobby parameter by design: a general note has no hobby, and this
 * list is the only place general notes ever appear.
 */
export function filterGeneralNotes(notes: GeneralNote[], query = ""): GeneralNote[] {
  return byRecentlyUpdated(notes.filter((n) => noteMatchesQuery(n, query)));
}

/** Hobbies sorted for display: most recently touched first. */
export function orderedHobbies(hobbies: Hobby[]): Hobby[] {
  return byRecentlyUpdated(hobbies);
}

/* ------------------------------------------------------------------ */
/* Hobby notes                                                         */
/* ------------------------------------------------------------------ */

/** Notes belonging to one hobby, newest first. */
export function notesForHobby(notes: HobbyNote[], hobbyId: string): HobbyNote[] {
  return byRecentlyUpdated(notes.filter((n) => n.hobbyId === hobbyId));
}

/** How many notes each hobby holds, keyed by hobby id. */
export function noteCountsByHobby(notes: HobbyNote[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    counts.set(note.hobbyId, (counts.get(note.hobbyId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Notes whose hobby no longer exists.
 *
 * `removeHobby` converts its notes to general notes, so this should stay empty;
 * it exists so the view can surface — never silently drop — anything orphaned.
 */
export function orphanedHobbyNotes(notes: HobbyNote[], hobbies: Hobby[]): HobbyNote[] {
  const ids = new Set(hobbies.map((h) => h.id));
  return byRecentlyUpdated(notes.filter((n) => !ids.has(n.hobbyId)));
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

/**
 * A short, single-line preview of note content for list rows.
 * Collapses whitespace and trims to a sensible length.
 */
export function noteExcerpt(content: string, max = 140): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}

/** First line of the body, used as a fallback title. */
export function deriveNoteTitle(title: string, content: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed;
  const firstLine = content.replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" ");
  return firstLine || "Untitled note";
}

/** Relative-ish day label: Today / Yesterday / 12 Sep 2026. */
export function formatNoteDate(iso: string, today: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const key = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const todayKey = key(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dateKey = key(d);
  if (dateKey === todayKey) return "Today";
  if (dateKey === key(yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

/** True when the query should be treated as "searching". */
export function isSearching(query: string): boolean {
  return query.trim().length > 0;
}