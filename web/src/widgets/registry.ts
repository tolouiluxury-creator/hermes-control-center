import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  CalendarClock,
  Cpu,
  Gauge,
  History,
  Layers,
  Lightbulb,
  ScrollText,
  Server,
} from 'lucide-react';
import type { DashboardLayout, WidgetDefinition } from './types';
import { SystemPerformanceWidget } from './SystemPerformanceWidget';
import { MissionStatusWidget } from './MissionStatusWidget';
import { AgentWidget } from './AgentWidget';
import { LogsWidget } from './LogsWidget';
import { SchedulerWidget } from './SchedulerWidget';
import { SkillsWidget } from './SkillsWidget';
import { McpWidget } from './McpWidget';
import { ModelWidget } from './ModelWidget';
import { AnalyticsWidget } from './AnalyticsWidget';
import { SessionsWidget } from './SessionsWidget';
import { KnowledgeWidget } from './KnowledgeWidget';
import { InsightsWidget } from './InsightsWidget';

/**
 * Every widget the dashboard can show.
 *
 * Ids are permanent: they are written into saved layouts, so renaming one would
 * silently drop it from every existing dashboard. Titles are free to change.
 */
export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'system-performance',
    titleKey: 'widget.systemPerformance.title',
    descriptionKey: 'widget.systemPerformance.desc',
    icon: Gauge,
    category: 'system',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    component: SystemPerformanceWidget,
  },
  {
    id: 'mission-status',
    titleKey: 'widget.missionStatus.title',
    descriptionKey: 'widget.missionStatus.desc',
    icon: Activity,
    category: 'ops',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    component: MissionStatusWidget,
  },
  {
    id: 'agent',
    titleKey: 'widget.agent.title',
    descriptionKey: 'widget.agent.desc',
    icon: Bot,
    category: 'agent',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    component: AgentWidget,
  },
  {
    id: 'logs',
    titleKey: 'widget.logs.title',
    descriptionKey: 'widget.logs.desc',
    icon: ScrollText,
    category: 'ops',
    defaultSize: { w: 8, h: 6 },
    minSize: { w: 4, h: 4 },
    component: LogsWidget,
  },
  {
    id: 'scheduler',
    titleKey: 'widget.scheduler.title',
    descriptionKey: 'widget.scheduler.desc',
    icon: CalendarClock,
    category: 'ops',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    component: SchedulerWidget,
  },
  {
    id: 'skills',
    titleKey: 'widget.skills.title',
    descriptionKey: 'widget.skills.desc',
    icon: Layers,
    category: 'agent',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    component: SkillsWidget,
  },
  {
    id: 'mcp',
    titleKey: 'widget.mcp.title',
    descriptionKey: 'widget.mcp.desc',
    icon: Server,
    category: 'agent',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    component: McpWidget,
  },
  {
    id: 'model',
    titleKey: 'widget.model.title',
    descriptionKey: 'widget.model.desc',
    icon: Cpu,
    category: 'agent',
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 3, h: 3 },
    component: ModelWidget,
  },
  {
    id: 'analytics',
    titleKey: 'widget.analytics.title',
    descriptionKey: 'widget.analytics.desc',
    icon: BarChart3,
    category: 'ops',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 4 },
    component: AnalyticsWidget,
  },
  {
    id: 'sessions',
    titleKey: 'widget.sessions.title',
    descriptionKey: 'widget.sessions.desc',
    icon: History,
    category: 'agent',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    component: SessionsWidget,
  },
  {
    id: 'insights',
    titleKey: 'widget.insights.title',
    descriptionKey: 'widget.insights.desc',
    icon: Lightbulb,
    category: 'ops',
    defaultSize: { w: 6, h: 5 },
    minSize: { w: 4, h: 3 },
    component: InsightsWidget,
  },
  {
    id: 'knowledge',
    titleKey: 'widget.knowledge.title',
    descriptionKey: 'widget.knowledge.desc',
    icon: BookOpen,
    category: 'knowledge',
    defaultSize: { w: 4, h: 4 },
    minSize: { w: 3, h: 3 },
    component: KnowledgeWidget,
  },
];

const BY_ID = new Map(WIDGETS.map((widget) => [widget.id, widget]));

export function widgetById(id: string): WidgetDefinition | undefined {
  return BY_ID.get(id);
}

/**
 * Shown on a dashboard that has never been arranged.
 *
 * Ordered by what someone opening the control center wants first: is it
 * healthy, what is it doing, and what has it been doing.
 */
export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  widgets: [
    { i: 'system-performance-1', widget: 'system-performance', x: 0, y: 0, w: 6, h: 4 },
    { i: 'mission-status-1', widget: 'mission-status', x: 6, y: 0, w: 6, h: 4 },
    { i: 'sessions-1', widget: 'sessions', x: 0, y: 4, w: 6, h: 5 },
    { i: 'analytics-1', widget: 'analytics', x: 6, y: 4, w: 6, h: 5 },
    { i: 'insights-1', widget: 'insights', x: 0, y: 9, w: 6, h: 5 },
    { i: 'logs-1', widget: 'logs', x: 6, y: 9, w: 6, h: 5 },
    { i: 'scheduler-1', widget: 'scheduler', x: 6, y: 14, w: 4, h: 3 },
    { i: 'agent-1', widget: 'agent', x: 10, y: 14, w: 4, h: 3 },
    { i: 'skills-1', widget: 'skills', x: 8, y: 17, w: 4, h: 3 },
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
