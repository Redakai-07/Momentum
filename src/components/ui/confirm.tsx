"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * A small destructive-action confirmation.
 *
 * Deliberately a single reusable component rather than inline `confirm()`
 * calls: `window.confirm` is unreliable inside Capacitor's WebView (native
 * dialogs must come from the App plugin) and it cannot be themed.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="sm:max-w-sm">
      {body && <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          size="sm"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
