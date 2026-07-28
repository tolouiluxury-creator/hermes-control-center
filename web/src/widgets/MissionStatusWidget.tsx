import { useStatus } from '@/lib/useStatus';
import { formatLatency } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

function StatusDot({ ok }: { ok: boolean | null }) {
  const color =
    ok === true ? 'var(--color-ok)' : ok === false ? 'var(--color-danger)' : 'var(--color-warn)';
  return (
    <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
  );
}

/** Reachability plus the agent's own component health, in one glance. */
export function MissionStatusWidget() {
  const { t } = useI18n();
  const { data: snapshot } = useStatus();

  if (!snapshot) return null;

  const upstreams = [
    {
      name: t('missionWidget.dashboard'),
      ok: snapshot.dashboard.reachable,
      detail: formatLatency(snapshot.dashboard.latencyMs),
    },
    {
      name: t('missionWidget.apiServer'),
      ok: snapshot.apiServer.reachable,
      detail: snapshot.apiServer.reachable
        ? formatLatency(snapshot.apiServer.latencyMs)
        : t('missionWidget.notRunning'),
    },
  ];

  return (
    <div className="grid h-full gap-x-6 gap-y-1.5 overflow-y-auto sm:grid-cols-2">
      {upstreams.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <StatusDot ok={entry.ok} />
          <span className="truncate">{entry.name}</span>
          <span className="ml-auto shrink-0 font-mono text-xs text-[var(--color-ink-faint)]">
            {entry.detail}
          </span>
          <span className="sr-only">
            {entry.ok ? t('label.reachable') : t('label.unreachable')}
          </span>
        </div>
      ))}

      {snapshot.readiness.map((check) => (
        <div key={check.name} className="flex items-center gap-2 text-sm">
          <StatusDot ok={check.ok} />
          <span className="truncate">{check.name}</span>
          {check.detail && check.detail !== 'ok' && (
            <span className="ml-auto truncate text-xs text-[var(--color-ink-faint)]">
              {check.detail}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
