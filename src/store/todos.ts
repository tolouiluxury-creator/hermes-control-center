import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

/** Quick notes scoped to one chat. Hermes has no such thing, same reasoning as the prompt library. */

export interface Todo {
  id: string;
  sessionId: string;
  text: string;
  done: boolean;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TodoInput {
  text: string;
}

interface TodoRow {
  id: string;
  session_id: string;
  text: string;
  done: number;
  pinned: number;
  created_at: number;
  updated_at: number;
}

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    done: row.done === 1,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TodosRepo {
  constructor(private readonly store: Store) {}

  listForSession(sessionId: string): Todo[] {
    return this.store
      .all<TodoRow>(
        'SELECT * FROM todos WHERE session_id = ? ORDER BY pinned DESC, created_at DESC',
        sessionId,
      )
      .map(toTodo);
  }

  private get(id: string): Todo | null {
    const row = this.store.get<TodoRow>('SELECT * FROM todos WHERE id = ?', id);
    return row ? toTodo(row) : null;
  }

  create(sessionId: string, input: TodoInput, now = Date.now()): Todo {
    const todo: Todo = {
      id: randomUUID(),
      sessionId,
      text: input.text.trim(),
      done: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    this.store.run(
      `INSERT INTO todos (id, session_id, text, done, pinned, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, ?, ?)`,
      todo.id,
      todo.sessionId,
      todo.text,
      todo.createdAt,
      todo.updatedAt,
    );
    return todo;
  }

  setDone(id: string, done: boolean, now = Date.now()): Todo | null {
    if (!this.get(id)) return null;
    this.store.run('UPDATE todos SET done = ?, updated_at = ? WHERE id = ?', done ? 1 : 0, now, id);
    return this.get(id);
  }

  setPinned(id: string, pinned: boolean, now = Date.now()): Todo | null {
    if (!this.get(id)) return null;
    this.store.run(
      'UPDATE todos SET pinned = ?, updated_at = ? WHERE id = ?',
      pinned ? 1 : 0,
      now,
      id,
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.store.run('DELETE FROM todos WHERE id = ?', id);
    return true;
  }
}
