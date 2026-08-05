import { Languages, Menu, Monitor, Moon, Search, Sun, Wifi, WifiOff } from 'lucide-react';
import { useLocation } from 'react-router';
import { navItemByPath } from '@/lib/nav';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { LANGUAGES, useI18n, type Lang } from '@/lib/i18n';
import { useStatus } from '@/lib/useStatus';
import { ChipMenu } from '@/components/ChipMenu';
import type { StreamState } from '@/lib/stream';

const THEME_LABEL_KEY: Record<ThemePreference, string> = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system',
};

const THEME_ICON = { dark: Moon, light: Sun, system: Monitor } as const;

/** Shows whether live data is actually arriving, not merely that a page loaded. */
function ConnectionPill({ streamState }: { streamState: StreamState }) {
  const { t } = useI18n();
  const { data: snapshot } = useStatus();

  const upstreamsOk = snapshot ? snapshot.dashboard.reachable : false;
  const live = streamState === 'open' && upstreamsOk;

  const label = live
    ? t('shell.live')
    : streamState === 'connecting'
      ? t('shell.connecting')
      : upstreamsOk
        ? t('shell.noLiveConnection')
        : t('shell.hermesUnreachable');

  const color = live
    ? 'var(--color-ok)'
    : streamState === 'connecting'
      ? 'var(--color-warn)'
      : 'var(--color-danger)';

  return (
    <span
      role="status"
      className="hidden items-center gap-2 rounded-full border border-[var(--color-hairline)] px-2.5 py-1 text-xs sm:inline-flex"
      style={{ color }}
    >
      {live ? <Wifi size={13} aria-hidden /> : <WifiOff size={13} aria-hidden />}
      {label}
    </span>
  );
}

/** Quick language switch — the only other way there was Settings, several clicks away. */
function LanguagePicker() {
  const { t, lang, setLang } = useI18n();
  const current = LANGUAGES.find((entry) => entry.id === lang);
  return (
    <ChipMenu
      icon={<Languages size={13} />}
      label={lang.toUpperCase()}
      title={t('shell.language', { lang: current?.endonym ?? lang })}
      options={LANGUAGES.map((entry) => ({ value: entry.id, label: entry.endonym }))}
      value={lang}
      onChange={(value) => setLang(value as Lang)}
    />
  );
}

export function Topbar({
  streamState,
  onOpenSidebar,
  onOpenPalette,
}: {
  streamState: StreamState;
  onOpenSidebar: () => void;
  onOpenPalette: () => void;
}) {
  const { preference, cycle } = useTheme();
  const { t } = useI18n();
  const location = useLocation();
  const current = navItemByPath(location.pathname);
  const ThemeIcon = THEME_ICON[preference];

  return (
    <header
      className="sticky top-0 flex items-center gap-3 border-b border-[var(--color-hairline)] bg-[var(--glass-bg)] px-4 backdrop-blur-[var(--glass-blur)]"
      style={{ height: 'var(--topbar-height)', zIndex: 'var(--z-topbar)' }}
    >
      <button
        type="button"
        onClick={onOpenSidebar}
        className="-ml-1 rounded-lg p-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] lg:hidden"
        aria-label={t('shell.openNavigation')}
      >
        <Menu size={18} aria-hidden />
      </button>

      <h1 className="truncate text-sm font-semibold tracking-tight">
        {current ? t(`nav.${current.id}`) : 'Hermes Control Center'}
      </h1>

      {/* The search field is a button: typing happens in the palette, and this
          keeps one search implementation instead of two. */}
      <button
        type="button"
        onClick={onOpenPalette}
        className="ml-auto flex max-w-md flex-1 items-center gap-2 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 text-left text-sm text-[var(--color-ink-faint)] transition-colors hover:border-[var(--color-hairline-strong)]"
      >
        <Search size={15} aria-hidden />
        <span className="truncate">{t('shell.searchOrJump')}</span>
        <kbd className="ml-auto hidden shrink-0 rounded border border-[var(--color-hairline)] px-1.5 py-0.5 font-mono text-[0.65rem] text-[var(--color-ink-faint)] sm:block">
          {t('shell.shortcutHint')}
        </kbd>
      </button>

      <ConnectionPill streamState={streamState} />

      <LanguagePicker />

      <button
        type="button"
        onClick={cycle}
        className="rounded-lg p-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        aria-label={t('shell.themeToggleAria', { theme: t(THEME_LABEL_KEY[preference]) })}
        title={t('shell.theme', { theme: t(THEME_LABEL_KEY[preference]) })}
      >
        <ThemeIcon size={17} aria-hidden />
      </button>
    </header>
  );
}
