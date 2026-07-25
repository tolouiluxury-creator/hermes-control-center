import {
  BarChart3,
  Bot,
  BookOpen,
  Cpu,
  FileText,
  FolderOpen,
  Globe,
  Layers,
  LayoutDashboard,
  Library,
  ListTodo,
  MessagesSquare,
  Plug,
  ScrollText,
  Server,
  Settings,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Extra words the command palette should match on. */
  keywords?: string[];
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
    label: 'Dashboard',
    path: '/',
    icon: LayoutDashboard,
    keywords: ['übersicht', 'start', 'widgets', 'cockpit'],
  },
  {
    id: 'chats',
    label: 'Chats',
    path: '/chats',
    icon: MessagesSquare,
    keywords: ['unterhaltung', 'sessions', 'nachrichten', 'gespräch'],
    badge: 'live',
  },
  {
    id: 'agenten',
    label: 'Agenten',
    path: '/agenten',
    icon: Bot,
    keywords: ['agents', 'assistenten', 'subagenten'],
  },
  {
    id: 'workflows',
    label: 'Workflows',
    path: '/workflows',
    icon: Workflow,
    keywords: ['abläufe', 'automatisierung', 'ketten'],
  },
  {
    id: 'aufgaben',
    label: 'Aufgaben',
    path: '/aufgaben',
    icon: ListTodo,
    keywords: ['tasks', 'runs', 'jobs', 'warteschlange'],
  },
  {
    id: 'wissen',
    label: 'Wissen (RAG)',
    path: '/wissen',
    icon: BookOpen,
    keywords: ['rag', 'memory', 'gedächtnis', 'embeddings', 'vektor'],
  },
  {
    id: 'dokumente',
    label: 'Dokumente',
    path: '/dokumente',
    icon: FileText,
    keywords: ['docs', 'dateien', 'pdf', 'notizen'],
  },
  {
    id: 'skills',
    label: 'Skills',
    path: '/skills',
    icon: Layers,
    keywords: ['fähigkeiten', 'plugins', 'erweiterungen'],
  },
  {
    id: 'mcp',
    label: 'MCP Server',
    path: '/mcp',
    icon: Server,
    keywords: ['model context protocol', 'werkzeuge', 'tools'],
  },
  {
    id: 'modelle',
    label: 'Modelle',
    path: '/modelle',
    icon: Cpu,
    keywords: ['llm', 'provider', 'kosten', 'kontext'],
  },
  {
    id: 'browser',
    label: 'Browser Automation',
    path: '/browser',
    icon: Globe,
    keywords: ['scraping', 'playwright', 'web', 'crawler'],
  },
  {
    id: 'dateien',
    label: 'Dateien',
    path: '/dateien',
    icon: FolderOpen,
    keywords: ['files', 'ordner', 'upload', 'dateisystem'],
  },
  {
    id: 'prompts',
    label: 'Prompt-Bibliothek',
    path: '/prompts',
    icon: Library,
    keywords: ['vorlagen', 'templates', 'systemprompt'],
  },
  {
    id: 'integrationen',
    label: 'API & Integrationen',
    path: '/integrationen',
    icon: Plug,
    keywords: ['api', 'webhooks', 'telegram', 'discord', 'schnittstellen'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    path: '/analytics',
    icon: BarChart3,
    keywords: ['statistik', 'kosten', 'token', 'auswertung', 'nutzung'],
  },
  {
    id: 'logs',
    label: 'Logs',
    path: '/logs',
    icon: ScrollText,
    keywords: ['protokoll', 'fehler', 'konsole', 'ereignisse'],
  },
  {
    id: 'einstellungen',
    label: 'Einstellungen',
    path: '/einstellungen',
    icon: Settings,
    keywords: ['settings', 'konfiguration', 'profil', 'theme', 'passwort'],
  },
];

/** Items rendered below the divider, away from the day-to-day pages. */
export const FOOTER_NAV_IDS = new Set(['einstellungen']);

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
