"use client";

import { useMemo, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { PageFrame, PageHeader } from "@/components/layout/page-frame";
import { useMounted } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import type { Task } from "@/lib/types";
import { ListShell, EmptyState, ListSkeleton } from "@/components/ui/list";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { TaskDetailModal } from "@/components/tasks/task-detail";
import { TaskFormModal } from "@/components/tasks/task-form";
import { scheduleSummary } from "@/lib/labels";

export function CustomSectionView({ sectionId }: { sectionId: string }) {
  const mounted = useMounted();
  const ready = useStore((s) => s.ready);
  const section = useStore((s) => s.sections.find((item) => item.id === sectionId));
  const tasks = useStore((s) => s.tasks);
  const toggleTask = useStore((s) => s.toggleTask);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const sectionTasks = useMemo(
    () => tasks.filter((task) => task.section === "custom" && task.customSectionId === sectionId),
    [tasks, sectionId],
  );
  const open = sectionTasks.filter((task) => task.status === "active");
  const done = sectionTasks.filter((task) => task.status === "completed");

  if (mounted && ready && !section) {
    return (
      <PageFrame>
        <EmptyState
          icon={<Layers className="h-4 w-4" strokeWidth={1.5} />}
          title="Section not found"
          body="This custom section may have been removed from your profile."
        />
      </PageFrame>
    );
  }

  return (
    <PageFrame>
      <PageHeader
        eyebrow="Custom section"
        title={section ? `${section.icon ? `${section.icon} ` : ""}${section.name}` : "Custom section"}
        sub={section ? scheduleSummary(section.schedule) : undefined}
        aside={
          <Button variant="primary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span> Task
          </Button>
        }
      />

      {!mounted || !ready ? (
        <ListSkeleton rows={4} />
      ) : open.length === 0 && done.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-4 w-4" strokeWidth={1.5} />}
          title="Nothing in this section yet"
          body="Keep related work together here and track progress from one place."
          action={
            <Button variant="soft" size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add a task
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          <ListShell>
            {open.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={(item) => setSelectedId(item.id)}
                onToggle={(item) => toggleTask(item.id)}
              />
            ))}
          </ListShell>
          {done.length > 0 && (
            <ListShell>
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onOpen={(item) => setSelectedId(item.id)}
                  onToggle={(item) => toggleTask(item.id)}
                />
              ))}
            </ListShell>
          )}
        </div>
      )}

      <TaskDetailModal taskId={selectedId} onClose={() => setSelectedId(null)} />
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultSection={`custom:${sectionId}`}
      />
    </PageFrame>
  );
}
