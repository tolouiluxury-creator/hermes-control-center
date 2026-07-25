import { Activity, Bot, Gauge } from 'lucide-react';
import type { DashboardLayout, WidgetDefinition } from './types';
import { SystemPerformanceWidget } from './SystemPerformanceWidget';
import { MissionStatusWidget } from './MissionStatusWidget';
import { AgentWidget } from './AgentWidget';

/**
 * Every widget the dashboard can show.
 *
 * Ids are permanent: they are written into saved layouts, so renaming one would
 * silently drop it from every existing dashboard. Titles are free to change.
 */
export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'system-performance',
    title: 'System Performance',
    description: 'CPU, RAM und Speicherplatz deines Servers mit Verlauf.',
    icon: Gauge,
    category: 'System',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    component: SystemPerformanceWidget,
  },
  {
    id: 'mission-status',
    title: 'Mission Status',
    description: 'Erreichbarkeit der Hermes-Dienste und Zustand aller Komponenten.',
    icon: Activity,
    category: 'Betrieb',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    component: MissionStatusWidget,
  },
  {
    id: 'agent',
    title: 'Agent',
    description: 'Version, Gateway-Zustand, Sitzungen und Profile.',
    icon: Bot,
    category: 'Agent',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    component: AgentWidget,
  },
];

const BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

export function widgetById(id: string): WidgetDefinition | undefined {
  return BY_ID.get(id);
}

/** Shown on a dashboard that has never been arranged. */
export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    { i: 'system-performance-1', widget: 'system-performance', x: 0, y: 0, w: 6, h: 4 },
    { i: 'mission-status-1', widget: 'mission-status', x: 6, y: 0, w: 6, h: 4 },
    { i: 'agent-1', widget: 'agent', x: 0, y: 4, w: 4, h: 4 },
  ],
};

/**
 * Drops placements the current build cannot render.
 *
 * A layout outlives the code that wrote it: widgets get removed, and a layout
 * saved by a newer version may name widgets this one has never heard of.
 * Rendering nothing for those is right; crashing the dashboard is not.
 */
export function sanitizeLayout(layout: DashboardLayout | null): {
  layout: DashboardLayout;
  dropped: string[];
} {
  if (!layout) return { layout: DEFAULT_LAYOUT, dropped: [] };

  const dropped: string[] = [];
  const seen = new Set<string>();
  const widgets = layout.widgets.filter((placement) => {
    if (!widgetById(placement.widget)) {
      dropped.push(placement.widget);
      return false;
    }
    if (seen.has(placement.i)) return false;
    seen.add(placement.i);
    return true;
  });

  return { layout: { version: 1, widgets }, dropped };
}

export function nextInstanceId(widgetId: string, existing: readonly { i: string }[]): string {
  let counter = 1;
  let candidate = `${widgetId}-${counter}`;
  const taken = new Set(existing.map((placement) => placement.i));
  while (taken.has(candidate)) {
    counter += 1;
    candidate = `${widgetId}-${counter}`;
  }
  return candidate;
}
