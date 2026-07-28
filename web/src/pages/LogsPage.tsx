import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Pause, Play } from 'lucide-react';
import { getLogs, queryKeys } from '@/lib/api';
import { FilterChips, PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { useI18n } from '@/lib/i18n';
import type { LogLevel } from '@/lib/hermesTypes';

const LEVEL_COLOR: Record<LogLevel, string> = {
  error: 'var(--color-danger)',
  warn: 'var(--color-warn)',
  info: 'var(--color-ink-muted)',
  debug: 'var(--color-ink-faint)',
  plain: 'var(--color-ink-muted)',
};

const LINE_OPTIONS = [100, 300, 1000] as const;

export function LogsPage() {
  const { t, lang } = useI18n();
  const [lines, setLines] = useState<number>(300);
  const [level, setLevel] = useState<'all' | LogLevel>('all');
  const [search, setSearch] = useState('');
  const [following, setFollowing] = useState(true);

  const { data, isPending, error, dataUpdatedAt } = useQuery({
    queryKey: queryKeys.logs(lines),
    queryFn: () => getLogs(lines),
    // Following is a choice: reading a stack trace while the view reloads under
    // you is worse than slightly stale output.
    refetchInterval: following ? 5000 : false,
  });

  const counts = useMemo(() => {
    const result = { error: 0, warn: 0, info: 0, debug: 0, plain: 0 };
    for (const line of data?.lines ?? []) result[line.level] += 1;
    return result;
  }, [data]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.lines ?? []).filter((line) => {
      if (level !== 'all' && line.level !== level) return false;
      return needle === '' || line.text.toLowerCase().includes(needle);
    });
  }, [data, level, search]);

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
    <PageShell
      wide
      title={t('nav.logs')}
      description={data?.file ? t('logs.file', { file: data.file }) : t('page.logs.desc')}
      actions={
        <>
          <SearchField value={search} onChange={setSearch} label={t('logs.searchLabel')} />
          <button
            type="button"
            onClick={() => setFollowing((value) => !value)}
            aria-pressed={following}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm transition-colors ${
              following
                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {following ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
            {following ? t('logs.live') : t('logs.paused')}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!data || data.lines.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
          >
            <Download size={13} aria-hidden />
            {t('logs.download')}
          </button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <FilterChips
          label={t('logs.level')}
          value={level}
          onChange={setLevel}
          options={[
            { id: 'all', label: t('common.all'), count: data?.lines.length ?? 0 },
            { id: 'error', label: t('logs.level.error'), count: counts.error },
            { id: 'warn', label: t('logs.level.warn'), count: counts.warn },
            { id: 'info', label: t('logs.level.info'), count: counts.info },
            { id: 'debug', label: t('logs.level.debug'), count: counts.debug },
          ]}
        />

        <FilterChips
          label={t('logs.lineCount')}
          value={String(lines)}
          onChange={(value) => setLines(Number(value))}
          options={LINE_OPTIONS.map((count) => ({
            id: String(count),
            label: t('logs.lines', { count }),
          }))}
        />

        {dataUpdatedAt > 0 && (
          <span className="ml-auto text-xs text-[var(--color-ink-faint)]" role="status">
            {t('logs.updated', { time: new Date(dataUpdatedAt).toLocaleTimeString(lang) })}
          </span>
        )}
      </div>

      {isPending ? (
        <SkeletonText lines={14} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <div
          className="card overflow-auto p-3 font-mono text-xs leading-relaxed"
          style={{ maxHeight: 'calc(100vh - 19rem)' }}
          role="log"
          aria-label={t('logs.output')}
        >
          {visible.length === 0 ? (
            <p className="py-8 text-center text-[var(--color-ink-faint)]">{t('logs.noMatch')}</p>
          ) : (
            visible.map((line, index) => (
              <div
                key={`${index}-${line.text.slice(0, 32)}`}
                className="break-all whitespace-pre-wrap"
                style={{
                  color: LEVEL_COLOR[line.level],
                  fontWeight: line.level === 'error' ? 500 : undefined,
                }}
              >
                {line.text.replace(/\n$/, '')}
              </div>
            ))
          )}
        </div>
      )}
    </PageShell>
  );
}
