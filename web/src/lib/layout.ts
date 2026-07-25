import { GRID_COLUMNS, type DashboardLayout, type WidgetPlacement } from '@/widgets/types';
import { widgetById } from '@/widgets/registry';
import type { MoveDirection } from '@/widgets/WidgetFrame';

/**
 * Pure layout arithmetic, kept out of the components so the rules — clamping to
 * the grid, keyboard moves, adding at the bottom — are testable without a DOM.
 */

export function clampPlacement(placement: WidgetPlacement): WidgetPlacement {
  const definition = widgetById(placement.widget);
  const minW = definition?.minSize.w ?? 1;
  const minH = definition?.minSize.h ?? 1;

  const w = Math.min(GRID_COLUMNS, Math.max(minW, Math.round(placement.w)));
  const h = Math.max(minH, Math.round(placement.h));
  // A widget must stay inside the grid even if it was widened at the right edge.
  const x = Math.min(GRID_COLUMNS - w, Math.max(0, Math.round(placement.x)));
  const y = Math.max(0, Math.round(placement.y));

  return { ...placement, x, y, w, h };
}

/** The row below everything currently placed. */
export function bottomOf(widgets: readonly WidgetPlacement[]): number {
  return widgets.reduce((lowest, widget) => Math.max(lowest, widget.y + widget.h), 0);
}

export function addWidget(layout: DashboardLayout, placement: WidgetPlacement): DashboardLayout {
  return {
    version: 1,
    // New widgets land at the bottom, where they cannot displace an arrangement
    // the user has already settled on.
    widgets: [...layout.widgets, clampPlacement({ ...placement, y: bottomOf(layout.widgets) })],
  };
}

export function removeWidget(layout: DashboardLayout, instanceId: string): DashboardLayout {
  return { version: 1, widgets: layout.widgets.filter((widget) => widget.i !== instanceId) };
}

/**
 * Moves one widget by a single grid step.
 *
 * Vertical steps use the widget's own height so a move is visible rather than a
 * nudge, and nothing is pushed out of the grid: a move that would leave the
 * field is ignored instead of silently clamped to the same spot.
 */
export function moveWidget(
  layout: DashboardLayout,
  instanceId: string,
  direction: MoveDirection,
): DashboardLayout {
  const widgets = layout.widgets.map((widget) => {
    if (widget.i !== instanceId) return widget;

    switch (direction) {
      case 'left':
        return { ...widget, x: Math.max(0, widget.x - 1) };
      case 'right':
        return { ...widget, x: Math.min(GRID_COLUMNS - widget.w, widget.x + 1) };
      case 'up':
        return { ...widget, y: Math.max(0, widget.y - widget.h) };
      case 'down':
        return { ...widget, y: widget.y + widget.h };
      default:
        return widget;
    }
  });

  return { version: 1, widgets };
}

/** True when two layouts describe the same arrangement, ignoring order. */
export function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  if (a.widgets.length !== b.widgets.length) return false;

  const key = (placement: WidgetPlacement): string =>
    `${placement.i}:${placement.widget}:${placement.x}:${placement.y}:${placement.w}:${placement.h}`;

  const left = a.widgets.map(key).sort();
  const right = b.widgets.map(key).sort();

  return left.every((entry, index) => entry === right[index]);
}
