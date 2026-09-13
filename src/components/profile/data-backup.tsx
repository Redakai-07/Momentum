"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  HardDriveDownload,
  Info,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useStore } from "@/lib/store";
import { useTheme } from "@/components/theme/theme-provider";
import {
  parseBackup,
  type BackupSummary,
  type MomentumBackup,
} from "@/lib/backup";
import { formatBytes, readBackupFile } from "@/lib/backup-io";
import { cn } from "@/lib/utils";

interface Notice {
  tone: "success" | "error" | "info";
  title: string;
  body?: string;
  detail?: string;
}

const TONES = {
  success: {
    icon: CheckCircle2,
    wrap: "border-success/30 bg-success/5",
    icon_cls: "text-success",
  },
  error: {
    icon: AlertTriangle,
    wrap: "border-destructive/30 bg-destructive/5",
    icon_cls: "text-destructive",
  },
  info: {
    icon: Info,
    wrap: "border-border bg-muted/30",
    icon_cls: "text-muted-foreground",
  },
} as const;

function NoticeBanner({ notice }: { notice: Notice }) {
  const tone = TONES[notice.tone];
  const Icon = tone.icon;
  return (
    <div
      role="status"
      className={cn("anim-rise-in flex gap-2.5 rounded-xl border px-3.5 py-3", tone.wrap)}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.icon_cls)} strokeWidth={2} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{notice.title}</p>
        {notice.body && (
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{notice.body}</p>
        )}
        {notice.detail && (
          <p className="mt-1 font-mono text-[11px] leading-relaxed break-words text-muted-foreground/80">
            {notice.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function CountGrid({ summary }: { summary: BackupSummary }) {
  const rows: [string, number][] = [
    ["Tasks", summary.counts.tasks],
    ["Time logs", summary.counts.logs],
    ["Sections", summary.counts.sections],
    ["Days of history", summary.counts.performance],
    ["Hobbies", summary.counts.hobbies],
    ["Notes", summary.counts.notes],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/25 px-3.5 py-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className="truncate text-[12px] text-muted-foreground">{label}</dt>
          <dd className="tnum shrink-0 font-mono text-[12px] font-medium text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DataBackupSection() {
  const ready = useStore((s) => s.ready);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const exportBackup = useStore((s) => s.exportBackup);
  const importBackup = useStore((s) => s.importBackup);

  // Live counts, so "Export" is never a blind action.
  const taskCount = useStore((s) => s.tasks.length);
  const logCount = useStore((s) => s.logs.length);
  const noteCount = useStore((s) => s.notes.length);
  const hobbyCount = useStore((s) => s.hobbies.length);
  const sectionCount = useStore((s) => s.sections.length);

  const { refreshPreferences } = useTheme();

  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<{
    backup: MomentumBackup;
    summary: BackupSummary;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const totalRecords = taskCount + logCount + noteCount + hobbyCount + sectionCount;

  const onExport = async () => {
    setBusy("export");
    setNotice(null);
    const result = await exportBackup();
    setBusy(null);
    if (!result.ok) {
      setNotice({
        tone: "error",
        title: "Export failed",
        body: result.error ?? "Momentum couldn't create the backup file.",
      });
      return;
    }
    setNotice({
      tone: "success",
      title:
        result.destination === "shared"
          ? "Your backup is ready to save"
          : "Backup downloaded",
      body:
        result.destination === "shared"
          ? "Choose where to keep it — Files, Drive, email, or anywhere else. Store it somewhere safe."
          : "Store the file somewhere safe. It contains everything Momentum knows about your progress.",
      detail: result.filename
        ? `${result.filename} · ${formatBytes(result.bytes ?? 0)}`
        : undefined,
    });
  };

  const onPickFile = () => {
    setNotice(null);
    fileInput.current?.click();
  };

  const onFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset first so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;

    setNotice(null);
    const read = await readBackupFile(file);
    if (!read.ok) {
      setNotice({ tone: "error", title: "That file couldn't be opened", body: read.error });
      return;
    }

    const parsed = parseBackup(read.text);
    if (!parsed.ok) {
      setNotice({
        tone: "error",
        title: "We couldn't use that backup",
        body: parsed.error,
        detail: file.name,
      });
      return;
    }
    setPending({ backup: parsed.backup, summary: parsed.summary });
  };

  const onConfirmImport = async () => {
    if (!pending) return;
    setBusy("import");
    const result = await importBackup(pending.backup);
    setBusy(null);

    if (!result.ok) {
      setPending(null);
      setNotice({
        tone: "error",
        title: "Restore cancelled",
        body: result.error,
      });
      return;
    }

    setPending(null);
    // The restored accent/theme live behind the theme provider, which has no
    // idea the database changed underneath it.
    refreshPreferences();

    const counts = result.counts;
    setNotice({
      tone: "success",
      title: "Backup restored",
      body: counts
        ? `Your workspace now holds ${counts.tasks} task${counts.tasks === 1 ? "" : "s"}, ${counts.logs} time log${counts.logs === 1 ? "" : "s"} and ${counts.performance} day${counts.performance === 1 ? "" : "s"} of history. Today's plan and your streak have been recalculated.`
        : "Your workspace has been restored and recalculated.",
      detail: result.safety?.filename
        ? `Your previous data was saved first as ${result.safety.filename}`
        : undefined,
    });
  };

  return (
    <section className="space-y-2.5">
      <div className="flex items-center gap-2 px-0.5">
        <Database className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Data &amp; Backup</h2>
      </div>

      <div className="surface rounded-2xl px-4 py-3.5">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={1.75} />
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Your data stays on this device. A backup is a single file you keep yourself — nothing
            is uploaded, and Momentum never sends it anywhere.
          </p>
        </div>

        <p className="mt-2 font-mono text-[11px] tnum text-muted-foreground/90">
          {ready && totalRecords > 0 ? (
            <>
              {taskCount} tasks · {logCount} time logs · {sectionCount} sections · {hobbyCount}{" "}
              hobbies · {noteCount} notes
            </>
          ) : (
            "Nothing saved yet"
          )}
        </p>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={busy !== null || !ready}
            onClick={() => void onExport()}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            {busy === "export" ? "Preparing…" : "Export Data"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !ready}
            onClick={onPickFile}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={2} />
            Import Data
          </Button>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            Last backup:{" "}
            <span className="text-foreground/80">{formatWhen(lastBackupAt)}</span>
          </span>
        </div>

        <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground/80">
          Export saves tasks, time logs, performance history, streaks, sections, hobbies, notes
          and settings. Import replaces everything currently in Momentum — a safety copy of your
          current data is saved first.
        </p>

        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void onFileChosen(e)}
          aria-hidden
          tabIndex={-1}
        />
      </div>

      {notice && <NoticeBanner notice={notice} />}

      {/* -------------------------- Confirm restore -------------------------- */}
      <Modal
        open={!!pending}
        onClose={() => (busy === "import" ? undefined : setPending(null))}
        eyebrow="Restore backup"
        title="Restore this backup?"
        className="sm:max-w-md"
      >
        {pending && (
          <div className="space-y-3.5">
            <div className="flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                strokeWidth={2}
              />
              <p className="text-[12.5px] leading-relaxed text-foreground">
                This will replace your current Momentum data with the data from this backup.
              </p>
            </div>

            <div>
              <p className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                This backup contains
              </p>
              <CountGrid summary={pending.summary} />
            </div>

            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Exported {formatWhen(pending.summary.exportedAt)} ·{" "}
              {formatBytes(pending.summary.bytes)} · format v{pending.summary.version}
              {pending.summary.appVersion ? ` · app ${pending.summary.appVersion}` : ""}
            </p>

            {pending.summary.repairs.length > 0 && (
              <div className="rounded-xl border border-signal/30 bg-signal-soft/40 px-3.5 py-3">
                <p className="text-[12.5px] font-medium text-foreground">
                  A few things were tidied up on the way in
                </p>
                <ul className="mt-1 list-inside list-disc space-y-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                  {pending.summary.repairs.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
              <HardDriveDownload className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>
                A safety copy of your current data will be saved first, so this can be undone.
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-0.5">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === "import"}
                onClick={() => setPending(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={busy === "import"}
                onClick={() => void onConfirmImport()}
              >
                {busy === "import" ? "Restoring…" : "Restore Backup"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
