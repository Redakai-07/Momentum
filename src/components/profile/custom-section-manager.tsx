"use client";

import { useState } from "react";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, ListShell } from "@/components/ui/list";
import { Chip } from "@/components/ui/typography";
import { useStore } from "@/lib/store";
import { scheduleSummary } from "@/lib/labels";
import type { CustomSection, MonthOccurrence, Schedule, ScheduleType, Weekday } from "@/lib/types";
import { DayChips } from "../tasks/section-days";

function SectionFormModal({
  open,
  onClose,
  section,
}: {
  open: boolean;
  onClose: () => void;
  section?: { id: string; name: string; icon?: string; schedule: Schedule };
}) {
  const addCustomSection = useStore((s) => s.addCustomSection);
  const updateCustomSection = useStore((s) => s.updateCustomSection);
  const [name, setName] = useState(section?.name ?? "");
  const [icon, setIcon] = useState(section?.icon ?? "");
  const [schedule, setSchedule] = useState<Schedule>(section?.schedule ?? { type: "daily" });

  const reset = () => {
    setName("");
    setIcon("");
    setSchedule({ type: "daily" });
  };

  const canSave = name.trim().length > 0 && (schedule.type === "daily" || schedule.type === "monthly-date" || schedule.type === "monthly-weekday" || Boolean(schedule.days?.length));
  const type = schedule.type;
  const setType = (value: ScheduleType) => {
    setSchedule((current) => value === "daily" ? { type: "daily" } : value === "monthly-date" ? { type: "monthly-date", dayOfMonth: current.dayOfMonth ?? 1 } : value === "monthly-weekday" ? { type: "monthly-weekday", occurrence: current.occurrence ?? "first", weekday: current.weekday ?? 1 } : { type: value, days: current.days?.length ? current.days : [1, 3, 5] });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Profile · Settings"
      title={section ? "Edit section" : "Create section"}
      className="sm:max-w-120"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSave) return;
          const next = { ...schedule, startTime: schedule.startTime || undefined, endTime: schedule.endTime || undefined };
          if (section) updateCustomSection(section.id, { name: name.trim(), icon, schedule: next });
          else addCustomSection({ name: name.trim(), icon, schedule: next });
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

        <Field label="Schedule">
          <Segmented<ScheduleType>
            className="w-full"
            options={[
              { value: "daily", label: "Every day" },
              { value: "weekly", label: "Weekly" },
              { value: "custom", label: "Selected days" },
              { value: "monthly-date", label: "Monthly date" },
              { value: "monthly-weekday", label: "Monthly weekday" },
            ]}
            value={type}
            onChange={setType}
          />
        </Field>

        {(type === "weekly" || type === "custom") && (
          <div>
            <p className="mb-1.5 text-xs text-muted-foreground">
              {type === "weekly" ? "One day each week" : "Repeat on"}
            </p>
            <DayChips value={schedule.days ?? []} onChange={(days) => setSchedule({ ...schedule, days })} single={type === "weekly"} />
          </div>
        )}

        {type === "monthly-date" && (
          <Field label="Day of month">
            <Select value={String(schedule.dayOfMonth ?? 1)} onChange={(e) => setSchedule({ ...schedule, dayOfMonth: e.target.value === "last" ? "last" : Number(e.target.value) })} aria-label="Day of month">
              {Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
              <option value="last">Last day</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">If that day does not exist, this month is skipped.</p>
          </Field>
        )}

        {type === "monthly-weekday" && (
          <div className="grid grid-cols-2 gap-2">
            <Select value={schedule.occurrence ?? "first"} onChange={(e) => setSchedule({ ...schedule, occurrence: e.target.value as MonthOccurrence })} aria-label="Occurrence">
              {(["first", "second", "third", "fourth", "last"] as MonthOccurrence[]).map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </Select>
            <Select value={String(schedule.weekday ?? 1)} onChange={(e) => setSchedule({ ...schedule, weekday: Number(e.target.value) as Weekday })} aria-label="Weekday">
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((value, index) => <option key={value} value={index}>{value}</option>)}
            </Select>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">Start</span>
          <Input
            type="time"
            value={schedule.startTime ?? ""}
            onChange={(e) => setSchedule({ ...schedule, startTime: e.target.value })}
            aria-label="Start time"
            className="h-8 min-w-0 flex-1 px-2 font-mono text-xs tnum"
          />
          <span className="font-mono text-[11px] text-muted-foreground">End</span>
          <Input
            type="time"
            value={schedule.endTime ?? ""}
            onChange={(e) => setSchedule({ ...schedule, endTime: e.target.value })}
            aria-label="End time"
            className="h-8 min-w-0 flex-1 px-2 font-mono text-xs tnum"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={!canSave}>
            <Plus className="h-4 w-4" /> {section ? "Save section" : "Create section"}
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
  const [createOpen, setCreateOpen] = useState(false);
  const [editSection, setEditSection] = useState<CustomSection | null>(null);

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
                  <p className="truncate text-[13.5px] font-medium text-foreground">{s.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {scheduleSummary(s.schedule)}
                    {s.schedule.startTime &&
                      ` · ${s.schedule.startTime}${s.schedule.endTime ? `–${s.schedule.endTime}` : ""}`}
                  </p>
                </div>
                <Chip tone={inUse ? "neutral" : "success"}>
                  {count} task{count === 1 ? "" : "s"}
                </Chip>
                <button
                  type="button"
                  onClick={() => {
                    setEditSection(s);
                  }}
                  aria-label={`Edit section ${s.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
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

      <SectionFormModal
        key={editSection?.id ?? (createOpen ? "create" : "closed")}
        open={createOpen || Boolean(editSection)}
        onClose={() => {
          setCreateOpen(false);
          setEditSection(null);
        }}
        section={editSection ?? undefined}
      />
    </div>
  );
}
