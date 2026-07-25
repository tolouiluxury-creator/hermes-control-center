import type { Store } from './db.js';

/** Small JSON key/value bag for UI preferences and poller bookkeeping. */
export class SettingsRepo {
  constructor(private readonly store: Store) {}

  get<T>(key: string, fallback: T): T {
    const row = this.store.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.store.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key,
      JSON.stringify(value),
      Date.now(),
    );
  }

  delete(key: string): void {
    this.store.run('DELETE FROM settings WHERE key = ?', key);
  }

  all(): Record<string, unknown> {
    const rows = this.store.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = null;
      }
    }
    return result;
  }
}
