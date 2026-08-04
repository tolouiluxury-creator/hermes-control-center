import {
  BarChart3,
  BookOpen,
  Cpu,
  HandCoins,
  Layers,
  LayoutDashboard,
  Library,
  ListTodo,
  MessagesSquare,
  Plug,
  FolderTree,
  ScrollText,
  Server,
  Send,
  Settings,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  /** Also the dictionary key: the label is `nav.<id>`, the search words `navKeywords.<id>`. */
  id: string;
  path: string;
  icon: LucideIcon;
  /** Shown in the sidebar as a small count or dot when the page has news. */
  badge?: 'live' | null;
}

/**
 * The single source of truth for navigation.
 *
 * The sidebar, the router and the command palette are all generated from this
 * list, which is what guarantees they agree: a page cannot exist without being
 * reachable, and nothing can appear in the sidebar that has no route.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    path: '/',
    icon: LayoutDashboard,
  },
  {
    id: 'chats',
    path: '/chats',
    icon: MessagesSquare,
    badge: 'live',
  },
  {
    id: 'workflows',
    path: '/workflows',
    icon: Workflow,
  },
  {
    id: 'aufgaben',
    path: '/aufgaben',
    icon: ListTodo,
  },
  {
    id: 'wissen',
    path: '/wissen',
    icon: BookOpen,
  },
  {
    id: 'skills',
    path: '/skills',
    icon: Layers,
  },
  {
    id: 'mcp',
    path: '/mcp',
    icon: Server,
  },
  {
    id: 'modelle',
    path: '/modelle',
    icon: Cpu,
  },
  {
    id: 'profile',
    path: '/profile',
    icon: UserRound,
  },
  {
    id: 'prompts',
    path: '/prompts',
    icon: Library,
  },
  {
    id: 'workspace',
    path: '/workspace',
    icon: FolderTree,
  },
  {
    id: 'telegram',
    path: '/telegram',
    icon: Send,
  },
  {
    id: 'integrationen',
    path: '/integrationen',
    icon: Plug,
  },
  {
    id: 'analytics',
    path: '/analytics',
    icon: BarChart3,
  },
  {
    id: 'logs',
    path: '/logs',
    icon: ScrollText,
  },
  {
    id: 'einstellungen',
    path: '/einstellungen',
    icon: Settings,
  },
  {
    id: 'donation',
    path: '/donation',
    icon: HandCoins,
  },
];

/** Items rendered below the divider, away from the day-to-day pages. */
export const FOOTER_NAV_IDS = new Set(['einstellungen', 'donation']);

export const PRIMARY_NAV = NAV_ITEMS.filter((item) => !FOOTER_NAV_IDS.has(item.id));
export const FOOTER_NAV = NAV_ITEMS.filter((item) => FOOTER_NAV_IDS.has(item.id));

export function navItemByPath(pathname: string): NavItem | null {
  // Longest match wins, so /chats/42 still highlights Chats while / does not.
  let best: NavItem | null = null;
  for (const item of NAV_ITEMS) {
    const matches = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
    if (matches && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}
