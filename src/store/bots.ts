import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

export type BotState = 'active' | 'paused';
export type BotRoutineType = 'workflow' | 'cron';

export interface BotInput {
  profileName: string;
  name: string;
  description?: string;
  avatarKey?: string | null;
  accent?: string | null;
}

export interface BotPatch {
  name?: string;
  description?: string;
  avatarKey?: string | null;
  accent?: string | null;
  lastSeenAt?: number | null;
}

export interface BotRecord {
  id: string;
  profileName: string;
  name: string;
  description: string;
  avatarKey: string | null;
  accent: string | null;
  state: BotState;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  canonicalChatSessionId: string | null;
}

export interface BotRoutineInput {
  type: BotRoutineType;
  routineId: string;
}

export interface BotRoutineRecord extends BotRoutineInput {
  botId: string;
  enabled: boolean;
}

export interface BotPauseChannel {
  botId: string;
  platformId: string;
  wasEnabled: boolean;
}

export interface BotFilter {
  includeHidden?: boolean;
  state?: BotState;
}

interface BotRow {
  id: string;
  profile_name: string;
  name: string;
  description: string;
  avatar_key: string | null;
  accent: string | null;
  state: string;
  hidden: number;
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
  canonical_chat_session_id: string | null;
}

interface RoutineRow {
  bot_id: string;
  type: string;
  routine_id: string;
  enabled: number;
}

interface PauseChannelRow {
  bot_id: string;
  platform_id: string;
  was_enabled: number;
}

const STATES = new Set<BotState>(['active', 'paused']);
const ROUTINE_TYPES = new Set<BotRoutineType>(['workflow', 'cron']);

function toBot(row: BotRow): BotRecord {
  return {
    id: row.id,
    profileName: row.profile_name,
    name: row.name,
    description: row.description,
    avatarKey: row.avatar_key,
    accent: row.accent,
    state: STATES.has(row.state as BotState) ? (row.state as BotState) : 'paused',
    hidden: row.hidden !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    canonicalChatSessionId: row.canonical_chat_session_id ?? null,
  };
}

function toRoutine(row: RoutineRow): BotRoutineRecord {
  return {
    botId: row.bot_id,
    type: ROUTINE_TYPES.has(row.type as BotRoutineType) ? (row.type as BotRoutineType) : 'workflow',
    routineId: row.routine_id,
    enabled: row.enabled !== 0,
  };
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

export class BotsRepo {
  constructor(private readonly store: Store) {}

  create(input: BotInput, now = Date.now()): BotRecord {
    const id = randomUUID();
    this.store.run(
      `INSERT INTO bots
        (id, profile_name, name, description, avatar_key, accent, state, hidden, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, NULL)`,
      id,
      requiredText(input.profileName, 'profileName'),
      requiredText(input.name, 'name'),
      input.description?.trim() ?? '',
      input.avatarKey?.trim() || null,
      input.accent?.trim() || null,
      now,
      now,
    );
    return this.get(id) as BotRecord;
  }

  get(id: string): BotRecord | null {
    const row = this.store.get<BotRow>('SELECT * FROM bots WHERE id = ?', id);
    return row ? toBot(row) : null;
  }

  getByProfile(profileName: string): BotRecord | null {
    const row = this.store.get<BotRow>('SELECT * FROM bots WHERE profile_name = ?', profileName);
    return row ? toBot(row) : null;
  }

  list(filter: BotFilter = {}): BotRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeHidden) where.push('hidden = 0');
    if (filter.state) {
      where.push('state = ?');
      params.push(filter.state);
    }
    return this.store
      .all<BotRow>(
        `SELECT * FROM bots ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`,
        ...params,
      )
      .map(toBot);
  }

  update(id: string, patch: BotPatch, now = Date.now()): BotRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.store.run(
      `UPDATE bots
       SET name = ?, description = ?, avatar_key = ?, accent = ?, updated_at = ?, last_seen_at = ?
       WHERE id = ?`,
      patch.name === undefined ? existing.name : requiredText(patch.name, 'name'),
      patch.description === undefined ? existing.description : patch.description.trim(),
      patch.avatarKey === undefined ? existing.avatarKey : patch.avatarKey?.trim() || null,
      patch.accent === undefined ? existing.accent : patch.accent?.trim() || null,
      now,
      patch.lastSeenAt === undefined ? existing.lastSeenAt : patch.lastSeenAt,
      id,
    );
    return this.get(id);
  }

  setState(id: string, state: BotState, now = Date.now()): BotRecord | null {
    if (!STATES.has(state)) throw new Error(`Unknown bot state: ${state}`);
    if (!this.get(id)) return null;
    this.store.run('UPDATE bots SET state = ?, updated_at = ? WHERE id = ?', state, now, id);
    return this.get(id);
  }

  setHidden(id: string, hidden: boolean, now = Date.now()): BotRecord | null {
    if (!this.get(id)) return null;
    this.store.run(
      'UPDATE bots SET hidden = ?, updated_at = ? WHERE id = ?',
      hidden ? 1 : 0,
      now,
      id,
    );
    return this.get(id);
  }

  setCanonicalChatSession(id: string, sessionId: string, now = Date.now()): BotRecord | null {
    const bot = this.get(id);
    if (!bot) return null;
    this.store.run(
      'UPDATE bots SET canonical_chat_session_id = ?, updated_at = ? WHERE id = ?',
      requiredText(sessionId, 'sessionId'),
      now,
      id,
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.store.run('DELETE FROM bots WHERE id = ?', id).changes > 0;
  }

  routines(botId: string): BotRoutineRecord[] {
    return this.store
      .all<RoutineRow>(
        'SELECT * FROM bot_routines WHERE bot_id = ? ORDER BY type, routine_id',
        botId,
      )
      .map(toRoutine);
  }

  linkRoutine(botId: string, input: BotRoutineInput, now = Date.now()): void {
    this.setRoutineEnabled(botId, input, true, now);
  }

  /** Set a bot–routine link to enabled/disabled without removing it. */
  setRoutineEnabled(
    botId: string,
    input: BotRoutineInput,
    enabled: boolean,
    now = Date.now(),
  ): void {
    if (!this.get(botId)) throw new Error('Bot not found');
    if (!ROUTINE_TYPES.has(input.type)) throw new Error(`Unknown routine type: ${input.type}`);
    this.store.run(
      `INSERT INTO bot_routines (bot_id, type, routine_id, enabled, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bot_id, type, routine_id) DO UPDATE SET enabled = excluded.enabled`,
      botId,
      input.type,
      requiredText(input.routineId, 'routineId'),
      enabled ? 1 : 0,
      now,
    );
    this.store.run('UPDATE bots SET updated_at = ? WHERE id = ?', now, botId);
  }

  unlinkRoutine(botId: string, input: BotRoutineInput, now = Date.now()): void {
    this.store.run(
      'DELETE FROM bot_routines WHERE bot_id = ? AND type = ? AND routine_id = ?',
      botId,
      input.type,
      input.routineId,
    );
    this.store.run('UPDATE bots SET updated_at = ? WHERE id = ?', now, botId);
  }

  /** Remove every bot_routines link pointing at a (now deleted) cron job. */
  unlinkRoutineByCron(cronId: string): void {
    this.store.run('DELETE FROM bot_routines WHERE routine_id = ?', cronId);
  }

  rememberPausedChannel(botId: string, platformId: string, now = Date.now()): void {
    this.store.run(
      `INSERT INTO bot_pause_channels (bot_id, platform_id, was_enabled, paused_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(bot_id, platform_id) DO UPDATE SET was_enabled = 1, paused_at = excluded.paused_at`,
      botId,
      requiredText(platformId, 'platformId'),
      now,
    );
  }

  pausedChannels(botId: string): BotPauseChannel[] {
    return this.store
      .all<PauseChannelRow>(
        'SELECT * FROM bot_pause_channels WHERE bot_id = ? ORDER BY platform_id',
        botId,
      )
      .map((row) => ({
        botId: row.bot_id,
        platformId: row.platform_id,
        wasEnabled: row.was_enabled !== 0,
      }));
  }

  forgetPausedChannel(botId: string, platformId: string): void {
    this.store.run(
      'DELETE FROM bot_pause_channels WHERE bot_id = ? AND platform_id = ?',
      botId,
      platformId,
    );
  }
}
