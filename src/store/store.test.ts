import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { LATEST_VERSION } from './migrations.js';
import { SettingsRepo } from './settings.js';
import { METRIC_RETENTION_MS, MetricsRepo } from './metrics.js';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

describe('Store', () => {
  it('migrates to the latest version and is idempotent', () => {
    const version = store.get<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(LATEST_VERSION);

    // Re-opening the same schema must not attempt to re-run migrations.
    expect(() => Store.open(':memory:').close()).not.toThrow();
  });

  it('creates every table the app relies on', () => {
    const tables = store
      .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .map((row) => row.name);

    for (const expected of [
      'dashboards',
      'prompts',
      'agents',
      'workflows',
      'workflow_steps',
      'workflow_runs',
      'notifications',
      'insights',
      'metrics_samples',
      'settings',
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('rolls back a failing transaction', () => {
    const settings = new SettingsRepo(store);
    expect(() =>
      store.transaction(() => {
        settings.set('a', 1);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(settings.get('a', null)).toBeNull();
  });

  it('cascades workflow steps when a workflow is deleted', () => {
    const now = Date.now();
    store.run(
      'INSERT INTO workflows (id, name, description, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      'wf1',
      'Nightly',
      '',
      now,
      now,
    );
    store.run(
      'INSERT INTO workflow_steps (id, workflow_id, position, kind, config) VALUES (?, ?, 0, ?, ?)',
      'st1',
      'wf1',
      'run',
      '{}',
    );

    store.run('DELETE FROM workflows WHERE id = ?', 'wf1');
    expect(store.all('SELECT id FROM workflow_steps')).toHaveLength(0);
  });
});

describe('SettingsRepo', () => {
  it('round-trips JSON values and upserts', () => {
    const settings = new SettingsRepo(store);
    settings.set('theme', { mode: 'dark', accent: 'teal' });
    expect(settings.get('theme', null)).toEqual({ mode: 'dark', accent: 'teal' });

    settings.set('theme', { mode: 'light' });
    expect(settings.get('theme', null)).toEqual({ mode: 'light' });
  });

  it('returns the fallback for missing or corrupt values', () => {
    const settings = new SettingsRepo(store);
    expect(settings.get('missing', 'fallback')).toBe('fallback');

    store.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'bad', '{oops', 0);
    expect(settings.get('bad', 'fallback')).toBe('fallback');
  });
});

describe('MetricsRepo', () => {
  it('skips null and non-finite samples', () => {
    const metrics = new MetricsRepo(store);
    metrics.record([
      { metric: 'cpu', value: 23 },
      { metric: 'gpu', value: null },
      { metric: 'ram', value: Number.NaN },
    ]);

    expect(metrics.count()).toBe(1);
    expect(metrics.series('gpu')).toEqual([]);
  });

  it('returns series oldest-first and the latest sample per metric', () => {
    const metrics = new MetricsRepo(store);
    const now = Date.now();
    metrics.record([{ metric: 'cpu', value: 10 }], now - 2000);
    metrics.record([{ metric: 'cpu', value: 20 }], now - 1000);
    metrics.record([{ metric: 'cpu', value: 30 }], now);

    expect(metrics.series('cpu', METRIC_RETENTION_MS, now).map((s) => s.value)).toEqual([
      10, 20, 30,
    ]);
    expect(metrics.latest(['cpu']).cpu?.value).toBe(30);
    expect(metrics.latest(['nope']).nope).toBeNull();
  });

  it('drops samples older than the retention window', () => {
    const metrics = new MetricsRepo(store);
    const now = Date.now();
    metrics.record([{ metric: 'cpu', value: 1 }], now - METRIC_RETENTION_MS - 1000);
    metrics.record([{ metric: 'cpu', value: 2 }], now);

    metrics.prune(now);
    expect(metrics.series('cpu', METRIC_RETENTION_MS, now).map((s) => s.value)).toEqual([2]);
  });
});
