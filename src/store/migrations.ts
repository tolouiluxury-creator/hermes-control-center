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
  {
    version: 3,
    name: 'add todos',
    // Chat-scoped quick notes. Hermes has no such thing, same reasoning as
    // the prompt library: this is the control center's own data.
    sql: `
      CREATE TABLE todos (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        text        TEXT NOT NULL,
        done        INTEGER NOT NULL DEFAULT 0,
        pinned      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX todos_session_idx ON todos (session_id);
    `,
  },
  {
    version: 4,
    name: 'add workflow scheduling',
    // `schedule` mirrors what Aufgaben already teaches users (relative
    // one-off, `every …` interval, cron expression, or an ISO-local
    // timestamp — see `src/store/workflowSchedule.ts`). `next_run_at` caches
    // the next due time so a restart doesn't need to recompute every
    // workflow's schedule from scratch, and so the scheduler's query stays a
    // plain indexed comparison instead of parsing `schedule` on every tick.
    sql: `
      ALTER TABLE workflows ADD COLUMN schedule TEXT;
      ALTER TABLE workflows ADD COLUMN next_run_at INTEGER;
    `,
  },

  {
    version: 5,
    name: 'add profile-backed bots',
    sql: `
      CREATE TABLE bots (
        id           TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL UNIQUE,
        name         TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        avatar_key   TEXT,
        accent       TEXT,
        state        TEXT NOT NULL DEFAULT 'active',
        hidden       INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_seen_at INTEGER
      );
      CREATE INDEX bots_visibility_updated_idx ON bots (hidden, updated_at DESC);
      CREATE INDEX bots_state_updated_idx ON bots (state, updated_at DESC);

      CREATE TABLE bot_routines (
        bot_id      TEXT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        routine_id  TEXT NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (bot_id, type, routine_id)
      );
      CREATE INDEX bot_routines_bot_idx ON bot_routines (bot_id, enabled);
    `,
  },
  {
    version: 6,
    name: 'add bot pause channel snapshots',
    sql: `
      CREATE TABLE bot_pause_channels (
        bot_id          TEXT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
        platform_id     TEXT NOT NULL,
        was_enabled     INTEGER NOT NULL DEFAULT 1,
        paused_at       INTEGER NOT NULL,
        PRIMARY KEY (bot_id, platform_id)
      );
    `,
  },
  {
    version: 7,
    name: 'add canonical bot chat sessions',
    sql: `
      ALTER TABLE bots ADD COLUMN canonical_chat_session_id TEXT;
      CREATE UNIQUE INDEX bots_canonical_chat_session_idx
        ON bots (canonical_chat_session_id)
        WHERE canonical_chat_session_id IS NOT NULL;
    `,
  },
  {
    version: 8,
    name: 'add group chat rooms',
    sql: `
      CREATE TABLE group_rooms (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE group_room_members (
        room_id TEXT NOT NULL REFERENCES group_rooms (id) ON DELETE CASCADE,
        bot_id  TEXT NOT NULL REFERENCES bots (id) ON DELETE CASCADE,
        PRIMARY KEY (room_id, bot_id)
      );

      CREATE TABLE group_room_messages (
        id            TEXT PRIMARY KEY,
        room_id       TEXT NOT NULL REFERENCES group_rooms (id) ON DELETE CASCADE,
        sender_bot_id TEXT REFERENCES bots (id) ON DELETE SET NULL,
        kind          TEXT NOT NULL DEFAULT 'user',
        text          TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX group_room_messages_room_created_idx
        ON group_room_messages (room_id, created_at);
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0,
);
