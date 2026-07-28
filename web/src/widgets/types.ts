import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface WidgetSize {
  w: number;
  h: number;
}

export interface WidgetDefinition {
  /** Stable across versions: it is written into the saved layout. */
  id: string;
  /** Dictionary keys — the definitions live outside React and cannot call t(). */
  titleKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  category: 'system' | 'agent' | 'ops' | 'knowledge';
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  component: ComponentType;
  /** False while a widget cannot work — e.g. it needs the API server. */
  available?: (context: { apiServerReachable: boolean }) => boolean;
}

/** One widget placed on the grid. `i` identifies the instance, `widget` the type. */
export interface WidgetPlacement {
  i: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardLayout {
  version: 1;
  widgets: WidgetPlacement[];
}

export const GRID_COLUMNS = 12;
