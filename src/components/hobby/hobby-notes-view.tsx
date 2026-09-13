"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Layers,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { PageFrame } from "@/components/layout/page-frame";
import { useStore } from "@/lib/store";
import {
  HOBBY_SUGGESTIONS,
  deriveNoteTitle,
  filterNotes,
  hobbyAccent,
  isSearching,
  noteCountsByHobby,
  noteExcerpt,
  notesForHobby,
  orderedHobbies,
  unfiledNotes,
  formatNoteDate,
} from "@/lib/hobbies";
import type { Hobby, Note } from "@/lib/types";
import { ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/ui/confirm";
import { HobbyEditor, type HobbyDraft } from "@/components/hobby/hobby-editor";
import { NoteEditor, type NoteDraft } from "@/components/hobby/note-editor";
import { cn } from "@/lib/utils";

type Tab = "notes" | "hobbies";

/* ------------------------------------------------------------------ */
/* Presentation bits                                                   */
/* ------------------------------------------------------------------ */

function HobbyAccentDot({ hobby, className }: { hobby?: Hobby | null; className?: string }) {
  return (
    <span
      data-hobby-accent={hobbyAccent(hobby?.accent)}
      className={cn("h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: "hsl(var(--hobby))" }}
    />
  );
}

function HobbyCard({
  hobby,
  count,
  onOpen,
}: {
  hobby: Hobby;
  count: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-hobby-accent={hobbyAccent(hobby.accent)}
      className="lift group relative flex w-full min-w-0 flex-col items-start gap-2 overflow-hidden rounded-2xl border border-border p-4 text-left"
      style={{
        background:
          "linear-gradient(160deg, hsl(var(--hobby-soft)) 0%, hsl(var(--card)) 78%)",
      }}
    >
      <span
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-40 blur-2xl"
        style={{ backgroundColor: "hsl(var(--hobby) / 0.5)" }}
        aria-hidden
      />
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-border/70 bg-card/80 text-[19px] leading-none shadow-soft">
        {hobby.icon ? hobby.icon : <BookOpen className="h-4.5 w-4.5 text-muted-foreground" />}
      </span>
      <span className="min-w-0 w-full">
        <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">
          {hobby.name}
        </span>
        {hobby.description ? (
          <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted-foreground">
            {hobby.description}
          </span>
        ) : (
          <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground/80">
            {count === 0 ? "No notes yet" : `${count} note${count === 1 ? "" : "s"}`}
          </span>
        )}
      </span>
      {count > 0 && hobby.description && (
        <span className="font-mono text-[11px] tnum text-muted-foreground/80">
          {count} note{count === 1 ? "" : "s"}
        </span>
      )}
    </button>
  );
}

function NoteRow({
  note,
  hobby,
  onOpen,
}: {
  note: Note;
  hobby?: Hobby;
  onOpen: () => void;
}) {
  const title = deriveNoteTitle(note.title, note.content);
  const excerpt = noteExcerpt(note.content);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none"
    >
      <span
        data-hobby-accent={hobbyAccent(hobby?.accent)}
        className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border/70 text-[13px] leading-none"
        style={{ backgroundColor: "hsl(var(--hobby-soft))" }}
      >
        {hobby?.icon ? hobby.icon : <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{title}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/80">
            {formatNoteDate(note.updatedAt)}
          </span>
        </span>
        {excerpt && (
          <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted-foreground">
            {excerpt}
          </span>
        )}
        {hobby && (
          <span
            className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium"
            style={{
              backgroundColor: "hsl(var(--hobby-soft))",
              color: "hsl(var(--hobby-ink))",
            }}
          >
            <HobbyAccentDot hobby={hobby} className="h-1.5 w-1.5" />
            {hobby.name}
          </span>
        )}
      </span>
    </button>
  );
}

function EmptyNotes({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="surface anim-fade-in flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <NotebookPen className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Capture an idea before it disappears
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          Notes are a private scratchpad. Nothing here becomes a task, and nothing leaves
          your device.
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onCreate} className="mt-1">
        <Plus className="h-4 w-4" strokeWidth={2.2} /> Create note
      </Button>
    </div>
  );
}

function EmptyHobbies({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="surface anim-fade-in flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <Sparkles className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Keep the things you enjoy in one place
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          Hobbies are just interests — no schedules, no streaks, no pressure. Give one a
          name and start filing notes under it.
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onCreate} className="mt-1">
        <Plus className="h-4 w-4" strokeWidth={2.2} /> Add hobby
      </Button>
      <div className="mt-1 flex flex-wrap justify-center gap-1.5">
        {HOBBY_SUGGESTIONS.map((s) => (
          <span
            key={s.name}
            data-hobby-accent={s.accent}
            className="rounded-full border border-border px-2.5 py-1 text-[11.5px] text-muted-foreground"
          >
            {s.icon} {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The view                                                            */
/* ------------------------------------------------------------------ */

export function HobbyNotesView() {
  const ready = useStore((s) => s.ready);
  const hobbies = useStore((s) => s.hobbies);
  const notes = useStore((s) => s.notes);
  const addHobby = useStore((s) => s.addHobby);
  const updateHobby = useStore((s) => s.updateHobby);
  const removeHobby = useStore((s) => s.removeHobby);
  const addNote = useStore((s) => s.addNote);
  const updateNote = useStore((s) => s.updateNote);
  const removeNote = useStore((s) => s.removeNote);

  const [tab, setTab] = useState<Tab>("notes");
  const [query, setQuery] = useState("");
  const [hobbyFilter, setHobbyFilter] = useState<string | null | undefined>(undefined);

  const [editingHobby, setEditingHobby] = useState<Hobby | null>(null);
  const [hobbyEditorOpen, setHobbyEditorOpen] = useState(false);
  const [openHobbyId, setOpenHobbyId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [noteDraftHobby, setNoteDraftHobby] = useState<string | undefined>(undefined);
  const [confirmHobby, setConfirmHobby] = useState<Hobby | null>(null);

  const sortedHobbies = useMemo(() => orderedHobbies(hobbies), [hobbies]);
  const counts = useMemo(() => noteCountsByHobby(notes), [notes]);
  const hobbyById = useMemo(() => new Map(hobbies.map((h) => [h.id, h])), [hobbies]);
  const unfiled = useMemo(() => unfiledNotes(notes), [notes]);

  const visibleNotes = useMemo(
    () => filterNotes(notes, { query, hobbyId: hobbyFilter }),
    [notes, query, hobbyFilter],
  );

  const openHobby = openHobbyId ? hobbyById.get(openHobbyId) ?? null : null;
  const openHobbyNotes = openHobby ? notesForHobby(notes, openHobby.id) : [];

  /* ------------------------------ actions ------------------------------ */

  const startNewHobby = () => {
    setEditingHobby(null);
    setHobbyEditorOpen(true);
  };

  const startEditHobby = (hobby: Hobby) => {
    setEditingHobby(hobby);
    setHobbyEditorOpen(true);
  };

  const submitHobby = (draft: HobbyDraft) => {
    if (editingHobby) {
      updateHobby(editingHobby.id, {
        name: draft.name,
        description: draft.description,
        icon: draft.icon,
        accent: draft.accent,
      });
    } else {
      const id = addHobby(draft);
      setOpenHobbyId(id);
    }
    setHobbyEditorOpen(false);
    setEditingHobby(null);
  };

  const deleteHobby = (hobby: Hobby) => {
    removeHobby(hobby.id);
    if (openHobbyId === hobby.id) setOpenHobbyId(null);
    setHobbyEditorOpen(false);
    setEditingHobby(null);
  };

  const startNewNote = (hobbyId?: string) => {
    setEditingNote(null);
    setNoteDraftHobby(hobbyId);
    setNoteEditorOpen(true);
  };

  const startEditNote = (note: Note) => {
    setEditingNote(note);
    setNoteDraftHobby(undefined);
    setNoteEditorOpen(true);
  };

  const submitNote = (draft: NoteDraft) => {
    if (editingNote) {
      updateNote(editingNote.id, {
        title: draft.title,
        content: draft.content,
        hobbyId: draft.hobbyId,
      });
    } else {
      addNote(draft);
    }
    setNoteEditorOpen(false);
    setEditingNote(null);
  };

  const activeFilterLabel =
    hobbyFilter === null
      ? "Unfiled"
      : hobbyFilter
        ? hobbyById.get(hobbyFilter)?.name ?? "Hobby"
        : "All notes";

  return (
    <PageFrame wide>
      {/* Header */}
      <div className="anim-fade-up mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="mb-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Hobby &amp; Notes
          </p>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-foreground sm:text-[28px]">
            Your quiet corner
          </h1>
          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted-foreground">
            Interests and ideas that aren&apos;t productivity tasks. Kept separate from your
            daily plan, entirely on this device.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Tab>
            options={[
              { value: "notes", label: "Notes" },
              { value: "hobbies", label: "Hobbies" },
            ]}
            value={tab}
            onChange={setTab}
          />
          <Button
            variant="primary"
            size="md"
            onClick={() => (tab === "notes" ? startNewNote(hobbyFilter ?? undefined) : startNewHobby())}
            className="rounded-full"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            {tab === "notes" ? "New note" : "New hobby"}
          </Button>
        </div>
      </div>

      {!ready ? (
        <ListSkeleton rows={5} />
      ) : tab === "notes" ? (
        /* ------------------------------- Notes ------------------------------ */
        <div className="space-y-4">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={2}
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search notes…"
                aria-label="Search notes"
                className="h-10 pl-9 pr-9"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                </button>
              )}
            </div>

            {(hobbies.length > 0 || unfiled.length > 0) && (
              <div className="-mx-1 flex flex-wrap items-center gap-1.5 px-1">
                <FilterChip
                  active={hobbyFilter === undefined}
                  onClick={() => setHobbyFilter(undefined)}
                  label={`All (${notes.length})`}
                />
                {sortedHobbies.map((h) => (
                  <FilterChip
                    key={h.id}
                    active={hobbyFilter === h.id}
                    onClick={() => setHobbyFilter(h.id)}
                    label={`${h.icon ? `${h.icon} ` : ""}${h.name} (${counts.get(h.id) ?? 0})`}
                    hobby={h}
                  />
                ))}
                {unfiled.length > 0 && (
                  <FilterChip
                    active={hobbyFilter === null}
                    onClick={() => setHobbyFilter(null)}
                    label={`Unfiled (${unfiled.length})`}
                  />
                )}
              </div>
            )}
          </div>

          {notes.length === 0 ? (
            <EmptyNotes onCreate={() => startNewNote()} />
          ) : visibleNotes.length === 0 ? (
            <div className="surface rounded-2xl px-6 py-12 text-center">
              <p className="text-[14px] font-medium text-foreground">
                No notes match {isSearching(query) ? `“${query}”` : "this filter"}
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Try a different search, or clear the filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setQuery("");
                  setHobbyFilter(undefined);
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 px-0.5">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                  {activeFilterLabel}
                </p>
                <p className="font-mono text-[10.5px] tnum text-muted-foreground/80">
                  {visibleNotes.length} note{visibleNotes.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="surface stagger divide-y divide-border/60 overflow-hidden rounded-2xl">
                {visibleNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    note={note}
                    hobby={note.hobbyId ? hobbyById.get(note.hobbyId) : undefined}
                    onOpen={() => startEditNote(note)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        /* ------------------------------ Hobbies ----------------------------- */
        <div className="space-y-4">
          {hobbies.length === 0 ? (
            <EmptyHobbies onCreate={startNewHobby} />
          ) : (
            <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sortedHobbies.map((h) => (
                <HobbyCard
                  key={h.id}
                  hobby={h}
                  count={counts.get(h.id) ?? 0}
                  onOpen={() => setOpenHobbyId(h.id)}
                />
              ))}
            </div>
          )}

          {notes.length > 0 && unfiled.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setTab("notes");
                setHobbyFilter(null);
              }}
              className="surface lift flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
                <Layers className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium text-foreground">
                  Unfiled notes
                </span>
                <span className="block text-[12.5px] text-muted-foreground">
                  {unfiled.length} note{unfiled.length === 1 ? "" : "s"} not yet under a hobby
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      {/* ------------------------------ Hobby sheet ----------------------------- */}
      <Modal
        open={!!openHobby}
        onClose={() => setOpenHobbyId(null)}
        eyebrow="Hobby"
        title={openHobby ? `${openHobby.icon ? `${openHobby.icon} ` : ""}${openHobby.name}` : ""}
      >
        {openHobby && (
          <div className="space-y-4">
            {openHobby.description ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {openHobby.description}
              </p>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground/80">
                No description yet.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="soft" size="sm" onClick={() => startEditHobby(openHobby)}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => startNewNote(openHobby.id)}>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} /> Add note
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="ml-auto"
                onClick={() => setConfirmHobby(openHobby)}
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} /> Delete hobby
              </Button>
            </div>

            <div className="border-t border-border/60 pt-3">
              <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                Notes · {openHobbyNotes.length}
              </p>
              {openHobbyNotes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
                  Nothing filed here yet. Add a note to start collecting thoughts.
                </p>
              ) : (
                <ListShellLike>
                  {openHobbyNotes.map((note) => (
                    <NoteRow
                      key={note.id}
                      note={note}
                      hobby={openHobby}
                      onOpen={() => startEditNote(note)}
                    />
                  ))}
                </ListShellLike>
              )}
            </div>

            <button
              type="button"
              onClick={() => setOpenHobbyId(null)}
              className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} /> Back to all hobbies
            </button>
          </div>
        )}
      </Modal>

      {/* ------------------------------- Editors ------------------------------- */}
      <HobbyEditor
        open={hobbyEditorOpen}
        hobby={editingHobby}
        onClose={() => {
          setHobbyEditorOpen(false);
          setEditingHobby(null);
        }}
        onSubmit={submitHobby}
        onDelete={
          editingHobby
            ? () => setConfirmHobby(editingHobby)
            : undefined
        }
      />

      <NoteEditor
        open={noteEditorOpen}
        note={editingNote}
        hobbies={sortedHobbies}
        defaultHobbyId={noteDraftHobby}
        onClose={() => {
          setNoteEditorOpen(false);
          setEditingNote(null);
        }}
        onSubmit={submitNote}
        onDelete={
          editingNote
            ? () => {
                removeNote(editingNote.id);
                setNoteEditorOpen(false);
                setEditingNote(null);
              }
            : undefined
        }
      />

      <ConfirmDialog
        open={!!confirmHobby}
        title={confirmHobby ? `Delete “${confirmHobby.name}”?` : ""}
        body="Its notes are kept and simply become unfiled — nothing you wrote is deleted."
        confirmLabel="Delete hobby"
        onConfirm={() => {
          if (confirmHobby) deleteHobby(confirmHobby);
        }}
        onClose={() => setConfirmHobby(null)}
      />
    </PageFrame>
  );
}

/* Small local helpers ------------------------------------------------ */

function FilterChip({
  active,
  onClick,
  label,
  hobby,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hobby?: Hobby;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-hobby-accent={hobby ? hobbyAccent(hobby.accent) : undefined}
      className={cn(
        "press inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border bg-card/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {hobby && <HobbyAccentDot hobby={hobby} className="h-1.5 w-1.5" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Rounded, divided container used inside modals. */
function ListShellLike({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/70">
      {children}
    </div>
  );
}
