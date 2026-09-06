"use client";

import { useState } from "react";
import { Check, Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ListShell } from "@/components/ui/list";
import { Chip } from "@/components/ui/typography";
import { useStore } from "@/lib/store";
import { scheduleSummary } from "@/lib/labels";
import type { ScheduleType, Weekday } from "@/lib/types";
import { DayChips } from "../tasks/section-days";

function SectionFormModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const addCustomSection = useStore((s) => s.addCustomSection);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [type, setType] = useState<ScheduleType>("daily");
  const [days, setDays] = useState<Weekday[]>([1, 3, 5]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const reset = () => {
    setName("");
    setIcon("");
    setType("daily");
    setDays([1, 3, 5]);
    setStartTime("");
    setEndTime("");
  };

  const canSave = name.trim().length > 0 && (type === "daily" || days.length > 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Profile · Settings"
      title="Create section"
      className="sm:max-w-[480px]"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSave) return;
          addCustomSection({
            name: name.trim(),
            icon,
            schedule: {
              type,
              days: type === "daily" ? undefined : days,
              startTime: startTime || undefined,
              endTime: endTime || undefined,
            },
          });
          reset();
          onClose();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-[1fr_92px] gap-3">
          <Field label="Name" htmlFor="sec-name">
            <Input
              id="sec-name"
              autoFocus
              placeholder="e.g. Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
            />
          </Field>
          <Field label="Icon">
            <Input
              aria-label="Icon (emoji)"
              placeholder="🧪"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={4}
              className="px-2 text-center"
            />
          </Field>
        </div>

        <Field label="Repeats">
          <Segmented<ScheduleType>
            className="w-full"
            options={[
              { value: "daily", label: "Every day" },
              { value: "weekly", label: "Weekly" },
              { value: "custom", label: "Selected days" },
            ]}
            value={type}
            onChange={(v) => {
              setType(v);
              if (v === "weekly" && days.length !== 1) {
                setDays([((new Date().getDay() + 6) % 7) as Weekday]);
              }
            }}
          />
        </Field>

        {type !== "daily" && (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">
              {type === "weekly" ? "One day each week" : "Pick the days"}
            </p>
            <DayChips value={days} onChange={setDays} single={type === "weekly"} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">Start</span>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            aria-label="Start time"
            className="h-8 min-w-0 flex-1 px-2 font-mono text-xs tnum"
          />
          <span className="font-mono text-[11px] text-muted-foreground">End</span>
          <Input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            aria-label="End time"
            className="h-8 min-w-0 flex-1 px-2 font-mono text-xs tnum"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSave}>
            <Plus className="h-4 w-4" /> Create section
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CustomSectionManager() {
  const sections = useStore((s) => s.sections);
  const tasks = useStore((s) => s.tasks);
  const removeCustomSection = useStore((s) => s.removeCustomSection);
  const updateCustomSection = useStore((s) => s.updateCustomSection);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            My sections
          </h3>
          <span className="font-mono text-[10.5px] tnum text-muted-foreground">
            {sections.length}
          </span>
        </div>
        <Button size="sm" variant="soft" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Create section
        </Button>
      </div>

      {sections.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-4 w-4" strokeWidth={1.5} />}
          title="No custom sections yet"
          body="Sections become extra groups on your dashboard and new options when creating tasks."
          className="rounded-xl border border-border bg-card/60 py-10"
          action={
            <Button size="sm" variant="soft" onClick={() => setCreateOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Create your first section
            </Button>
          }
        />
      ) : (
        <ListShell>
          {sections.map((s) => {
            const count = tasks.filter((t) => t.customSectionId === s.id).length;
            const inUse = count > 0;
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-base">
                  {s.icon ?? "•"}
                </span>
                <div className="min-w-0 flex-1">
                  {editingId === s.id ? (
                    <form
                      className="flex min-w-0 items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (editName.trim()) updateCustomSection(s.id, { name: editName });
                        setEditingId(null);
                      }}
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        maxLength={40}
                        autoFocus
                        aria-label={`Rename ${s.name}`}
                        className="h-8 min-w-0 px-2 text-[13px]"
                      />
                      <button type="submit" aria-label="Save section name" className="shrink-0 text-success">
                        <Check className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label="Cancel rename" onClick={() => setEditingId(null)} className="shrink-0 text-muted-foreground">
                        <X className="h-4 w-4" />
                      </button>
                    </form>
                  ) : (
                    <p className="truncate text-[13.5px] font-medium text-foreground">{s.name}</p>
                  )}
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {scheduleSummary(s.schedule)}
                    {s.schedule.startTime &&
                      ` · ${s.schedule.startTime}${s.schedule.endTime ? `–${s.schedule.endTime}` : ""}`}
                  </p>
                </div>
                <Chip tone={inUse ? "neutral" : "success"}>
                  {count} task{count === 1 ? "" : "s"}
                </Chip>
                {editingId !== s.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(s.id);
                      setEditName(s.name);
                    }}
                    aria-label={`Rename section ${s.name}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                )}
                <button
                  type="button"
                  disabled={inUse}
                  onClick={() => removeCustomSection(s.id)}
                  aria-label={
                    inUse
                      ? `${s.name} is in use — delete its tasks first`
                      : `Delete section ${s.name}`
                  }
                  title={
                    inUse
                      ? "Move or delete its tasks before removing this section"
                      : "Delete section"
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>
            );
          })}
        </ListShell>
      )}

      <SectionFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
