import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { log } from '../log.js';
import { LATEST_VERSION, MIGRATIONS } from './migrations.js';

export type Row = Record<string, unknown>;

/**
 * Local state lives in a single SQLite file via Node's built-in driver, so the
 * published package needs no native compilation. Everything here is synchronous
 * by design: the payloads are tiny (layouts, prompts, metric samples) and this
 * keeps call sites free of pointless await noise.
 */
export class Store {
  private constructor(readonly db: DatabaseSync) {}

  static open(path: string): Store {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true });
    }

    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');

    const store = new Store(db);
    store.migrate();
    return store;
  }

  private currentVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as
      { user_version?: number } | undefined;
    return typeof row?.user_version === 'number' ? row.user_version : 0;
  }

  private migrate(): void {
    const from = this.currentVersion();
    if (from >= LATEST_VERSION) return;

    for (const migration of MIGRATIONS) {
      if (migration.version <= from) continue;

      this.db.exec('BEGIN');
      try {
        this.db.exec(migration.sql);
        // PRAGMA does not accept bound parameters.
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
        this.db.exec('COMMIT');
        log.debug(`Applied migration ${migration.version}: ${migration.name}`);
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw new Error(
          `Migration ${migration.version} (${migration.name}) failed: ` +
            (error instanceof Error ? error.message : String(error)),
          { cause: error },
        );
      }
    }
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, ...params: unknown[]): void {
    this.db.prepare(sql).run(...(params as never[]));
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Already closed.
    }
  }
}
