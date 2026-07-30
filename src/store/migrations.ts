/**
 * Forward-only schema migrations. Each entry runs once, in order, inside a
 * transaction; `PRAGMA user_version` tracks how far we got. Never edit a shipped
 * migration — append a new one.
 *
 * Timestamps are epoch milliseconds (INTEGER) so pruning and range queries stay
 * index-friendly. JSON columns hold TEXT.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
      -- Per-profile dashboard layouts (widget positions, sizes, visibility).
      CREATE TABLE dashboards (
        id          TEXT PRIMARY KEY,
        profile     TEXT NOT NULL DEFAULT '',
        name        TEXT NOT NULL,
        layout      TEXT NOT NULL,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX dashboards_profile_idx ON dashboards (profile);

      -- Reusable prompts. Hermes has no prompt library of its own.
      CREATE TABLE prompts (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        variables   TEXT NOT NULL DEFAULT '[]',
        tags        TEXT NOT NULL DEFAULT '[]',
        uses        INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX prompts_title_idx ON prompts (title);

      -- Named agent presets: a model plus toolset, skills and a system prompt.
      CREATE TABLE agents (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL UNIQUE,
        description   TEXT NOT NULL DEFAULT '',
        provider      TEXT,
        model         TEXT,
        toolset       TEXT,
        skills        TEXT NOT NULL DEFAULT '[]',
        system_prompt TEXT NOT NULL DEFAULT '',
        accent        TEXT,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      -- Workflows are ordered chains over Hermes runs and cron jobs.
      CREATE TABLE workflows (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE workflow_steps (
        id          TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        kind        TEXT NOT NULL,
        config      TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX workflow_steps_workflow_idx ON workflow_steps (workflow_id, position);

      CREATE TABLE workflow_runs (
        id          TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
        status      TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        finished_at INTEGER,
        detail      TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX workflow_runs_workflow_idx ON workflow_runs (workflow_id, started_at DESC);

      -- Notifications derived from polling (job finished, update available, ...).
      CREATE TABLE notifications (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL,
        severity    TEXT NOT NULL DEFAULT 'info',
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        data        TEXT NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL,
        read_at     INTEGER
      );
      CREATE INDEX notifications_created_idx ON notifications (created_at DESC);

      -- Output of the insight rule engine, with dismissal state.
      CREATE TABLE insights (
        id           TEXT PRIMARY KEY,
        rule         TEXT NOT NULL,
        severity     TEXT NOT NULL DEFAULT 'info',
        title        TEXT NOT NULL,
        body         TEXT NOT NULL DEFAULT '',
        evidence     TEXT NOT NULL DEFAULT '{}',
        action       TEXT,
        created_at   INTEGER NOT NULL,
        dismissed_at INTEGER
      );
      CREATE INDEX insights_rule_idx ON insights (rule);

      -- Ring buffer for sparklines: Hermes only reports instantaneous values.
      CREATE TABLE metrics_samples (
        metric TEXT NOT NULL,
        ts     INTEGER NOT NULL,
        value  REAL NOT NULL
      );
      CREATE INDEX metrics_samples_metric_ts_idx ON metrics_samples (metric, ts DESC);

      -- UI preferences and other small key/value state.
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'drop agent presets',
    // The agent-presets area was removed: it was the control center's own
    // invention, and it overlapped with profiles (which Hermes really has) and
    // the models page. Migration 1 stays untouched per the rule above, so this
    // drop reaches databases that already ran it.
    sql: `DROP TABLE IF EXISTS agents;`,
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);
