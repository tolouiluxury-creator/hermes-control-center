import { NavLink } from 'react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { FOOTER_NAV, PRIMARY_NAV, type NavItem } from '@/lib/nav';
import { formatDuration } from '@/lib/format';
import { useStatus } from '@/lib/useStatus';
import { useI18n } from '@/lib/i18n';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawer: closes after a navigation so the content is visible. */
  onNavigate?: () => void;
}

function NavRow({
  item,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const { t } = useI18n();
  const label = t(`nav.${item.id}`);

  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === '/'}
        onClick={onNavigate}
        // aria-current is what actually tells assistive tech where we are; the
        // colour is only the visual echo of it.
        className={({ isActive }) =>
          [
            'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-[var(--duration-fast)]',
            collapsed ? 'justify-center px-0' : '',
            isActive
              ? 'bg-[var(--color-accent-soft)]/40 text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)] hover:text-[var(--color-ink)]',
          ].join(' ')
        }
        title={collapsed ? label : undefined}
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span
                className="absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[var(--color-accent)]"
                aria-hidden
              />
            )}
            <Icon size={17} className="shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{label}</span>}
            {!collapsed && item.badge === 'live' && (
              <span
                className="ml-auto size-1.5 rounded-full bg-[var(--color-accent)]"
                aria-hidden
              />
            )}
          </>
        )}
      </NavLink>
    </li>
  );
}

/** Version, profile and uptime — the three facts worth a permanent corner. */
function SystemInfo({ collapsed }: { collapsed: boolean }) {
  const { t } = useI18n();
  const { data: snapshot } = useStatus();
  const agent = snapshot?.agent;
  const healthy = snapshot?.dashboard.reachable ?? false;
  const connection = healthy ? t('shell.connected') : t('shell.disconnected');

  if (collapsed) {
    return (
      <div className="flex justify-center py-3">
        <span
          className={`size-2 rounded-full ${healthy ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-danger)]'}`}
          title={connection}
          aria-label={connection}
        />
      </div>
    );
  }

  return (
    <div className="card mx-2 mb-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-ink-muted)]">
          {t('shell.system')}
        </span>
        <span
          className={`size-2 rounded-full ${healthy ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-danger)]'}`}
          aria-hidden
        />
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--color-ink-faint)]">Hermes</dt>
          <dd className="font-mono">{agent?.version ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--color-ink-faint)]">{t('shell.profile')}</dt>
          <dd className="truncate font-mono">{agent?.profile ?? agent?.profiles[0] ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-[var(--color-ink-faint)]">{t('agentWidget.uptime')}</dt>
          <dd className="font-mono">{formatDuration(snapshot?.host?.uptimeSeconds)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function Sidebar({ collapsed, onToggleCollapsed, onNavigate }: SidebarProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-full flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <NavLink
        to="/"
        onClick={onNavigate}
        aria-label={t('shell.home')}
        className={`flex items-center gap-2.5 px-4 transition-opacity hover:opacity-80 ${
          collapsed ? 'justify-center px-0' : ''
        }`}
        style={{ height: 'var(--topbar-height)' }}
      >
        <img
          src="/logo.png"
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0"
          aria-hidden
        />
        {!collapsed && (
          <span className="min-w-0">
            <span className="block text-sm leading-tight font-semibold tracking-tight">Hermes</span>
            <span className="block text-[0.65rem] leading-tight tracking-[0.14em] text-[var(--color-ink-faint)] uppercase">
              Control Center
            </span>
          </span>
        )}
      </NavLink>

      <nav
        aria-label={t('shell.mainNavigation')}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <NavRow key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>

        <hr className="my-2 border-[var(--color-hairline)]" />

        <ul className="space-y-0.5">
          {FOOTER_NAV.map((item) => (
            <NavRow key={item.id} item={item} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
        </ul>
      </nav>

      <SystemInfo collapsed={collapsed} />

      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 border-t border-[var(--color-hairline)] px-4 py-3 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        aria-pressed={collapsed}
      >
        {collapsed ? (
          <PanelLeftOpen size={15} aria-hidden />
        ) : (
          <PanelLeftClose size={15} aria-hidden />
        )}
        {!collapsed && <span>{t('shell.collapseSidebar')}</span>}
        <span className="sr-only">
          {collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
        </span>
      </button>
    </div>
  );
}
