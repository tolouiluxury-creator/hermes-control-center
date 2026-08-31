import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

export type GroupMessageKind = 'user' | 'assistant';

export interface GroupRoomRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface GroupRoomWithMembers extends GroupRoomRecord {
  memberBotIds: string[];
}

export interface GroupMessageRecord {
  id: string;
  roomId: string;
  senderBotId: string | null;
  kind: GroupMessageKind;
  text: string;
  createdAt: number;
}

/** The store `this.store` rows are snake_case; these mappers align them. */
interface GroupRoomRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

interface GroupMessageRow {
  id: string;
  room_id: string;
  sender_bot_id: string | null;
  kind: string;
  text: string;
  created_at: number;
}

function toRoom(row: GroupRoomRow): GroupRoomRecord {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: GroupMessageRow): GroupMessageRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    senderBotId: row.sender_bot_id,
    kind: row.kind === 'assistant' ? 'assistant' : 'user',
    text: row.text,
    createdAt: row.created_at,
  };
}

function requiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

export class GroupRoomsRepo {
  constructor(private readonly store: Store) {}

  createRoom(name: string, memberBotIds: string[], now = Date.now()): GroupRoomWithMembers {
    const id = randomUUID();
    this.store.run(
      'INSERT INTO group_rooms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
      id,
      requiredText(name, 'name'),
      now,
      now,
    );
    for (const botId of new Set(memberBotIds)) {
      this.store.run('INSERT INTO group_room_members (room_id, bot_id) VALUES (?, ?)', id, botId);
    }
    return this.getRoom(id) as GroupRoomWithMembers;
  }

  deleteRoom(id: string): boolean {
    return this.store.run('DELETE FROM group_rooms WHERE id = ?', id).changes > 0;
  }

  getRoom(id: string): GroupRoomWithMembers | null {
    const row = this.store.get<GroupRoomRow>('SELECT * FROM group_rooms WHERE id = ?', id);
    if (!row) return null;
    const members = this.store
      .all<{ bot_id: string }>('SELECT bot_id FROM group_room_members WHERE room_id = ?', id)
      .map((m) => m.bot_id);
    return { ...toRoom(row), memberBotIds: members };
  }

  listRooms(): GroupRoomWithMembers[] {
    const rows = this.store.all<GroupRoomRow>('SELECT * FROM group_rooms ORDER BY updated_at DESC');
    return rows.map((row) => {
      const members = this.store
        .all<{ bot_id: string }>('SELECT bot_id FROM group_room_members WHERE room_id = ?', row.id)
        .map((m) => m.bot_id);
      return { ...toRoom(row), memberBotIds: members };
    });
  }

  setMembers(id: string, memberBotIds: string[]): GroupRoomWithMembers | null {
    if (!this.getRoom(id)) return null;
    this.store.run('DELETE FROM group_room_members WHERE room_id = ?', id);
    for (const botId of new Set(memberBotIds)) {
      this.store.run('INSERT INTO group_room_members (room_id, bot_id) VALUES (?, ?)', id, botId);
    }
    this.store.run('UPDATE group_rooms SET updated_at = ? WHERE id = ?', Date.now(), id);
    return this.getRoom(id);
  }

  addMessage(
    roomId: string,
    text: string,
    kind: GroupMessageKind = 'user',
    senderBotId: string | null = null,
    now = Date.now(),
  ): GroupMessageRecord | null {
    if (!this.getRoom(roomId)) return null;
    const id = randomUUID();
    this.store.run(
      `INSERT INTO group_room_messages (id, room_id, sender_bot_id, kind, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      roomId,
      senderBotId,
      kind,
      requiredText(text, 'text'),
      now,
    );
    this.store.run('UPDATE group_rooms SET updated_at = ? WHERE id = ?', now, roomId);
    const row = this.store.get<GroupMessageRow>(
      'SELECT * FROM group_room_messages WHERE id = ?',
      id,
    );
    return row ? toMessage(row) : null;
  }

  messages(roomId: string, limit = 200): GroupMessageRecord[] {
    return this.store
      .all<GroupMessageRow>(
        'SELECT * FROM group_room_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?',
        roomId,
        limit,
      )
      .reverse()
      .map(toMessage);
  }
}
