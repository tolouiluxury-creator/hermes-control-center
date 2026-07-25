import { Activity, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getStatus, queryKeys } from '@/lib/api';
import { formatBytes, formatDuration, formatLatency, formatPercent } from '@/lib/format';
import { useStatus } from '@/lib/useStatus';
import { SetupScreen } from '@/components/SetupScreen';
import { Skeleton } from '@/components/Skeleton';

function Metric({
  icon,
  label,
  value,
  hint,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
        <span aria-hidden>{icon}</span>
        {label}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <div className="mt-2 font-mono text-xl tracking-tight">{value}</div>
      )}
      {hint && !loading && <div className="mt-1 text-xs text-[var(--color-ink-faint)]">{hint}</div>}
    </div>
  );
}

function UpstreamRow({
  name,
  url,
  reachable,
  latencyMs,
  message,
}: {
  name: string;
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  message: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[var(--color-hairline)] py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span
            className={`size-2 rounded-full ${reachable ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-danger)]'}`}
            aria-hidden
          />
          {name}
          <span className="sr-only">{reachable ? 'erreichbar' : 'nicht erreichbar'}</span>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-[var(--color-ink-faint)]">{url}</div>
        {!reachable && message && (
          <div className="mt-1 text-xs text-[var(--color-danger)]">{message}</div>
        )}
      </div>
      <div className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
        {formatLatency(latencyMs)}
      </div>
    </div>
  );
}

/**
 * Interim dashboard: the verified status view from M1. The drag-and-drop widget
 * grid replaces this in M3, and the widgets themselves arrive in M4.
 */
export function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: snapshot, isPending, isError, error, isFetching } = useStatus();

  const retry = (): void => {
    void queryClient.fetchQuery({ queryKey: queryKeys.status, queryFn: () => getStatus(true) });
  };

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          Backend nicht erreichbar: {error.message}
        </p>
      </div>
    );
  }

  if (isPending || !snapshot) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (snapshot.setupRequired) {
    return <SetupScreen snapshot={snapshot} onRetry={retry} retrying={isFetching} />;
  }

  const host = snapshot.host;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          icon={<Cpu size={13} />}
          label="CPU"
          value={formatPercent(host?.cpuPercent)}
          hint={host?.cpuCount ? `${host.cpuCount} Kerne` : undefined}
        />
        <Metric
          icon={<MemoryStick size={13} />}
          label="RAM"
          value={formatPercent(host?.memoryPercent)}
          hint={
            host?.memoryTotalBytes
              ? `${formatBytes(host.memoryUsedBytes)} / ${formatBytes(host.memoryTotalBytes)}`
              : undefined
          }
        />
        <Metric
          icon={<HardDrive size={13} />}
          label="Disk"
          value={formatPercent(host?.diskPercent)}
          hint={host?.diskTotalBytes ? formatBytes(host.diskTotalBytes) : undefined}
        />
        <Metric
          icon={<Activity size={13} />}
          label="Uptime"
          value={formatDuration(host?.uptimeSeconds)}
        />
      </section>

      <section className="card mt-4 p-5">
        <h2 className="mb-2 text-sm font-semibold">Upstreams</h2>
        <UpstreamRow
          name="API-Server"
          url={snapshot.apiServer.url}
          reachable={snapshot.apiServer.reachable}
          latencyMs={snapshot.apiServer.latencyMs}
          message={snapshot.apiServer.message}
        />
        <UpstreamRow
          name="Dashboard"
          url={snapshot.dashboard.url}
          reachable={snapshot.dashboard.reachable}
          latencyMs={snapshot.dashboard.latencyMs}
          message={snapshot.dashboard.message}
        />
      </section>

      {snapshot.readiness.length > 0 && (
        <section className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold">Readiness</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {snapshot.readiness.map((check) => (
              <li key={check.name} className="flex items-center gap-2 text-sm">
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    check.ok === true
                      ? 'bg-[var(--color-ok)]'
                      : check.ok === false
                        ? 'bg-[var(--color-danger)]'
                        : 'bg-[var(--color-warn)]'
                  }`}
                  aria-hidden
                />
                <span className="truncate">{check.name}</span>
                {check.detail && check.detail !== 'ok' && (
                  <span className="truncate text-xs text-[var(--color-ink-faint)]">
                    {check.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
