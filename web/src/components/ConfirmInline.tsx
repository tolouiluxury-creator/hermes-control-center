import type { ReactNode } from 'react';

/**
 * The small confirmation panel that appears in place, where the click was,
 * before a write that changes the running agent. Modelled on the delete
 * confirmation in the prompt library so every destructive or agent-changing
 * action asks the same way, rather than a modal that hides the context.
 */
export function ConfirmInline({
  message,
  confirmLabel,
  cancelLabel = 'Abbrechen',
  tone = 'danger',
  pending = false,
  onConfirm,
  onCancel,
}: {
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger for irreversible/removing actions, warn for merely disruptive ones. */
  tone?: 'danger' | 'warn';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const color = tone === 'danger' ? 'var(--color-danger)' : 'var(--color-warn)';

  return (
    <div
      role="alertdialog"
      aria-label="Bestätigen"
      className="mt-3 flex flex-wrap items-center gap-2 rounded-xl p-3"
      style={{
        border: `1px solid color-mix(in oklab, ${color} 30%, transparent)`,
        background: `color-mix(in oklab, ${color} 5%, transparent)`,
      }}
    >
      <p className="min-w-0 flex-1 text-xs">{message}</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={pending}
        className="rounded-lg px-3 py-1 text-xs disabled:opacity-50"
        style={{ background: `color-mix(in oklab, ${color} 15%, transparent)`, color }}
      >
        {pending ? 'Läuft …' : confirmLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded-lg px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
      >
        {cancelLabel}
      </button>
    </div>
  );
}
