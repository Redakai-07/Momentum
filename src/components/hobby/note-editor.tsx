"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { hobbyAccent } from "@/lib/hobbies";
import type { Hobby, Note } from "@/lib/types";

export interface NoteDraft {
  title: string;
  content: string;
  hobbyId?: string;
}

export function NoteEditor({
  open,
  note,
  hobbies,
  /** Preselected hobby when creating from inside a hobby. */
  defaultHobbyId,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  note?: Note | null;
  hobbies: Hobby[];
  defaultHobbyId?: string;
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
      {/* Keyed so a fresh note never inherits the previous one's text. */}
      <NoteForm
        key={open ? (note?.id ?? `new:${defaultHobbyId ?? ""}`) : "closed"}
        note={note ?? undefined}
        hobbies={hobbies}
        defaultHobbyId={defaultHobbyId}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
      />
    </Modal>
  );
}

function NoteForm({
  note,
  hobbies,
  defaultHobbyId,
  onClose,
  onSubmit,
  onDelete,
}: {
  note?: Note;
  hobbies: Hobby[];
  defaultHobbyId?: string;
  onClose: () => void;
  onSubmit: (draft: NoteDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<NoteDraft>(() =>
    note
      ? { title: note.title, content: note.content, hobbyId: note.hobbyId }
      : { title: "", content: "", hobbyId: defaultHobbyId },
  );

  // A note may be untitled — `deriveNoteTitle` falls back to the first line of
  // the body, so saving is allowed as long as something exists.
  const hasSomething = draft.title.trim().length > 0 || draft.content.trim().length > 0;
  const owner = draft.hobbyId ? hobbies.find((h) => h.id === draft.hobbyId) : undefined;

  const submit = () => {
    if (!hasSomething) return;
    onSubmit({ ...draft, hobbyId: draft.hobbyId || undefined });
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
          placeholder="Write freely. Nothing here becomes a task."
          className="min-h-[190px]"
        />
      </Field>

      <Field label="Hobby" hint="Optional">
        <Select
          value={draft.hobbyId ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, hobbyId: e.target.value || undefined }))}
          aria-label="Hobby"
        >
          <option value="">No hobby — keep it unfiled</option>
          {hobbies.map((h) => (
            <option key={h.id} value={h.id}>
              {h.icon ? `${h.icon} ` : ""}
              {h.name}
            </option>
          ))}
        </Select>
      </Field>

      {owner && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            data-hobby-accent={hobbyAccent(owner.accent)}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "hsl(var(--hobby))" }}
          />
          Filed under {owner.name}
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
            {note ? "Save note" : "Create note"}
          </Button>
        </div>
      </div>
    </div>
  );
}
