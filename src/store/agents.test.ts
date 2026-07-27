import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db.js';
import { AgentsRepo, AgentNameTakenError } from './agents.js';

let store: Store;
let repo: AgentsRepo;

beforeEach(() => {
  store = Store.open(':memory:');
  repo = new AgentsRepo(store);
});

afterEach(() => {
  store.close();
});

describe('AgentsRepo', () => {
  it('creates a preset, deduplicating skills and clearing empty fields', () => {
    const agent = repo.create({
      name: '  Recherche  ',
      provider: 'custom',
      model: 'hermes-free',
      toolset: '',
      skills: ['pdf', 'pdf', ' arxiv '],
      systemPrompt: 'Sei gründlich.',
    });

    expect(agent.name).toBe('Recherche');
    expect(agent.toolset).toBeNull();
    expect(agent.skills).toEqual(['pdf', 'arxiv']);
    expect(repo.list()).toHaveLength(1);
  });

  it('rejects a duplicate name on create and on update', () => {
    repo.create({ name: 'Alpha' });
    expect(() => repo.create({ name: 'Alpha' })).toThrow(AgentNameTakenError);

    const beta = repo.create({ name: 'Beta' });
    expect(() => repo.update(beta.id, { name: 'Alpha' })).toThrow(AgentNameTakenError);
    // Keeping its own name is allowed.
    expect(repo.update(beta.id, { name: 'Beta', description: 'x' })?.description).toBe('x');
  });

  it('updates and deletes, and reports a missing id honestly', () => {
    const agent = repo.create({ name: 'Gamma', model: 'a' });
    const updated = repo.update(agent.id, { name: 'Gamma', model: 'b' });
    expect(updated?.model).toBe('b');

    expect(repo.delete(agent.id)).toBe(true);
    expect(repo.delete(agent.id)).toBe(false);
    expect(repo.update('nope', { name: 'x' })).toBeNull();
  });
});
