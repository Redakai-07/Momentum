"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { hobbyAccent } from "@/lib/hobbies";
import type { GeneralNote, Hobby, HobbyNote } from "@/lib/types";

/** Shared shape: a note is only ever a title and some body text. */
export interface NoteDraft {
  title: string;
  content: string;
}

/* ------------------------------------------------------------------ */
/* General notes — a standalone scratchpad, no hobby anywhere          */
/* ------------------------------------------------------------------ */

export function GeneralNoteEditor({
  open,
  note,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  note?: GeneralNote | null;
  onClose: () => void;
  onSubmit: (draft: NoteDraft) => void;
  onDelete?: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={note ? "Edit note" : "New note"}
      title={note ? "Edit note" : "Capture an idea"}
      className="sm:max-w-xl"
    >
      <NoteForm
        key={open ? (note?.id ?? "new") : "closed"}
        note={note ?? undefined}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Hobby notes — always filed under the hobby they were opened from    */
/* ------------------------------------------------------------------ */

export function HobbyNoteEditor({
  open,
  hobby,
  note,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  hobby: Hobby;
  note?: HobbyNote | null;
  onClose: () => void;
  onSubmit: (draft: NoteDraft) => void;
  onDelete?: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={note ? "Edit note" : `${hobby.icon ? `${hobby.icon} ` : ""}${hobby.name}`}
      title={note ? "Edit note" : `Add a note to ${hobby.name}`}
      className="sm:max-w-xl"
    >
      <NoteForm
        key={open ? (note?.id ?? `new:${hobby.id}`) : "closed"}
        note={note ?? undefined}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
        owner={hobby}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* The form both editors share                                         */
/* ------------------------------------------------------------------ */

function NoteForm({
  note,
  owner,
  onClose,
  onSubmit,
  onDelete,
}: {
  note?: GeneralNote | HobbyNote;
  owner?: Hobby;
  onClose: () => void;
  onSubmit: (draft: NoteDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<NoteDraft>(() =>
    note ? { title: note.title, content: note.content } : { title: "", content: "" },
  );

  // A note may be untitled — `deriveNoteTitle` falls back to the first line of
  // the body, so saving is allowed as long as something exists.
  const hasSomething = draft.title.trim().length > 0 || draft.content.trim().length > 0;

  const submit = () => {
    if (!hasSomething) return;
    onSubmit({ title: draft.title, content: draft.content });
  };

  return (
    <div className="space-y-4">
      <Field label="Title" hint="Optional">
        <Input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          maxLength={120}
          placeholder="A name for this thought"
          autoFocus
        />
      </Field>

      <Field label="Note">
        <Textarea
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          rows={9}
          placeholder={
            owner
              ? `Write freely about ${owner.name}.`
              : "Write freely. Nothing here becomes a task."
          }
          className="min-h-[190px]"
        />
      </Field>

      {owner ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            data-hobby-accent={hobbyAccent(owner.accent)}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(var(--hobby))" }}
          />
          Filed under {owner.name}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          General note — kept on its own, not filed under any hobby.
        </p>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        {onDelete ? (
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!hasSomething} onClick={submit}>
            {note ? "Save note" : owner ? "Add note" : "Create note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
