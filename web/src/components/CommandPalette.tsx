import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { CornerDownLeft, LogOut, Moon, RefreshCw, Search } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { NAV_ITEMS } from '@/lib/nav';
import { scoreCommand } from '@/lib/search';
import { useTheme } from '@/lib/theme';
import { logout, queryKeys } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { LucideIcon } from 'lucide-react';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  keywords: string[];
  run: () => void | Promise<void>;
}

/**
 * Mounted only while open, so every opening starts from a clean state and the
 * focus move is an ordinary mount effect rather than a reset dance.
 */
function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { cycle } = useTheme();
  const { t } = useI18n();

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const commands = useMemo<Command[]>(() => {
    // Keywords live in the dictionary as one space-separated string per entry,
    // so each language can bring the words its speakers would actually type.
    const words = (key: string): string[] => t(key).split(/\s+/).filter(Boolean);

    const navigation: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav:${item.id}`,
      label: t(`nav.${item.id}`),
      group: t('palette.navigation'),
      icon: item.icon,
      keywords: words(`navKeywords.${item.id}`),
      run: () => navigate(item.path),
    }));

    const actions: Command[] = [
      {
        id: 'action:theme',
        label: t('palette.switchTheme'),
        group: t('palette.actions'),
        icon: Moon,
        keywords: words('palette.switchTheme.keywords'),
        run: cycle,
      },
      {
        id: 'action:refresh',
        label: t('palette.reloadData'),
        group: t('palette.actions'),
        icon: RefreshCw,
        keywords: words('palette.reloadData.keywords'),
        run: () => void queryClient.invalidateQueries(),
      },
      {
        id: 'action:logout',
        label: t('palette.signOut'),
        group: t('palette.actions'),
        icon: LogOut,
        keywords: words('palette.signOut.keywords'),
        run: async () => {
          await logout();
          await queryClient.invalidateQueries({ queryKey: queryKeys.auth });
        },
      },
    ];

    return [...navigation, ...actions];
  }, [navigate, cycle, queryClient, t]);

  const results = useMemo(
    () =>
      commands
        .map((command) => ({
          command,
          score: scoreCommand(query, command.label, command.keywords),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.command),
    [commands, query],
  );

  // Clamped rather than reset in an effect: a shrinking result list must never
  // leave the highlight pointing past the end.
  const active = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);

  useLayoutEffect(() => {
    // Focus before paint. A requestAnimationFrame is a frame too late: a
    // pointer-driven open lets the click settle focus back onto the trigger,
    // and the keystrokes that follow go to the page instead of the palette.
    const previouslyFocused = document.activeElement;
    inputRef.current?.focus();

    return () => {
      // Closing returns focus where it came from rather than dumping the user
      // at the top of the document.
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  useLayoutEffect(() => {
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  const runCommand = useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      onClose();
      void command.run();
    },
    [onClose],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const last = Math.max(0, results.length - 1);

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(results.length === 0 ? 0 : (active + 1) % results.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(results.length === 0 ? 0 : (active - 1 + results.length) % results.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(last);
        break;
      case 'Enter':
        event.preventDefault();
        runCommand(results[active]);
        break;
      case 'Tab':
        // The input is the only focusable element in here, so holding focus is
        // the whole trap: Tab must not wander onto the page behind the dialog.
        event.preventDefault();
        inputRef.current?.focus();
        break;
      default:
        break;
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-sm"
      style={{ zIndex: 'var(--z-overlay)' }}
      onMouseDown={(event) => {
        // Only a press on the backdrop itself closes; a drag from inside must not.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="card w-full max-w-xl overflow-hidden p-0"
        style={{
          boxShadow: 'var(--shadow-overlay)',
          animation: 'overlay-in var(--duration-fast) var(--ease-ui)',
        }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-hairline)] px-4">
          <Search size={16} className="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={t('palette.placeholder')}
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={results.length > 0 ? optionId(active) : undefined}
            aria-label={t('palette.searchLabel')}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="shrink-0 rounded border border-[var(--color-hairline)] px-1.5 py-0.5 font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
            Esc
          </kbd>
        </div>

        {results.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
            {t('palette.noResults', { query })}
          </p>
        ) : (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={t('palette.results')}
            className="max-h-[min(24rem,50vh)] overflow-y-auto p-2"
          >
            {results.map((command, index) => {
              const isActive = index === active;
              // Derived from the neighbour rather than a mutable cursor, so the
              // markup stays a pure function of the results.
              const startsGroup = index === 0 || results[index - 1]?.group !== command.group;
              const Icon = command.icon;

              return (
                <li key={command.id}>
                  {startsGroup && (
                    <p
                      className="px-2 pt-2 pb-1 text-[0.65rem] tracking-widest text-[var(--color-ink-faint)] uppercase"
                      aria-hidden
                    >
                      {command.group}
                    </p>
                  )}
                  <div
                    id={optionId(index)}
                    role="option"
                    aria-selected={isActive}
                    onMouseMove={() => setActiveIndex(index)}
                    onClick={() => runCommand(command)}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm ${
                      isActive
                        ? 'bg-[var(--color-accent-soft)]/40 text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-muted)]'
                    }`}
                  >
                    <Icon size={16} className="shrink-0" aria-hidden />
                    <span className="truncate">{command.label}</span>
                    {isActive && (
                      <CornerDownLeft
                        size={13}
                        className="ml-auto shrink-0 opacity-60"
                        aria-hidden
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <PaletteDialog onClose={onClose} /> : null;
}
