import { describe, expect, it, beforeEach } from 'vitest';
import { Store } from './db.js';
import { PromptsRepo, extractVariables, normalizeTags } from './prompts.js';

function memoryStore(): Store {
  // ':memory:' gives each test its own throwaway database.
  return Store.open(':memory:');
}

describe('extractVariables', () => {
  it('finds placeholders and de-duplicates them, sorted', () => {
    expect(extractVariables('Hallo {{name}}, dein {{thema}} und nochmal {{name}}')).toEqual([
      'name',
      'thema',
    ]);
  });

  it('tolerates spacing inside the braces', () => {
    expect(extractVariables('{{ vorname }} und {{nachname}}')).toEqual(['nachname', 'vorname']);
  });

  it('returns nothing for a body without placeholders', () => {
    expect(extractVariables('Ein ganz normaler Prompt.')).toEqual([]);
  });
});

describe('normalizeTags', () => {
  it('trims, lowercases, de-duplicates and drops empties', () => {
    expect(normalizeTags([' Marketing ', 'marketing', '', 'SEO'])).toEqual(['marketing', 'seo']);
  });

  it('handles the absent case', () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('PromptsRepo', () => {
  let repo: PromptsRepo;

  beforeEach(() => {
    repo = new PromptsRepo(memoryStore());
  });

  it('creates a prompt, deriving variables from the body', () => {
    const prompt = repo.create({ title: '  Bericht  ', body: 'Erstelle {{thema}}', tags: ['x'] });
    expect(prompt.title).toBe('Bericht');
    expect(prompt.variables).toEqual(['thema']);
    expect(prompt.tags).toEqual(['x']);
    expect(prompt.uses).toBe(0);
  });

  it('round-trips through the database', () => {
    const created = repo.create({ title: 'A', body: 'Body {{v}}' });
    const fetched = repo.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('lists most-recently-updated first', () => {
    const first = repo.create({ title: 'first', body: 'x' }, 1000);
    const second = repo.create({ title: 'second', body: 'y' }, 2000);
    expect(repo.list().map((p) => p.id)).toEqual([second.id, first.id]);
  });

  it('re-derives variables on update', () => {
    const created = repo.create({ title: 'A', body: 'no vars' });
    const updated = repo.update(created.id, { title: 'A', body: '{{eins}} {{zwei}}' });
    expect(updated?.variables).toEqual(['eins', 'zwei']);
  });

  it('returns null when updating or deleting something absent', () => {
    expect(repo.update('nope', { title: 'x', body: 'y' })).toBeNull();
    expect(repo.delete('nope')).toBe(false);
    expect(repo.recordUse('nope')).toBeNull();
  });

  it('counts uses', () => {
    const created = repo.create({ title: 'A', body: 'x' });
    expect(repo.recordUse(created.id)).toBe(1);
    expect(repo.recordUse(created.id)).toBe(2);
    expect(repo.get(created.id)?.uses).toBe(2);
  });

  it('deletes', () => {
    const created = repo.create({ title: 'A', body: 'x' });
    expect(repo.delete(created.id)).toBe(true);
    expect(repo.get(created.id)).toBeNull();
  });
});
