"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Pencil, Trash2, X } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/typography";
import { TimeLogControl } from "./time-log-control";
import type { Task } from "@/lib/types";
import { formatMinutes } from "@/lib/format";
import { useStore } from "@/lib/store";
import { sectionLabel, scheduleSummary, timeRange } from "@/lib/labels";
import { parseKey } from "@/lib/date";
import { cn } from "@/lib/utils";
import { TaskFormModal } from "./task-form";

function NextActionBlock({ task }: { task: Task }) {
  const updateTask = useStore((s) => s.updateTask);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.nextAction ?? "");
  const value = task.nextAction ?? "";

  const save = () => {
    updateTask(task.id, { nextAction: draft.trim() || undefined });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(task.nextAction ?? "");
    setEditing(false);
  };

  return (
    <div className="rounded-xl border border-border/70 bg-accent/40 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Next action
        </p>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraft(value);
              setEditing(true);
            }}
            aria-label="Edit next action"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3 w-3" strokeWidth={2} />
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="The concrete next step…"
            className="h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring/60"
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={cancel}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={save} disabled={!draft.trim()}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Save
            </Button>
          </div>
        </div>
      ) : value ? (
        <p className="mt-1.5 flex items-start gap-2 text-[13.5px] font-medium leading-snug text-foreground">
          <ArrowRight
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal"
            strokeWidth={2.2}
          />
          {value}
        </p>
      ) : (
        <p
          className="mt-1.5 cursor-pointer text-[13px] text-muted-foreground"
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
        >
          Add the one concrete step that moves this forward…
        </p>
      )}
    </div>
  );
}

function MetaLine({ task }: { task: Task }) {
  const sections = useStore((s) => s.sections);
  const label = sectionLabel(task, sections);
  const parts: string[] = [];
  if (task.schedule) parts.push(scheduleSummary(task.schedule));
  const range = timeRange(task.schedule);
  if (range) parts.push(range);

  const today = todayLocalKey();
  const d = task.dueDate ? parseKey(task.dueDate) : null;
  const dueLabel = d
    ? d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <Chip tone="neutral" className="text-foreground/75">
        {label.icon ? `${label.icon} ` : ""}
        {label.title}
      </Chip>
      {task.estimatedMinutes > 0 && (
        <Chip tone="neutral" className="text-foreground/75">
          {formatMinutes(task.estimatedMinutes)}
        </Chip>
      )}
      {task.priority === "high" && <Chip tone="signal">high priority</Chip>}
      {task.priority === "low" && <Chip tone="neutral">low priority</Chip>}
      {task.dueDate && d && (
        <Chip tone={task.dueDate < today ? "danger" : task.dueDate === today ? "signal" : "neutral"}>
          {task.dueDate < today ? `overdue · ${dueLabel}` : `due ${dueLabel}`}
        </Chip>
      )}
      {parts.length > 0 && (
        <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
          {parts.join(" · ")}
        </span>
      )}
    </div>
  );
}

function todayLocalKey() {
  const t = new Date();
  return [
    t.getFullYear(),
    String(t.getMonth() + 1).padStart(2, "0"),
    String(t.getDate()).padStart(2, "0"),
  ].join("-");
}

export function TaskDetailModal({
  taskId,
  onClose,
}: {
  taskId: string | null;
  onClose: () => void;
}) {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId) ?? null);
  const toggleTask = useStore((s) => s.toggleTask);
  const deleteTask = useStore((s) => s.deleteTask);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sections = useStore((s) => s.sections);

  if (!task) return null;
  const label = sectionLabel(task, sections);

  return (
    <>
      <Modal
        open={Boolean(taskId)}
        onClose={onClose}
        eyebrow={label.title}
        title={task.title}
        labelledBy=""
      >
        {task.description && (
          <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/85">
            {task.description}
          </p>
        )}
        <MetaLine task={task} />
        <div className="space-y-3">
          <NextActionBlock task={task} />
          {task.estimatedMinutes > 0 && <TimeLogControl task={task} />}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-4">
          <div>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-destructive">Delete this task?</span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    deleteTask(task.id);
                    onClose();
                  }}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
            {task.completed ? (
              <Button size="sm" variant="soft" onClick={() => toggleTask(task.id, false)}>
                Reopen
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => toggleTask(task.id, true)}
                className={cn(task.estimatedMinutes > 0 && "font-medium")}
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                {task.estimatedMinutes > 0 && task.remainingMinutes > 0
                  ? "Complete"
                  : "Mark done"}
              </Button>
            )}
          </div>
        </div>
      </Modal>

      {editing && task && (
        <TaskFormModal
          task={task}
          open={editing}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
