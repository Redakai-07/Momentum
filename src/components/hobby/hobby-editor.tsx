"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { HOBBY_ACCENTS, hobbyAccent } from "@/lib/hobbies";
import type { Hobby, HobbyAccent } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface HobbyDraft {
  name: string;
  description: string;
  icon: string;
  accent: HobbyAccent;
}

/** A handful of one-tap glyphs so naming a hobby never needs a keyboard. */
const ICON_CHOICES = ["📚", "📷", "🎧", "♟️", "🎨", "🏃", "🎮", "🖥️", "🌱", "✍️", "🍳", "🧩"];

export function HobbyEditor({
  open,
  hobby,
  onClose,
  onSubmit,
  onDelete,
}: {
  open: boolean;
  /** When present the modal edits; otherwise it creates. */
  hobby?: Hobby | null;
  onClose: () => void;
  onSubmit: (draft: HobbyDraft) => void;
  onDelete?: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={hobby ? "Edit hobby" : "New hobby"}
      title={hobby ? hobby.name : "What do you enjoy?"}
    >
      {/* Keyed so the fields reset whenever the modal is reopened or the
          target hobby changes — no state-syncing effect needed. */}
      <HobbyForm
        key={open ? (hobby?.id ?? "new") : "closed"}
        hobby={hobby ?? undefined}
        onClose={onClose}
        onSubmit={onSubmit}
        onDelete={onDelete}
      />
    </Modal>
  );
}

function HobbyForm({
  hobby,
  onClose,
  onSubmit,
  onDelete,
}: {
  hobby?: Hobby;
  onClose: () => void;
  onSubmit: (draft: HobbyDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<HobbyDraft>(() =>
    hobby
      ? {
          name: hobby.name,
          description: hobby.description ?? "",
          icon: hobby.icon ?? "",
          accent: hobbyAccent(hobby.accent),
        }
      : { name: "", description: "", icon: "", accent: "teal" },
  );

  const valid = draft.name.trim().length > 0;

  const submit = () => {
    if (!valid) return;
    onSubmit({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
  };

  return (
    <div className="space-y-4">
      <Field label="Name" htmlFor="hobby-name">
        <Input
          id="hobby-name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          maxLength={60}
          placeholder="Photography, Reading, Chess…"
          autoFocus
        />
      </Field>

      <Field label="Description" hint="Optional">
        <Textarea
          value={draft.description}
          onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
          maxLength={180}
          rows={2}
          placeholder="A short note about what this means to you."
        />
      </Field>

      <Field label="Icon">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, icon: "" }))}
            aria-pressed={draft.icon === ""}
            className={cn(
              "press grid h-9 w-9 place-items-center rounded-lg border text-xs text-muted-foreground",
              draft.icon === ""
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-card hover:bg-muted/50",
            )}
          >
            None
          </button>
          {ICON_CHOICES.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, icon }))}
              aria-pressed={draft.icon === icon}
              aria-label={`Icon ${icon}`}
              className={cn(
                "press grid h-9 w-9 place-items-center rounded-lg border text-[17px] leading-none",
                draft.icon === icon
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-muted/50",
              )}
            >
              {icon}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Accent">
        <div className="flex flex-wrap items-center gap-2">
          {HOBBY_ACCENTS.map((a) => (
            <button
              key={a.value}
              type="button"
              data-hobby-accent={a.value}
              aria-label={a.label}
              aria-pressed={draft.accent === a.value}
              title={a.label}
              onClick={() => setDraft((d) => ({ ...d, accent: a.value }))}
              className={cn(
                "press h-8 w-8 rounded-full border-2 transition-transform",
                draft.accent === a.value
                  ? "border-foreground ring-2 ring-ring/40 ring-offset-2 ring-offset-background"
                  : "border-transparent",
              )}
              style={{ backgroundColor: "hsl(var(--hobby))" }}
            />
          ))}
        </div>
      </Field>

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
          <Button variant="primary" size="sm" disabled={!valid} onClick={submit}>
            {hobby ? "Save changes" : "Add hobby"}
          </Button>
        </div>
      </div>
    </div>
  );
}
