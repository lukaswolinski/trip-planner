'use client';

import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A confirmation dialog for irreversible actions.
 *
 * Cancel is deliberately the default: it receives focus on open, Escape and a
 * backdrop click both cancel, and confirming requires an explicit click on the
 * confirm button. That way pressing Enter or Escape reflexively can never delete
 * anything — the safe outcome is the one you get by accident.
 *
 * Used instead of `window.confirm()` so the message can name the thing being
 * deleted, and because native dialogs cannot be styled or reliably tested.
 */
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    // Remember what had focus so it can be restored on close — otherwise focus
    // jumps to the top of the page for keyboard and screen-reader users.
    restoreFocusTo.current = document.activeElement;
    cancelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      if (restoreFocusTo.current instanceof HTMLElement) {
        restoreFocusTo.current.focus();
      }
    };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-inset p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? 'confirm-message' : undefined}
        className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        {message ? (
          <p
            id="confirm-message"
            className="mt-1.5 text-sm text-ink-muted"
          >
            {message}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-control border border-line px-3 py-1.5 text-sm font-medium hover:bg-inset"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-control px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-60 ${
              destructive
                ? 'bg-danger hover:opacity-90'
                : 'bg-accent hover:bg-accent-hover'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
