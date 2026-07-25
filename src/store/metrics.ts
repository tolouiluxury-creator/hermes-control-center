import type { Store } from './db.js';

export interface Sample {
  ts: number;
  value: number;
}

export interface MetricInput {
  metric: string;
  value: number | null;
}

/** How much history the sparklines can draw. Older samples are dropped. */
export const METRIC_RETENTION_MS = 60 * 60 * 1000;

/** Prune this often (in write batches) instead of on every single write. */
const PRUNE_EVERY_WRITES = 60;

/**
 * Hermes reports instantaneous values only, so live charts need their own
 * history. This is a bounded ring buffer, not an analytics store.
 */
export class MetricsRepo {
  private writesSincePrune = 0;

  constructor(private readonly store: Store) {}

  /** Records a batch. Null values are skipped so gaps stay gaps. */
  record(inputs: readonly MetricInput[], ts: number = Date.now()): void {
    const usable = inputs.filter(
      (input): input is { metric: string; value: number } =>
        input.value !== null && Number.isFinite(input.value),
    );
    if (usable.length === 0) return;

    this.store.transaction(() => {
      for (const input of usable) {
        this.store.run(
          'INSERT INTO metrics_samples (metric, ts, value) VALUES (?, ?, ?)',
          input.metric,
          ts,
          input.value,
        );
      }
    });

    this.writesSincePrune += 1;
    if (this.writesSincePrune >= PRUNE_EVERY_WRITES) {
      this.prune(ts);
      this.writesSincePrune = 0;
    }
  }

  /** Oldest-first samples for one metric within the retention window. */
  series(metric: string, windowMs: number = METRIC_RETENTION_MS, now = Date.now()): Sample[] {
    return this.store.all<Sample>(
      'SELECT ts, value FROM metrics_samples WHERE metric = ? AND ts >= ? ORDER BY ts ASC',
      metric,
      now - windowMs,
    );
  }

  /** Latest sample per metric, for the requested metrics. */
  latest(metrics: readonly string[]): Record<string, Sample | null> {
    const result: Record<string, Sample | null> = {};
    for (const metric of metrics) {
      result[metric] =
        this.store.get<Sample>(
          'SELECT ts, value FROM metrics_samples WHERE metric = ? ORDER BY ts DESC LIMIT 1',
          metric,
        ) ?? null;
    }
    return result;
  }

  prune(now = Date.now()): void {
    this.store.run('DELETE FROM metrics_samples WHERE ts < ?', now - METRIC_RETENTION_MS);
  }

  count(): number {
    return this.store.get<{ n: number }>('SELECT COUNT(*) AS n FROM metrics_samples')?.n ?? 0;
  }
}
