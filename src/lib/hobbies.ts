import type { Hobby, HobbyAccent, Note } from "./types";

/**
 * Hobby & Notes business logic.
 *
 * Pure functions only — no React, no Dexie, no Capacitor. The store owns
 * persistence and the views own presentation, so search, filtering and
 * ordering stay testable and behave identically everywhere.
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

export interface NoteFilter {
  /** Free-text query matched against title and content (case-insensitive). */
  query?: string;
  /** `undefined` = every note, `null` = unfiled notes, string = that hobby. */
  hobbyId?: string | null;
}

/** Case-insensitive substring match across a note's title and body. */
export function noteMatchesQuery(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q)
  );
}

/**
 * Apply the active filters and return notes newest-updated first.
 *
 * Notes whose hobby was deleted are surfaced as unfiled rather than hidden, so
 * a note can never become unreachable.
 */
export function filterNotes(notes: Note[], filter: NoteFilter = {}): Note[] {
  const { query = "", hobbyId } = filter;
  const matched = notes.filter((note) => {
    if (hobbyId !== undefined) {
      const owner = note.hobbyId ?? null;
      if (owner !== hobbyId) return false;
    }
    return noteMatchesQuery(note, query);
  });
  return byRecentlyUpdated(matched);
}

/** Notes that belong to a hobby, newest first. */
export function notesForHobby(notes: Note[], hobbyId: string): Note[] {
  return byRecentlyUpdated(notes.filter((n) => n.hobbyId === hobbyId));
}

/** Notes with no hobby at all. */
export function unfiledNotes(notes: Note[]): Note[] {
  return byRecentlyUpdated(notes.filter((n) => !n.hobbyId));
}

/** How many notes each hobby holds, keyed by hobby id. */
export function noteCountsByHobby(notes: Note[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (!note.hobbyId) continue;
    counts.set(note.hobbyId, (counts.get(note.hobbyId) ?? 0) + 1);
  }
  return counts;
}

/** Hobbies sorted for display: most recently touched first. */
export function orderedHobbies(hobbies: Hobby[]): Hobby[] {
  return byRecentlyUpdated(hobbies);
}

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
