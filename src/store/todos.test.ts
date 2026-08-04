import { describe, expect, it, beforeEach } from 'vitest';
import { Store } from './db.js';
import { TodosRepo } from './todos.js';

function memoryStore(): Store {
  return Store.open(':memory:');
}

describe('TodosRepo', () => {
  let repo: TodosRepo;

  beforeEach(() => {
    repo = new TodosRepo(memoryStore());
  });

  it('creates a todo scoped to a session', () => {
    const todo = repo.create('session-a', { text: '  Check logs  ' });
    expect(todo.text).toBe('Check logs');
    expect(todo.sessionId).toBe('session-a');
    expect(todo.done).toBe(false);
    expect(todo.pinned).toBe(false);
  });

  it('lists only todos for the given session, pinned first then newest first', () => {
    repo.create('session-a', { text: 'first' }, 1000);
    const second = repo.create('session-a', { text: 'second' }, 2000);
    repo.create('session-b', { text: 'other session' }, 3000);
    repo.setPinned(second.id, true);

    const list = repo.listForSession('session-a');
    expect(list.map((t) => t.text)).toEqual(['second', 'first']);
  });

  it('toggles done and pinned independently, bumping updatedAt', () => {
    const todo = repo.create('session-a', { text: 'x' }, 1000);
    const done = repo.setDone(todo.id, true, 2000);
    expect(done?.done).toBe(true);
    expect(done?.pinned).toBe(false);
    expect(done?.updatedAt).toBe(2000);
  });

  it('returns null from setDone/setPinned for a missing id', () => {
    expect(repo.setDone('missing', true)).toBeNull();
    expect(repo.setPinned('missing', true)).toBeNull();
  });

  it('deletes a todo and reports whether one existed', () => {
    const todo = repo.create('session-a', { text: 'x' });
    expect(repo.delete(todo.id)).toBe(true);
    expect(repo.delete(todo.id)).toBe(false);
    expect(repo.listForSession('session-a')).toEqual([]);
  });

  it('deletes only the todos for the given session', () => {
    repo.create('session-a', { text: 'a1' });
    repo.create('session-a', { text: 'a2' });
    repo.create('session-b', { text: 'b1' });

    expect(repo.deleteForSession('session-a')).toBe(2);
    expect(repo.listForSession('session-a')).toEqual([]);
    expect(repo.listForSession('session-b').map((t) => t.text)).toEqual(['b1']);
  });
});
