/** Formatting helpers. Every one of them renders "—" for missing data. */

export const EM_DASH = '—';

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${value.toFixed(digits)}%`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return EM_DASH;
  if (value === 0) return '0 B';

  let index = 0;
  let scaled = value;
  while (scaled >= 1024 && index < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  return `${scaled.toFixed(index === 0 ? 0 : digits)} ${BYTE_UNITS[index]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return EM_DASH;
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(seconds)}s`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return EM_DASH;
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** Compact relative time, e.g. "vor 12 s". Locale-aware via Intl. */
export function formatRelativeTime(timestamp: number, locale = 'de', now = Date.now()): string {
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });

  const thresholds: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
  ];

  let value = deltaSeconds;
  for (const [unit, step] of thresholds) {
    if (Math.abs(value) < step) return formatter.format(value, unit);
    value = Math.round(value / step);
  }
  return formatter.format(value, 'week');
}
