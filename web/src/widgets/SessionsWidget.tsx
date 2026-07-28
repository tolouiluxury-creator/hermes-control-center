import { useQuery } from '@tanstack/react-query';
import { getSessions, queryKeys } from '@/lib/api';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { WidgetState } from './WidgetState';

const LIMIT = 12;

/** Each channel gets its own tint so the mix is readable at a glance. */
const SOURCE_COLOR: Record<string, string> = {
  cli: 'var(--color-info)',
  webui: 'var(--color-accent)',
  cron: 'var(--color-agent)',
  telegram: 'var(--color-ok)',
  discord: 'var(--color-agent)',
};

export function SessionsWidget() {
  const { t, lang } = useI18n();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.sessions(LIMIT),
    queryFn: () => getSessions(LIMIT),
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const sessions = data?.sessions ?? [];

  return (
    <WidgetState
      isPending={isPending}
      error={error}
      isEmpty={sessions.length === 0}
      emptyMessage={t('sessionsWidget.empty')}
    >
      <div className="flex h-full flex-col gap-2">
        {data?.total !== null && data?.total !== undefined && (
          <p className="text-[0.7rem] text-[var(--color-ink-faint)]">
            {t('sessionsWidget.total', { count: data.total })}
          </p>
        )}

        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-2 text-xs">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  background: SOURCE_COLOR[session.source ?? ''] ?? 'var(--color-ink-faint)',
                }}
                aria-hidden
              />
              <span className="w-14 shrink-0 truncate text-[var(--color-ink-faint)]">
                {session.source ?? '—'}
              </span>

              {/*
               * Most sessions carry no display name, and the raw id
               * ("20260717_182929_d71e4d") tells a reader nothing. The start
               * time does, so it stands in — with the id kept in the tooltip
               * for anyone who needs to look one up.
               */}
              <span className="min-w-0 flex-1 truncate" title={session.id}>
                {session.title ?? formatDateTime(session.startedAt, lang) ?? session.id}
              </span>

              {session.messages !== null && (
                <span className="shrink-0 font-mono text-[var(--color-ink-faint)]">
                  {session.messages}
                </span>
              )}

              <span className="w-16 shrink-0 text-right text-[var(--color-ink-faint)]">
                {session.startedAt ? formatRelativeTime(session.startedAt, lang) : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </WidgetState>
  );
}
