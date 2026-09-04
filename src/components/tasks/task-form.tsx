"use client";

import { useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Segmented } from "@/components/ui/segmented";
import { DayChips } from "./section-days";
import { useStore } from "@/lib/store";
import type {
  CustomSection,
  Priority,
  Schedule,
  ScheduleType,
  Task,
  Weekday,
} from "@/lib/types";

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
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={isEdit ? "Edit task" : "Create task"}
      title={isEdit ? task?.title : "New task"}
      className="sm:max-w-[560px]"
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
  const startingCustom = startingSection.startsWith("custom:")
    ? sections.find((s) => s.id === startingSection.slice("custom:".length))
    : undefined;

  const [sectionKey, setSectionKey] = useState<SectionKey>(startingSection);
  const [title, setTitle] = useState(task?.title ?? "");
  const [hours, setHours] = useState(task ? Math.floor(task.estimatedMinutes / 60) : 1);
  const [mins, setMins] = useState(task ? task.estimatedMinutes % 60 : 0);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [description, setDescription] = useState(task?.description ?? "");
  const [nextAction, setNextAction] = useState(task?.nextAction ?? "");

  const [scheduleType, setScheduleType] = useState<ScheduleType>(
    task?.schedule?.type ?? startingCustom?.schedule.type ?? "daily",
  );
  const [days, setDays] = useState<Weekday[]>(
    task?.schedule?.days ?? startingCustom?.schedule.days ?? [],
  );
  const [startTime, setStartTime] = useState(
    task?.schedule?.startTime ?? startingCustom?.schedule.startTime ?? "",
  );
  const [endTime, setEndTime] = useState(
    task?.schedule?.endTime ?? startingCustom?.schedule.endTime ?? "",
  );

  const isScheduleList = sectionKey === "daily" || sectionKey.startsWith("custom:");

  const pickSection = (key: SectionKey) => {
    setSectionKey(key);
    // When creating into a custom section, adopt the section's own rhythm.
    if (!isEdit && key.startsWith("custom:")) {
      const sec: CustomSection | undefined = sections.find(
        (s) => s.id === key.slice("custom:".length),
      );
      if (sec) {
        setScheduleType(sec.schedule.type);
        setDays(sec.schedule.days ?? []);
        setStartTime(sec.schedule.startTime ?? "");
        setEndTime(sec.schedule.endTime ?? "");
      }
    }
  };

  const showScheduleDays = isScheduleList && scheduleType !== "daily";
  const estimatedMinutes = (Number(hours) || 0) * 60 + (Number(mins) || 0);
  const canSubmit = title.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    let section: Task["section"] = sectionKey as Task["section"];
    let customSectionId: string | undefined;
    if (sectionKey.startsWith("custom:")) {
      section = "custom";
      customSectionId = sectionKey.slice("custom:".length);
    }
    const schedule: Schedule | undefined = isScheduleList
      ? {
          type: scheduleType,
          days: scheduleType === "daily" ? undefined : days,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        }
      : undefined;

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
        schedule,
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
        schedule,
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
          placeholder="e.g. DSA Practice"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
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
            <option value="remainder">Remainder</option>
            <option value="occasional">Occasional</option>
            {sections.map((s) => (
              <option key={s.id} value={`custom:${s.id}`}>
                {s.icon ? `${s.icon} ` : ""}
                {s.name}
              </option>
            ))}
          </Select>
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

      {isScheduleList && (
        <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-foreground/90">Schedule</span>
            <Segmented<ScheduleType>
              size="sm"
              options={[
                { value: "daily", label: "Every day" },
                { value: "weekly", label: "Weekly" },
                { value: "custom", label: "Custom days" },
              ]}
              value={scheduleType}
              onChange={(v) => {
                setScheduleType(v);
                if (v === "weekly" && days.length !== 1) {
                  const today = (new Date().getDay() + 6) % 7;
                  setDays([today as Weekday]);
                }
                if (v === "custom" && days.length === 0) {
                  setDays([1, 3, 5]);
                }
              }}
            />
          </div>
          {showScheduleDays && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">
                {scheduleType === "weekly" ? "Repeat every week on" : "Repeat on"}
              </p>
              <DayChips value={days} onChange={setDays} single={scheduleType === "weekly"} />
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">Start</span>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              aria-label="Start time"
              className="h-8 w-[110px] px-2 font-mono text-xs tnum"
            />
            <span className="font-mono text-[11px] text-muted-foreground">End</span>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              aria-label="End time"
              className="h-8 w-[110px] px-2 font-mono text-xs tnum"
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Due date" hint="optional — surfaces as a special task" htmlFor="tf-due">
          <Input id="tf-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
