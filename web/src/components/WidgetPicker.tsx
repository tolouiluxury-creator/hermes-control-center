import { useLayoutEffect, useRef } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { WIDGETS } from '@/widgets/registry';
import type { DashboardLayout, WidgetDefinition } from '@/widgets/types';

/**
 * Adds a widget to the dashboard. Widgets already present stay listed rather
 * than disappearing — several copies are legitimate, and a list that reshuffles
 * as you use it is hard to aim at.
 */
export function WidgetPicker({
  layout,
  onAdd,
  onClose,
}: {
  layout: DashboardLayout;
  onAdd: (definition: WidgetDefinition) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const previouslyFocused = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  const counts = new Map<string, number>();
  for (const placement of layout.widgets) {
    counts.set(placement.widget, (counts.get(placement.widget) ?? 0) + 1);
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    // Focus trap: cycle within the dialog rather than escaping to the page.
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
    if (!focusable || focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 px-4 pt-[10vh] backdrop-blur-sm"
      style={{ zIndex: 'var(--z-overlay)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-picker-title"
        className="card w-full max-w-lg overflow-hidden p-0"
        style={{
          boxShadow: 'var(--shadow-overlay)',
          animation: 'overlay-in var(--duration-fast) var(--ease-ui)',
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--color-hairline)] px-4 py-3">
          <h2 id="widget-picker-title" className="text-sm font-semibold">
            Widget hinzufügen
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            aria-label="Schließen"
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        <ul className="max-h-[min(28rem,60vh)] overflow-y-auto p-2">
          {WIDGETS.map((definition) => {
            const Icon = definition.icon;
            const count = counts.get(definition.id) ?? 0;

            return (
              <li key={definition.id}>
                <button
                  type="button"
                  onClick={() => onAdd(definition)}
                  className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-raised)]"
                >
                  <span
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--color-raised)] text-[var(--color-ink-muted)]"
                    aria-hidden
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {definition.title}
                      {count > 0 && (
                        <span className="inline-flex items-center gap-1 text-[0.65rem] text-[var(--color-accent)]">
                          <Check size={11} aria-hidden />
                          {count}× auf dem Dashboard
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                      {definition.description}
                    </span>
                  </span>
                  <Plus
                    size={15}
                    className="mt-1 shrink-0 text-[var(--color-ink-faint)]"
                    aria-hidden
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
