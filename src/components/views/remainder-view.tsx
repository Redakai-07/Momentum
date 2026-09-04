"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, LayoutList, Plus } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/layout/page-frame";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function sortRemainder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = a.dueDate ?? "9999";
    const bd = b.dueDate ?? "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    const ap = PRIORITY_RANK[a.priority ?? "medium"] ?? 1;
    const bp = PRIORITY_RANK[b.priority ?? "medium"] ?? 1;
    if (ap !== bp) return ap - bp;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

export function RemainderView() {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const tasks = useStore((s) => s.tasks);
  const toggleTask = useStore((s) => s.toggleTask);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const open = useMemo(
    () => sortRemainder(tasks.filter((t) => t.section === "remainder" && !t.completed)),
    [tasks],
  );
  const done = useMemo(
    () => tasks.filter((t) => t.section === "remainder" && t.completed),
    [tasks],
  );

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Backlog"
        title="Remainder"
        sub={
          open.length > 0
            ? `${open.length} open task${open.length === 1 ? "" : "s"} — complete these to keep the list honest.`
            : undefined
        }
        aside={
          <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Task
          </Button>
        }
      />

      {!mounted || !ready ? (
        <ListSkeleton rows={5} />
      ) : open.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<LayoutList className="h-4 w-4" strokeWidth={1.5} />}
          title="The remainder list is empty"
          body="Tasks that need finishing but aren't daily habits live here — assignments, deadlines, one-off projects."
          action={
            <Button variant="soft" size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add a task
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <ListShell>
            {open.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                onOpen={(x) => setSelectedId(x.id)}
                onToggle={(x) => toggleTask(x.id)}
              />
            ))}
            {open.length === 0 && (
              <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
                Nothing open — all cleared. 🎉
              </div>
            )}
          </ListShell>

          {done.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={2} />
                <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
                  Completed
                </h2>
                <span className="font-mono text-[10.5px] tnum text-muted-foreground">
                  {done.length}
                </span>
              </div>
              <ListShell>
                {done.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onOpen={(x) => setSelectedId(x.id)}
                    onToggle={(x) => toggleTask(x.id)}
                  />
                ))}
              </ListShell>
            </section>
          )}
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultSection="remainder"
      />
    </PageFrame>
  );
}
