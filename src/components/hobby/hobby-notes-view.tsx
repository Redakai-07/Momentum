"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
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
  filterGeneralNotes,
  hobbyAccent,
  isSearching,
  noteCountsByHobby,
  noteExcerpt,
  notesForHobby,
  orderedHobbies,
  formatNoteDate,
} from "@/lib/hobbies";
import type { GeneralNote, Hobby, HobbyNote } from "@/lib/types";
import { ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmDialog } from "@/components/ui/confirm";
import { HobbyEditor, type HobbyDraft } from "@/components/hobby/hobby-editor";
import {
  GeneralNoteEditor,
  HobbyNoteEditor,
  type NoteDraft,
} from "@/components/hobby/note-editor";
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
      className="lift flex w-full min-w-0 flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left"
    >
      <span className="flex w-full items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/70 bg-muted/40 text-[17px] leading-none">
          {hobby.icon ? hobby.icon : <BookOpen className="h-4 w-4 text-muted-foreground" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold tracking-tight text-foreground">
            {hobby.name}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/80">
            <HobbyAccentDot hobby={hobby} className="h-1.5 w-1.5" />
            {count === 0 ? "No notes yet" : `${count} note${count === 1 ? "" : "s"}`}
          </span>
        </span>
      </span>
      {hobby.description && (
        <span className="line-clamp-2 block text-[12.5px] leading-relaxed text-muted-foreground">
          {hobby.description}
        </span>
      )}
    </button>
  );
}

function NoteRow({
  title,
  excerpt,
  date,
  icon,
  accent,
  onOpen,
}: {
  title: string;
  excerpt: string;
  date: string;
  icon: React.ReactNode;
  accent?: Hobby | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none"
    >
      <span
        data-hobby-accent={accent ? hobbyAccent(accent.accent) : undefined}
        className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border/70 text-[13px] leading-none"
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{title}</span>
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/80">{date}</span>
        </span>
        {excerpt && (
          <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted-foreground">
            {excerpt}
          </span>
        )}
      </span>
    </button>
  );
}

function EmptyGeneralNotes({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="surface anim-fade-in flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <NotebookPen className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <div>
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Capture an idea before it disappears
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          A private scratchpad for anything that isn&apos;t a task. Nothing here belongs to a
          hobby, and nothing leaves your device.
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onCreate} className="mt-1">
        <Plus className="h-4 w-4" strokeWidth={1.75} /> Create note
      </Button>
    </div>
  );
}

function EmptyHobbies({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="surface anim-fade-in flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-border bg-muted/40 text-muted-foreground">
        <Sparkles className="h-6 w-6" strokeWidth={1.75} />
      </span>
      <div>
        <p className="text-[15px] font-semibold tracking-tight text-foreground">
          Keep the things you enjoy in one place
        </p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          Hobbies are just interests — no schedules, no streaks, no pressure. Give one a name
          and start filing notes under it.
        </p>
      </div>
      <Button variant="primary" size="md" onClick={onCreate} className="mt-1">
        <Plus className="h-4 w-4" strokeWidth={1.75} /> Add hobby
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
  const generalNotes = useStore((s) => s.generalNotes);
  const hobbyNotes = useStore((s) => s.hobbyNotes);
  const addHobby = useStore((s) => s.addHobby);
  const updateHobby = useStore((s) => s.updateHobby);
  const removeHobby = useStore((s) => s.removeHobby);
  const addGeneralNote = useStore((s) => s.addGeneralNote);
  const updateGeneralNote = useStore((s) => s.updateGeneralNote);
  const removeGeneralNote = useStore((s) => s.removeGeneralNote);
  const addHobbyNote = useStore((s) => s.addHobbyNote);
  const updateHobbyNote = useStore((s) => s.updateHobbyNote);
  const removeHobbyNote = useStore((s) => s.removeHobbyNote);

  const [tab, setTab] = useState<Tab>("notes");
  const [query, setQuery] = useState("");

  const [editingHobby, setEditingHobby] = useState<Hobby | null>(null);
  const [hobbyEditorOpen, setHobbyEditorOpen] = useState(false);
  const [openHobbyId, setOpenHobbyId] = useState<string | null>(null);
  const [confirmHobby, setConfirmHobby] = useState<Hobby | null>(null);

  const [editingGeneral, setEditingGeneral] = useState<GeneralNote | null>(null);
  const [generalEditorOpen, setGeneralEditorOpen] = useState(false);

  const [editingHobbyNote, setEditingHobbyNote] = useState<HobbyNote | null>(null);
  const [hobbyNoteEditorOpen, setHobbyNoteEditorOpen] = useState(false);

  const sortedHobbies = useMemo(() => orderedHobbies(hobbies), [hobbies]);
  const counts = useMemo(() => noteCountsByHobby(hobbyNotes), [hobbyNotes]);
  const hobbyById = useMemo(() => new Map(hobbies.map((h) => [h.id, h])), [hobbies]);

  // The general feed shows general notes only — never a hobby note.
  const visibleGeneralNotes = useMemo(
    () => filterGeneralNotes(generalNotes, query),
    [generalNotes, query],
  );

  const openHobby = openHobbyId ? hobbyById.get(openHobbyId) ?? null : null;
  const openHobbyNotes = openHobby ? notesForHobby(hobbyNotes, openHobby.id) : [];

  /* ------------------------------ Hobbies ------------------------------ */

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
      setOpenHobbyId(addHobby(draft));
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

  /* ---------------------------- General notes -------------------------- */

  const startNewGeneralNote = () => {
    setEditingGeneral(null);
    setGeneralEditorOpen(true);
  };

  const startEditGeneralNote = (note: GeneralNote) => {
    setEditingGeneral(note);
    setGeneralEditorOpen(true);
  };

  const submitGeneralNote = (draft: NoteDraft) => {
    if (editingGeneral) {
      updateGeneralNote(editingGeneral.id, { title: draft.title, content: draft.content });
    } else {
      addGeneralNote({ title: draft.title, content: draft.content });
    }
    setGeneralEditorOpen(false);
    setEditingGeneral(null);
  };

  /* ----------------------------- Hobby notes --------------------------- */

  const startNewHobbyNote = () => {
    setEditingHobbyNote(null);
    setHobbyNoteEditorOpen(true);
  };

  const startEditHobbyNote = (note: HobbyNote) => {
    setEditingHobbyNote(note);
    setHobbyNoteEditorOpen(true);
  };

  const submitHobbyNote = (draft: NoteDraft) => {
    if (!openHobby) return;
    if (editingHobbyNote) {
      updateHobbyNote(editingHobbyNote.id, { title: draft.title, content: draft.content });
    } else {
      addHobbyNote({ hobbyId: openHobby.id, title: draft.title, content: draft.content });
    }
    setHobbyNoteEditorOpen(false);
    setEditingHobbyNote(null);
  };

  const deleteHobbyNote = (note: HobbyNote) => {
    removeHobbyNote(note.id);
    setHobbyNoteEditorOpen(false);
    setEditingHobbyNote(null);
  };

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
            Notes for yourself, and notes that live inside your hobbies. Kept separate from your
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
            onClick={() => (tab === "notes" ? startNewGeneralNote() : startNewHobby())}
            className="rounded-full"
          >
            <Plus className="h-4 w-4" strokeWidth={1.75} />
            {tab === "notes" ? "New note" : "New hobby"}
          </Button>
        </div>
      </div>

      {!ready ? (
        <ListSkeleton rows={5} />
      ) : tab === "notes" ? (
        /* ------------------------------- Notes ------------------------------ */
        <div className="space-y-4">
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
                <X className="h-3.5 w-3.5" strokeWidth={1.75} />
              </button>
            )}
          </div>

          {generalNotes.length === 0 ? (
            <EmptyGeneralNotes onCreate={startNewGeneralNote} />
          ) : visibleGeneralNotes.length === 0 ? (
            <div className="surface rounded-2xl px-6 py-12 text-center">
              <p className="text-[14px] font-medium text-foreground">
                No notes match {isSearching(query) ? `“${query}”` : "this search"}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-3 px-0.5">
                <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                  General notes
                </p>
                <p className="font-mono text-[10.5px] tnum text-muted-foreground/80">
                  {visibleGeneralNotes.length} note{visibleGeneralNotes.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="surface stagger divide-y divide-border/60 overflow-hidden rounded-2xl">
                {visibleGeneralNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    title={deriveNoteTitle(note.title, note.content)}
                    excerpt={noteExcerpt(note.content)}
                    date={formatNoteDate(note.updatedAt)}
                    icon={<NotebookPen className="h-3.5 w-3.5 text-muted-foreground" />}
                    onOpen={() => startEditGeneralNote(note)}
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
              <Button variant="outline" size="sm" onClick={startNewHobbyNote}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} /> Add note
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
                <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card/70">
                  {openHobbyNotes.map((note) => (
                    <NoteRow
                      key={note.id}
                      title={deriveNoteTitle(note.title, note.content)}
                      excerpt={noteExcerpt(note.content)}
                      date={formatNoteDate(note.updatedAt)}
                      accent={openHobby}
                      icon={
                        openHobby.icon ? (
                          openHobby.icon
                        ) : (
                          <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" />
                        )
                      }
                      onOpen={() => startEditHobbyNote(note)}
                    />
                  ))}
                </div>
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
        onDelete={editingHobby ? () => setConfirmHobby(editingHobby) : undefined}
      />

      <GeneralNoteEditor
        open={generalEditorOpen}
        note={editingGeneral}
        onClose={() => {
          setGeneralEditorOpen(false);
          setEditingGeneral(null);
        }}
        onSubmit={submitGeneralNote}
        onDelete={
          editingGeneral
            ? () => {
                removeGeneralNote(editingGeneral.id);
                setGeneralEditorOpen(false);
                setEditingGeneral(null);
              }
            : undefined
        }
      />

      {openHobby && (
        <HobbyNoteEditor
          open={hobbyNoteEditorOpen}
          hobby={openHobby}
          note={editingHobbyNote}
          onClose={() => {
            setHobbyNoteEditorOpen(false);
            setEditingHobbyNote(null);
          }}
          onSubmit={submitHobbyNote}
          onDelete={editingHobbyNote ? () => deleteHobbyNote(editingHobbyNote) : undefined}
        />
      )}

      <ConfirmDialog
        open={!!confirmHobby}
        title={confirmHobby ? `Delete “${confirmHobby.name}”?` : ""}
        body="Its notes are kept — they move to your general notes, so nothing you wrote is deleted."
        confirmLabel="Delete hobby"
        onConfirm={() => {
          if (confirmHobby) deleteHobby(confirmHobby);
        }}
        onClose={() => setConfirmHobby(null)}
      />
    </PageFrame>
  );
}
