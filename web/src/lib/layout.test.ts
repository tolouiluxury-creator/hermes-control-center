import { describe, expect, it } from 'vitest';
import {
  addWidget,
  bottomOf,
  clampPlacement,
  layoutsEqual,
  moveWidget,
  removeWidget,
} from './layout';
import { DEFAULT_LAYOUT, nextInstanceId, sanitizeLayout, widgetById } from '@/widgets/registry';
import type { DashboardLayout, WidgetPlacement } from '@/widgets/types';

const place = (overrides: Partial<WidgetPlacement> = {}): WidgetPlacement => ({
  i: 'agent-1',
  widget: 'agent',
  x: 0,
  y: 0,
  w: 4,
  h: 4,
  ...overrides,
});

const layoutOf = (...widgets: WidgetPlacement[]): DashboardLayout => ({ version: 1, widgets });

describe('clampPlacement', () => {
  it('keeps a widget inside the twelve-column grid', () => {
    expect(clampPlacement(place({ x: 10, w: 6 })).x).toBe(6);
    expect(clampPlacement(place({ x: -3 })).x).toBe(0);
    expect(clampPlacement(place({ w: 20 })).w).toBe(12);
  });

  it('respects the widget type minimum size', () => {
    const min = widgetById('agent')?.minSize ?? { w: 1, h: 1 };
    const clamped = clampPlacement(place({ w: 1, h: 1 }));
    expect(clamped.w).toBe(min.w);
    expect(clamped.h).toBe(min.h);
  });

  it('rounds fractional geometry a drag can produce', () => {
    const clamped = clampPlacement(place({ x: 2.6, y: 3.2, w: 4.4, h: 4.5 }));
    expect(Number.isInteger(clamped.x)).toBe(true);
    expect(Number.isInteger(clamped.y)).toBe(true);
  });
});

describe('adding and removing', () => {
  it('places a new widget below everything else', () => {
    const layout = layoutOf(place({ i: 'a', y: 0, h: 4 }), place({ i: 'b', y: 4, h: 3 }));
    expect(bottomOf(layout.widgets)).toBe(7);

    const next = addWidget(layout, place({ i: 'c' }));
    expect(next.widgets.at(-1)?.y).toBe(7);
  });

  it('removes only the named instance', () => {
    const layout = layoutOf(place({ i: 'a' }), place({ i: 'b' }));
    expect(removeWidget(layout, 'a').widgets.map((w) => w.i)).toEqual(['b']);
    expect(removeWidget(layout, 'missing').widgets).toHaveLength(2);
  });

  it('generates instance ids that do not collide', () => {
    const existing = [place({ i: 'agent-1' }), place({ i: 'agent-2' })];
    expect(nextInstanceId('agent', existing)).toBe('agent-3');
    expect(nextInstanceId('agent', [])).toBe('agent-1');
  });
});

describe('moveWidget', () => {
  it('steps one column sideways and one widget height vertically', () => {
    const layout = layoutOf(place({ i: 'a', x: 4, y: 4, w: 4, h: 4 }));

    expect(moveWidget(layout, 'a', 'left').widgets[0]?.x).toBe(3);
    expect(moveWidget(layout, 'a', 'right').widgets[0]?.x).toBe(5);
    expect(moveWidget(layout, 'a', 'up').widgets[0]?.y).toBe(0);
    expect(moveWidget(layout, 'a', 'down').widgets[0]?.y).toBe(8);
  });

  it('never pushes a widget out of the grid', () => {
    const atLeft = layoutOf(place({ i: 'a', x: 0, w: 4 }));
    expect(moveWidget(atLeft, 'a', 'left').widgets[0]?.x).toBe(0);

    const atRight = layoutOf(place({ i: 'a', x: 8, w: 4 }));
    expect(moveWidget(atRight, 'a', 'right').widgets[0]?.x).toBe(8);

    const atTop = layoutOf(place({ i: 'a', y: 0 }));
    expect(moveWidget(atTop, 'a', 'up').widgets[0]?.y).toBe(0);
  });

  it('leaves other widgets untouched', () => {
    const layout = layoutOf(place({ i: 'a', x: 0 }), place({ i: 'b', x: 6 }));
    expect(moveWidget(layout, 'a', 'right').widgets[1]).toEqual(layout.widgets[1]);
  });
});

describe('layoutsEqual', () => {
  it('ignores order but notices geometry', () => {
    const a = layoutOf(place({ i: 'a' }), place({ i: 'b', x: 6 }));
    const b = layoutOf(place({ i: 'b', x: 6 }), place({ i: 'a' }));
    expect(layoutsEqual(a, b)).toBe(true);

    const moved = layoutOf(place({ i: 'a', x: 1 }), place({ i: 'b', x: 6 }));
    expect(layoutsEqual(a, moved)).toBe(false);
  });

  it('notices an added or removed widget', () => {
    const a = layoutOf(place({ i: 'a' }));
    expect(layoutsEqual(a, layoutOf(place({ i: 'a' }), place({ i: 'b' })))).toBe(false);
  });
});

describe('sanitizeLayout', () => {
  it('falls back to the default layout when nothing is stored', () => {
    expect(sanitizeLayout(null).layout).toEqual(DEFAULT_LAYOUT);
  });

  /**
   * A layout outlives the build that wrote it. Widgets get renamed or removed,
   * and a layout saved by a newer version can name widgets this build has never
   * heard of — those must vanish quietly, not crash the dashboard.
   */
  it('drops placements for widgets this build does not know', () => {
    const result = sanitizeLayout(
      layoutOf(place({ i: 'a', widget: 'agent' }), place({ i: 'b', widget: 'aus-der-zukunft' })),
    );

    expect(result.layout.widgets.map((w) => w.i)).toEqual(['a']);
    expect(result.dropped).toEqual(['aus-der-zukunft']);
  });

  it('drops duplicate instance ids, which would break React keys', () => {
    const result = sanitizeLayout(layoutOf(place({ i: 'same' }), place({ i: 'same' })));
    expect(result.layout.widgets).toHaveLength(1);
  });

  it('keeps a valid layout untouched', () => {
    expect(sanitizeLayout(DEFAULT_LAYOUT).layout).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout(DEFAULT_LAYOUT).dropped).toEqual([]);
  });
});

describe('default layout', () => {
  it('only references widgets that exist', () => {
    for (const placement of DEFAULT_LAYOUT.widgets) {
      expect(widgetById(placement.widget), placement.widget).toBeDefined();
    }
  });

  it('fits inside the grid', () => {
    for (const placement of DEFAULT_LAYOUT.widgets) {
      expect(placement.x + placement.w).toBeLessThanOrEqual(12);
    }
  });
});
