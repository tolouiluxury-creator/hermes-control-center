import { Component, useId, type ErrorInfo, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  GripVertical,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useI18n, type TFunction } from '@/lib/i18n';
import type { WidgetDefinition } from './types';

/**
 * Keeps one failing widget from taking the dashboard with it.
 *
 * A widget renders data from an agent we do not control; a shape we did not
 * anticipate must degrade to a single broken card, not a blank page.
 */
class WidgetErrorBoundary extends Component<
  // A class cannot call useI18n, so the translator comes down as a prop.
  { title: string; t: TFunction; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Widget "${this.props.title}" failed`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <TriangleAlert size={18} className="text-[var(--color-warn)]" aria-hidden />
        <p className="text-sm font-medium">{this.props.t('widget.failed')}</p>
        <p className="text-xs break-words text-[var(--color-ink-faint)]">
          {this.state.error.message}
        </p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-1 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs transition-colors hover:border-[var(--color-hairline-strong)]"
        >
          {this.props.t('common.retry')}
        </button>
      </div>
    );
  }
}

export type MoveDirection = 'up' | 'down' | 'left' | 'right';

export function WidgetFrame({
  definition,
  editing,
  menuOpen,
  onToggleMenu,
  onRemove,
  onMove,
}: {
  definition: WidgetDefinition;
  editing: boolean;
  /** Owned by the grid so only one widget menu can be open at a time. */
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
  onRemove: () => void;
  onMove: (direction: MoveDirection) => void;
}) {
  const { t } = useI18n();
  const menuId = useId();
  const Icon = definition.icon;
  const Body = definition.component;
  const title = t(definition.titleKey);

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--color-hairline)] px-3.5 py-2.5">
        {editing && (
          // The handle is the only draggable part, so text inside a widget stays
          // selectable and its buttons stay clickable while arranging.
          <span
            className="widget-drag-handle -ml-1 cursor-grab text-[var(--color-ink-faint)] active:cursor-grabbing"
            aria-hidden
          >
            <GripVertical size={14} />
          </span>
        )}

        <Icon size={14} className="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
        <h2 className="truncate text-sm font-medium">{title}</h2>

        {editing && (
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => onToggleMenu(!menuOpen)}
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={t('widget.options', { name: title })}
              className="rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>

            {menuOpen && (
              <div
                id={menuId}
                role="menu"
                className="card absolute right-0 z-10 mt-1 w-44 p-1"
                style={{ boxShadow: 'var(--shadow-overlay)' }}
                // Closes on Escape and when focus leaves, so a menu cannot be
                // left hanging over a widget the user has moved on from.
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onToggleMenu(false);
                  }
                }}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    onToggleMenu(false);
                  }
                }}
              >
                {/*
                 * Dragging is a pointer gesture; these give the same power to a
                 * keyboard, which is the only way this dashboard is arrangeable
                 * without a mouse.
                 */}
                {(
                  [
                    ['up', 'widget.move.up', ArrowUp],
                    ['down', 'widget.move.down', ArrowDown],
                    ['left', 'widget.move.left', ArrowLeft],
                    ['right', 'widget.move.right', ArrowRight],
                  ] as const
                ).map(([direction, labelKey, DirectionIcon]) => (
                  <button
                    key={direction}
                    type="button"
                    role="menuitem"
                    onClick={() => onMove(direction)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]"
                  >
                    <DirectionIcon size={13} aria-hidden />
                    {t(labelKey)}
                  </button>
                ))}

                <hr className="my-1 border-[var(--color-hairline)]" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleMenu(false);
                    onRemove();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/10"
                >
                  <Trash2 size={13} aria-hidden />
                  {t('common.remove')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        <WidgetErrorBoundary title={title} t={t}>
          <Body />
        </WidgetErrorBoundary>
      </div>
    </div>
  );
}
