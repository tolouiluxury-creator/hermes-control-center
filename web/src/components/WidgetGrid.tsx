import { useCallback, useMemo, useState } from 'react';
// In this version `Layout` is the array and `LayoutItem` a single placement.
import { Responsive, useContainerWidth, type Layout, type LayoutItem } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { widgetById } from '@/widgets/registry';
import { WidgetFrame, type MoveDirection } from '@/widgets/WidgetFrame';
import { clampPlacement } from '@/lib/layout';
import { GRID_COLUMNS, type DashboardLayout } from '@/widgets/types';

/*
 * Thresholds are measured against the *grid container*, not the window: with the
 * sidebar and page padding, a 1280 px window leaves roughly 1170 px here, so a
 * 1200 px "lg" would mean a normal laptop never sees the full twelve columns.
 */
const BREAKPOINTS = { lg: 1024, md: 768, sm: 512, xs: 0 } as const;
const COLS = { lg: GRID_COLUMNS, md: 8, sm: 4, xs: 1 } as const;
const ROW_HEIGHT = 56;

export function WidgetGrid({
  layout,
  editing,
  onChange,
  onRemove,
  onMove,
}: {
  layout: DashboardLayout;
  editing: boolean;
  onChange: (layout: DashboardLayout) => void;
  onRemove: (instanceId: string) => void;
  onMove: (instanceId: string, direction: MoveDirection) => void;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  // Starts unknown on purpose. Assuming "lg" let the very first layout change —
  // which the grid emits after fitting the widgets to a narrower breakpoint —
  // pass the guard below and overwrite the saved desktop arrangement.
  const [breakpoint, setBreakpoint] = useState<string | null>(null);
  // One open menu at a time: two menus over two widgets is how a click lands on
  // the wrong one.
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const items: LayoutItem[] = useMemo(
    () =>
      layout.widgets.map((placement) => {
        const definition = widgetById(placement.widget);
        return {
          i: placement.i,
          x: placement.x,
          y: placement.y,
          w: placement.w,
          h: placement.h,
          minW: definition?.minSize.w ?? 1,
          minH: definition?.minSize.h ?? 1,
        };
      }),
    [layout],
  );

  const handleLayoutChange = useCallback(
    (current: Layout) => {
      // Only the widest breakpoint is authoritative. Narrower ones are derived
      // by the grid, and saving those would flatten the desktop arrangement
      // just because someone opened the dashboard on a phone.
      if (breakpoint !== 'lg') return;

      const byId = new Map(current.map((item) => [item.i, item]));
      const next: DashboardLayout = {
        version: 1,
        widgets: layout.widgets.map((placement) => {
          const item = byId.get(placement.i);
          return item
            ? clampPlacement({ ...placement, x: item.x, y: item.y, w: item.w, h: item.h })
            : placement;
        }),
      };

      onChange(next);
    },
    [breakpoint, layout.widgets, onChange],
  );

  return (
    <div ref={containerRef}>
      {mounted && (
        <Responsive
          width={width}
          breakpoints={BREAKPOINTS}
          cols={COLS}
          // Only the authoritative layout is supplied; the grid derives the
          // narrower ones itself instead of us storing four arrangements.
          layouts={{ lg: items }}
          rowHeight={ROW_HEIGHT}
          margin={[16, 16]}
          containerPadding={[0, 0]}
          // Only the header grip starts a drag, so text stays selectable and the
          // widget's own buttons keep working while arranging.
          dragConfig={{ enabled: editing, handle: '.widget-drag-handle' }}
          resizeConfig={{ enabled: editing, handles: ['se'] }}
          onBreakpointChange={setBreakpoint}
          onLayoutChange={handleLayoutChange}
        >
          {layout.widgets.map((placement) => {
            const definition = widgetById(placement.widget);
            if (!definition) return null;

            return (
              <div key={placement.i}>
                <WidgetFrame
                  definition={definition}
                  editing={editing}
                  menuOpen={openMenu === placement.i}
                  onToggleMenu={(open) => setOpenMenu(open ? placement.i : null)}
                  onRemove={() => onRemove(placement.i)}
                  onMove={(direction) => onMove(placement.i, direction)}
                />
              </div>
            );
          })}
        </Responsive>
      )}
    </div>
  );
}
