import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpCircle,
  ClipboardCopy,
  Languages,
  Menu,
  Monitor,
  Moon,
  Search,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import { navItemByPath } from '@/lib/nav';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { LANGUAGES, useI18n, type Lang } from '@/lib/i18n';
import { useStatus } from '@/lib/useStatus';
import { ChipMenu } from '@/components/ChipMenu';
import { useToast } from '@/components/Toast';
import { getUpdateCheck, queryKeys } from '@/lib/api';
import type { StreamState } from '@/lib/stream';

const UPDATE_COMMAND = 'git pull && npm ci && npm run build';

/** Only ever renders when a real newer release exists — silent otherwise, including on a failed check. */
function UpdateNotice() {
  const { t } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: queryKeys.updateCheck,
    queryFn: getUpdateCheck,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Same close-on-outside-click/Escape behavior as ChipMenu, so opening this
  // doesn't leave two popovers stacked when a language/theme control is also open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!data?.updateAvailable) return null;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(UPDATE_COMMAND);
      toast.push({ tone: 'success', title: t('prompts.copied') });
    } catch {
      toast.push({
        tone: 'error',
        title: t('prompts.copyFailed'),
        description: t('prompts.copyFailedDesc'),
      });
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden items-center gap-1.5 rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 sm:inline-flex"
      >
        <ArrowUpCircle size={13} aria-hidden />
        {t('shell.updateAvailable', { version: data.latestVersion ?? '' })}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-raised)] p-3 text-left shadow-[var(--shadow-card)]">
          <p className="text-xs text-[var(--color-ink-muted)]">{t('shell.updateInstructions')}</p>
          <code className="mt-2 block overflow-x-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 font-mono text-[0.7rem] whitespace-pre">
            {UPDATE_COMMAND}
          </code>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              <ClipboardCopy size={12} aria-hidden />
              {t('shell.copyCommand')}
            </button>
            {data.releaseUrl && (
              <a
                href={data.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[var(--color-accent)] hover:underline"
              >
                {t('shell.viewRelease')}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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

      <UpdateNotice />

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
