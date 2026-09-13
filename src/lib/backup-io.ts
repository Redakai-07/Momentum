import { nativeAvailable } from "./notifications/service";

/**
 * Backup file input/output.
 *
 * Kept separate from lib/backup.ts so the format stays pure and testable: this
 * file is the only place that touches the browser or Capacitor. Both paths are
 * deliberately user-mediated — Momentum never uploads a backup anywhere, and
 * the only copies that exist are the ones the user chose to save.
 */

/** Refuse absurd files before reading them into the WebView's memory. */
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;

export type SaveDestination = "shared" | "downloaded" | "written";

export interface SaveOutcome {
  ok: boolean;
  destination?: SaveDestination;
  /** Native file URI when the file was written to the device. */
  uri?: string;
  error?: string;
}

/**
 * Hand a backup file to the user.
 *
 * - **Android/iOS** — write the JSON into the app's cache and open the system
 *   share sheet, so it can be saved to Files, Drive, emailed, sent to a PC, or
 *   anything else Android offers. This is a user-controlled file export only;
 *   there is no cloud sync and no network call.
 * - **Web/PWA** — a normal browser download.
 */
export async function saveBackup(json: string, filename: string): Promise<SaveOutcome> {
  if (nativeAvailable()) return saveNative(json, filename);
  return saveWeb(json, filename);
}

async function saveNative(json: string, filename: string): Promise<SaveOutcome> {
  try {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");

    const written = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });

    try {
      const canShare = await Share.canShare();
      if (canShare.value) {
        await Share.share({
          title: filename,
          // `files` is what makes Android attach the document itself rather
          // than a text blob, so the JSON can actually be saved.
          files: [written.uri],
          dialogTitle: "Save your Momentum backup",
        });
        return { ok: true, destination: "shared", uri: written.uri };
      }
    } catch {
      // Sharing declined or unavailable — the file is still on disk.
    }
    return { ok: true, destination: "written", uri: written.uri };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not write the backup file.",
    };
  }
}

function saveWeb(json: string, filename: string): SaveOutcome {
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke late: some browsers read the blob after the click resolves.
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
    return { ok: true, destination: "downloaded" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start the download.",
    };
  }
}

export type ReadOutcome = { ok: true; text: string } | { ok: false; error: string };

/**
 * Read a user-picked file as text.
 *
 * Uses the standard `<input type="file">` element, which Capacitor's Android
 * WebView turns into the normal system file picker — so import needs no extra
 * plugin and picks up the same Files/Drive providers as any other app.
 */
export async function readBackupFile(file: File): Promise<ReadOutcome> {
  if (file.size > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      error: `That file is ${Math.round(file.size / (1024 * 1024))} MB, which is too large to be a Momentum backup.`,
    };
  }
  try {
    const text = await file.text();
    if (!text.trim()) return { ok: false, error: "That file is empty." };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "That file couldn't be read." };
  }
}

/** Human-readable file size for the backup UI. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
