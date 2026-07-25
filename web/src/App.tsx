import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Cpu, HardDrive, MemoryStick, Wifi, WifiOff } from 'lucide-react';
import { getAuthStatus, getStatus, queryKeys } from '@/lib/api';
import { useControlCenterStream } from '@/lib/stream';
import { formatBytes, formatDuration, formatLatency, formatPercent } from '@/lib/format';
import { LoginScreen } from '@/components/LoginScreen';
import { SetupScreen } from '@/components/SetupScreen';
import type { StatusSnapshot } from '@/lib/types';

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-hairline)] p-4">
      <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
        <span aria-hidden>{icon}</span>
        {label}
      </div>
      <div className="mt-2 font-mono text-xl tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--color-ink-faint)]">{hint}</div>}
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
 * Milestone M1 view: proves the integration layer end to end. Replaced by the
 * widget grid and app shell in M2/M3.
 */
function StatusView({ snapshot, live }: { snapshot: StatusSnapshot; live: boolean }) {
  const host = snapshot.host;

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hermes Control Center</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            Hermes {snapshot.agent?.version ?? 'unbekannt'}
            {snapshot.agent?.profile ? ` · Profil ${snapshot.agent.profile}` : ''}
            {host?.os ? ` · ${host.os}` : ''}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
            live
              ? 'border-[var(--color-ok)]/30 text-[var(--color-ok)]'
              : 'border-[var(--color-warn)]/30 text-[var(--color-warn)]'
          }`}
          role="status"
        >
          {live ? <Wifi size={13} aria-hidden /> : <WifiOff size={13} aria-hidden />}
          {live ? 'Live' : 'Verbindung getrennt'}
        </div>
      </header>

      <section
        className="rounded-2xl border border-[var(--color-hairline)] p-5"
        style={{ background: 'var(--glass-bg)', boxShadow: 'var(--shadow-card)' }}
      >
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

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      {snapshot.readiness.length > 0 && (
        <section
          className="mt-4 rounded-2xl border border-[var(--color-hairline)] p-5"
          style={{ background: 'var(--glass-bg)' }}
        >
          <h2 className="mb-3 text-sm font-semibold">Readiness</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {snapshot.readiness.map((check) => (
              <li key={check.name} className="flex items-center gap-2 text-sm">
                <span
                  className={`size-2 rounded-full ${
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

export default function App() {
  const queryClient = useQueryClient();

  const auth = useQuery({
    queryKey: queryKeys.auth,
    queryFn: getAuthStatus,
    staleTime: 30_000,
  });

  const locked = auth.data?.required === true && !auth.data.authenticated;

  if (auth.isPending) {
    return (
      <main className="grid min-h-full place-items-center">
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">
          Verbinde …
        </p>
      </main>
    );
  }

  if (locked) {
    return (
      <main className="min-h-full">
        <LoginScreen
          onSuccess={() => {
            // Refetch everything: nothing was allowed to load while locked.
            void queryClient.invalidateQueries();
          }}
        />
      </main>
    );
  }

  return <Cockpit />;
}

function Cockpit() {
  const queryClient = useQueryClient();
  const { state, snapshot: streamed } = useControlCenterStream();

  const initial = useQuery({
    queryKey: queryKeys.status,
    queryFn: () => getStatus(),
    // The SSE channel keeps this fresh; this query only seeds the first paint.
    staleTime: Number.POSITIVE_INFINITY,
  });

  const snapshot = streamed ?? initial.data ?? null;

  if (!snapshot) {
    return (
      <main className="grid min-h-full place-items-center">
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">
          {initial.isError ? `Backend nicht erreichbar: ${initial.error.message}` : 'Verbinde …'}
        </p>
      </main>
    );
  }

  const retry = (): void => {
    void queryClient.fetchQuery({ queryKey: queryKeys.status, queryFn: () => getStatus(true) });
  };

  return (
    <main className="min-h-full">
      {snapshot.setupRequired ? (
        <SetupScreen snapshot={snapshot} onRetry={retry} retrying={initial.isFetching} />
      ) : (
        <StatusView snapshot={snapshot} live={state === 'open'} />
      )}
    </main>
  );
}
