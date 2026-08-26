import { describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { BotsRepo } from './bots.js';

function setup() {
  const store = Store.open(':memory:');
  return { store, bots: new BotsRepo(store) };
}

describe('BotsRepo', () => {
  it('creates a profile-backed bot and hides it from the default roster when requested', () => {
    const { store, bots } = setup();
    const bot = bots.create(
      { profileName: 'research', name: 'Researcher', description: 'Finds facts' },
      1000,
    );

    expect(bot).toMatchObject({
      profileName: 'research',
      name: 'Researcher',
      state: 'active',
      hidden: false,
    });
    bots.setHidden(bot.id, true, 2000);
    expect(bots.list()).toHaveLength(0);
    expect(bots.list({ includeHidden: true })[0]).toMatchObject({ id: bot.id, hidden: true });
    store.close();
  });

  it('updates state and keeps routine links idempotent', () => {
    const { store, bots } = setup();
    const bot = bots.create({ profileName: 'ops', name: 'Ops' }, 1000);

    bots.setState(bot.id, 'paused', 2000);
    bots.linkRoutine(bot.id, { type: 'workflow', routineId: 'wf-1' }, 2100);
    bots.linkRoutine(bot.id, { type: 'workflow', routineId: 'wf-1' }, 2200);

    expect(bots.get(bot.id)?.state).toBe('paused');
    expect(bots.routines(bot.id)).toEqual([
      { botId: bot.id, type: 'workflow', routineId: 'wf-1', enabled: true },
    ]);
    store.close();
  });

  it('stores and clears the canonical Bot Chat session binding', () => {
    const { store, bots } = setup();
    const bot = bots.create({ profileName: 'chatty', name: 'Chatty' }, 1000);

    expect(bot.canonicalChatSessionId).toBeNull();
    expect(bots.setCanonicalChatSession(bot.id, 'session-1', 2000)?.canonicalChatSessionId).toBe(
      'session-1',
    );
    expect(bots.delete(bot.id)).toBe(true);
    expect(bots.get(bot.id)).toBeNull();
    store.close();
  });
});
