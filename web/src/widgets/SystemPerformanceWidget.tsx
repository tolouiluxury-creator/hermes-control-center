import { useQuery } from '@tanstack/react-query';
import { getMetricSeries, queryKeys } from '@/lib/api';
import { formatBytes, formatPercent } from '@/lib/format';
import { useStatus } from '@/lib/useStatus';
import { Sparkline } from '@/components/Sparkline';

/** Colour follows severity, never decoration: green stays green until it matters. */
function severityColor(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return 'var(--color-ink-faint)';
  if (percent >= 90) return 'var(--color-danger)';
  if (percent >= 75) return 'var(--color-warn)';
  return 'var(--color-accent)';
}

function Gauge({
  label,
  percent,
  detail,
  metric,
}: {
  label: string;
  percent: number | null | undefined;
  detail: string | null;
  metric: string;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.metricSeries(metric),
    queryFn: () => getMetricSeries(metric),
    // The ring buffer only changes as fast as the poller fills it.
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const color = severityColor(percent);
  const points = data?.samples.map((sample) => sample.value) ?? [];

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-[var(--color-ink-faint)]">{label}</span>
        <span className="font-mono text-sm tabular-nums" style={{ color }}>
          {formatPercent(percent)}
        </span>
      </div>

      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-raised)]"
        role="meter"
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} Auslastung`}
      >
        <div
          className="h-full rounded-full transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-ui)]"
          style={{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%`, background: color }}
        />
      </div>

      {points.length > 1 && (
        <Sparkline values={points} color={color} className="mt-1.5 h-6 w-full" label={label} />
      )}

      {detail && (
        <p className="mt-1 truncate text-[0.7rem] text-[var(--color-ink-faint)]">{detail}</p>
      )}
    </div>
  );
}

export function SystemPerformanceWidget() {
  const { data: snapshot } = useStatus();
  const host = snapshot?.host;

  return (
    <div className="grid h-full grid-cols-1 gap-4 sm:grid-cols-3">
      <Gauge
        label="CPU"
        percent={host?.cpuPercent}
        detail={host?.cpuCount ? `${host.cpuCount} Kerne` : null}
        metric="cpu"
      />
      <Gauge
        label="RAM"
        percent={host?.memoryPercent}
        detail={
          host?.memoryTotalBytes
            ? `${formatBytes(host.memoryUsedBytes)} / ${formatBytes(host.memoryTotalBytes)}`
            : null
        }
        metric="memory"
      />
      <Gauge
        label="Disk"
        percent={host?.diskPercent}
        detail={host?.diskTotalBytes ? formatBytes(host.diskTotalBytes) : null}
        metric="disk"
      />
    </div>
  );
}
