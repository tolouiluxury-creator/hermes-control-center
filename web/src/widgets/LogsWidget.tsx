import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search } from 'lucide-react';
import { getLogs, queryKeys } from '@/lib/api';
import type { LogLevel } from '@/lib/hermesTypes';
import { useI18n } from '@/lib/i18n';
import { WidgetState } from './WidgetState';

const LINE_COUNT = 200;

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: 'var(--color-danger)',
  warn: 'var(--color-warn)',
  info: 'var(--color-ink-muted)',
  debug: 'var(--color-ink-faint)',
  plain: 'var(--color-ink-muted)',
};

const FILTERS: { id: 'all' | LogLevel; labelKey: string }[] = [
  { id: 'all', labelKey: 'common.all' },
  { id: 'error', labelKey: 'logs.level.error' },
  { id: 'warn', labelKey: 'logs.level.warn' },
  { id: 'info', labelKey: 'logs.level.info' },
];

/** Live console. Filter, search, highlighted errors and a download. */
export function LogsWidget() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | LogLevel>('all');
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.logs(LINE_COUNT),
    queryFn: () => getLogs(LINE_COUNT),
    refetchInterval: 10_000,
  });

  const lines = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.lines ?? []).filter((line) => {
      if (filter !== 'all' && line.level !== filter) return false;
      return needle === '' || line.text.toLowerCase().includes(needle);
    });
  }, [data, filter, search]);

  const download = (): void => {
    const text = (data?.lines ?? []).map((line) => line.text).join('');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `hermes-${data?.file ?? 'log'}-${new Date().toISOString().slice(0, 10)}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            aria-pressed={filter === entry.id}
            className={`rounded-lg px-2 py-0.5 text-[0.7rem] transition-colors ${
              filter === entry.id
                ? 'bg-[var(--color-accent-soft)]/40 text-[var(--color-accent)]'
                : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]'
            }`}
          >
            {t(entry.labelKey)}
          </button>
        ))}

        <label className="ml-auto flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] px-2 py-1 sm:max-w-[14rem]">
          <Search size={12} className="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('common.search')}
            className="w-full bg-transparent text-[0.7rem] outline-none placeholder:text-[var(--color-ink-faint)]"
            aria-label={t('logs.searchLabel')}
          />
        </label>

        <button
          type="button"
          onClick={download}
          disabled={!data || data.lines.length === 0}
          className="rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
          aria-label={t('logsWidget.downloadAria')}
          title={t('logs.download')}
        >
          <Download size={13} aria-hidden />
        </button>
      </div>

      <WidgetState
        isPending={isPending}
        error={error}
        isEmpty={lines.length === 0}
        emptyMessage={
          data && data.lines.length > 0 ? t('logsWidget.noMatch') : t('logsWidget.empty')
        }
      >
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg bg-[var(--color-base)] p-2 font-mono text-[0.68rem] leading-relaxed"
          // A log is a live region for a sighted reader, but announcing every
          // line would flood a screen reader; it stays readable on demand.
          role="log"
          aria-label={t('logs.file', { file: data?.file ?? '' })}
        >
          {lines.map((line, index) => (
            <div
              key={`${index}-${line.text.slice(0, 24)}`}
              className="break-all whitespace-pre-wrap"
              style={{
                color: LEVEL_COLOR[line.level],
                fontWeight: line.level === 'error' ? 500 : undefined,
              }}
            >
              {line.text.replace(/\n$/, '')}
            </div>
          ))}
        </div>
      </WidgetState>
    </div>
  );
}
