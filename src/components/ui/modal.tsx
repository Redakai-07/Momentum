"use client";

import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { topModalId } from "@/lib/modal-stack";

let bodyScrollLocks = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (bodyScrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLocks += 1;
}

function unlockBodyScroll() {
  bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
  if (bodyScrollLocks === 0) {
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = "";
  }
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  className,
  labelledBy,
  stackId,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  /**
   * This modal's entry id in the modal stack (see `useModalStack`). When set,
   * Escape only closes the modal if it is the topmost layer, so a full-screen
   * mode opened over it takes the first press on its own.
   */
  stackId?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the layer the user is looking at responds to Escape.
      const top = topModalId();
      if (stackId && top && top !== stackId) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, stackId]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="anim-fade-in absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? title ? titleId : undefined}
        className={cn(
          "anim-pop-in relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden",
          "rounded-t-2xl border bg-background shadow-lift sm:max-w-lg sm:rounded-2xl",
          className,
        )}
      >
        {(title || eyebrow) && (
          <div className="flex items-start justify-between gap-4 border-b px-5 pb-3.5 pt-4 sm:px-6">
            <div>
              {eyebrow && (
                <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {eyebrow}
                </p>
              )}
              {title && (
                <h2
                  id={titleId}
                  className="text-[17px] font-semibold tracking-tight text-foreground"
                >
                  {title}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
