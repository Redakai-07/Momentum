"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { useStore } from "@/lib/store";
import { useModalStack } from "@/lib/modal-stack";
import type {
  Priority,
  Task,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { scheduleSummary } from "@/lib/labels";

type SectionKey = "daily" | "remainder" | "occasional" | `custom:${string}`;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pass a task to edit; otherwise creates. */
  task?: Task;
  defaultSection?: SectionKey;
}

function initialSectionKey(task: Task | undefined, fallback: SectionKey): SectionKey {
  if (!task) return fallback;
  if (task.section === "custom") {
    return task.customSectionId ? `custom:${task.customSectionId}` : "remainder";
  }
  return task.section as SectionKey;
}

export function TaskFormModal({ open, onClose, task, defaultSection = "daily" }: Props) {
  const isEdit = Boolean(task);
  const id = task ? `modal:edit:${task.id}` : "modal:create-task";
  useModalStack(id, isEdit ? "Edit task" : "Create task", onClose, open);
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? "Edit task" : "New task"}
      title={isEdit ? task?.title : undefined}
      className="sm:max-w-140"
    >
      <TaskFormBody
        key={open ? (task?.id ?? "create") : "closed"}
        task={task}
        defaultSection={defaultSection}
        onClose={onClose}
      />
    </Modal>
  );
}

function TaskFormBody({
  task,
  defaultSection,
  onClose,
}: {
  task?: Task;
  defaultSection: SectionKey;
  onClose: () => void;
}) {
  const sections = useStore((s) => s.sections);
  const addTask = useStore((s) => s.addTask);
  const updateTask = useStore((s) => s.updateTask);
  const isEdit = Boolean(task);

  const startingSection = initialSectionKey(task, defaultSection);
  const [sectionKey, setSectionKey] = useState<SectionKey>(startingSection);
  const [title, setTitle] = useState(task?.title ?? "");
  const [hours, setHours] = useState(task ? Math.floor(task.estimatedMinutes / 60) : 0);
  const [mins, setMins] = useState(task ? task.estimatedMinutes % 60 : 30);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [description, setDescription] = useState(task?.description ?? "");
  const [nextAction, setNextAction] = useState(task?.nextAction ?? "");
  const [detailsOpen, setDetailsOpen] = useState(Boolean(task && (task.description || task.nextAction || task.dueDate || task.priority !== undefined)));

  const pickSection = (key: SectionKey) => {
    setSectionKey(key);
  };
  const estimatedMinutes = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  const canSubmit = title.trim().length > 0;
  const selectedSchedule = sectionKey.startsWith("custom:")
    ? sections.find((section) => section.id === sectionKey.slice("custom:".length))?.schedule
    : sectionKey === "daily"
      ? { type: "daily" as const }
      : undefined;

  const submit = () => {
    if (!canSubmit) return;
    let section: Task["section"] = sectionKey as Task["section"];
    let customSectionId: string | undefined;
    if (sectionKey.startsWith("custom:")) {
      section = "custom";
      customSectionId = sectionKey.slice("custom:".length);
    }
    if (isEdit && task) {
      updateTask(task.id, {
        title: title.trim(),
        section,
        customSectionId,
        estimatedMinutes,
        description: description.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
        dueDate: dueDate || undefined,
        priority,
      });
    } else {
      addTask({
        title: title.trim(),
        section,
        customSectionId,
        estimatedMinutes,
        description: description.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
        dueDate: dueDate || undefined,
        priority,
      });
    }
    onClose();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Task name" htmlFor="tf-title">
        <Input
          id="tf-title"
          autoFocus
          placeholder="What do you want to work on?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          className="h-10 text-[15px]"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Section" htmlFor="tf-section">
          <Select
            id="tf-section"
            value={sectionKey}
            onChange={(e) => pickSection(e.target.value as SectionKey)}
          >
            <option value="daily">Daily</option>
            <option value="remainder">Reminder</option>
            <option value="occasional">Occasional</option>
            {sections.map((s) => (
              <option key={s.id} value={`custom:${s.id}`}>
                {s.icon ? `${s.icon} ` : ""}
                {s.name}
              </option>
            ))}
          </Select>
          {selectedSchedule && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {scheduleSummary(selectedSchedule)}
            </p>
          )}
        </Field>

        <Field label="Estimated time">
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={0}
              max={24}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              aria-label="Hours"
              className="px-2 text-center font-mono tnum"
            />
            <span className="font-mono text-[11px] text-muted-foreground">hr</span>
            <Input
              type="number"
              min={0}
              max={59}
              step={5}
              value={mins}
              onChange={(e) => setMins(Number(e.target.value))}
              aria-label="Minutes"
              className="px-2 text-center font-mono tnum"
            />
            <span className="font-mono text-[11px] text-muted-foreground">min</span>
          </div>
        </Field>
      </div>

      {/* Progressive disclosure — advanced options stay out of the way. */}
      {!isEdit && (
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          className="flex w-full items-center justify-between rounded-lg border border-border/70 bg-muted/25 px-3.5 py-2.5 text-[13px] font-medium text-foreground/85 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          Add details
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-200",
              detailsOpen && "rotate-180",
            )}
            strokeWidth={2}
          />
        </button>
      )}

      {detailsOpen && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Due date" hint="optional" htmlFor="tf-due">
              <Input
                id="tf-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field label="Priority">
              <Segmented<Priority>
                className="w-full"
                options={[
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Med" },
                  { value: "high", label: "High" },
                ]}
                value={priority}
                onChange={setPriority}
              />
            </Field>
          </div>

          <Field label="Next action" hint="optional — the concrete next step">
            <Input
              placeholder="e.g. Complete 3Sum using two pointers"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              maxLength={160}
            />
          </Field>

          <Field label="Description" hint="optional">
            <Textarea
              placeholder="What does this involve? Topics, resources, steps…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
        <Button variant="ghost" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!canSubmit}>
          {isEdit ? (
            <>
              <CheckCircle2 className="h-4 w-4" /> Save changes
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Create task
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
