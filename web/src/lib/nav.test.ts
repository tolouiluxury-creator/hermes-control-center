import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, navItemByPath, PRIMARY_NAV, FOOTER_NAV } from './nav';
import { matchesBinding, isFromTextEntry } from './shortcuts';
import { scoreCommand } from './search';

describe('navigation model', () => {
  it('has unique ids and paths', () => {
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((item) => item.path)).size).toBe(NAV_ITEMS.length);
  });

  it('covers every item exactly once across the two rendered groups', () => {
    expect(PRIMARY_NAV.length + FOOTER_NAV.length).toBe(NAV_ITEMS.length);
  });

  it('uses absolute paths, so a nested route cannot break a link', () => {
    for (const item of NAV_ITEMS) expect(item.path.startsWith('/')).toBe(true);
  });
});

describe('navItemByPath', () => {
  it('matches the dashboard only at the root', () => {
    expect(navItemByPath('/')?.id).toBe('dashboard');
    expect(navItemByPath('/logs')?.id).toBe('logs');
  });

  /** A detail route must keep its section highlighted. */
  it('keeps the section active on nested routes', () => {
    expect(navItemByPath('/chats/42')?.id).toBe('chats');
    expect(navItemByPath('/mcp/filesystem/tools')?.id).toBe('mcp');
  });

  it('returns null for an unknown path instead of guessing', () => {
    expect(navItemByPath('/gibt-es-nicht')).toBeNull();
  });
});

describe('keyboard bindings', () => {
  const event = (init: Partial<KeyboardEvent>): KeyboardEvent =>
    ({ metaKey: false, ctrlKey: false, shiftKey: false, ...init }) as KeyboardEvent;

  it('treats Ctrl and Cmd as the same primary modifier', () => {
    const binding = { key: 'k', mod: true };
    expect(matchesBinding(event({ key: 'k', ctrlKey: true }), binding)).toBe(true);
    expect(matchesBinding(event({ key: 'k', metaKey: true }), binding)).toBe(true);
    expect(matchesBinding(event({ key: 'k' }), binding)).toBe(false);
  });

  it('is case-insensitive but exact about modifiers', () => {
    const binding = { key: 'k', mod: true };
    expect(matchesBinding(event({ key: 'K', ctrlKey: true }), binding)).toBe(true);
    expect(matchesBinding(event({ key: 'k', ctrlKey: true, shiftKey: true }), binding)).toBe(false);
  });

  it('recognises typing contexts, so plain-key shortcuts stay out of the way', () => {
    expect(isFromTextEntry({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isFromTextEntry({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(isFromTextEntry({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(
      isFromTextEntry({ isContentEditable: true, tagName: 'DIV' } as unknown as EventTarget),
    ).toBe(true);
    expect(isFromTextEntry({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
    expect(isFromTextEntry(null)).toBe(false);
  });
});

describe('command ranking', () => {
  const rank = (query: string, labels: string[]): string[] =>
    labels
      .map((label) => ({ label, score: scoreCommand(query, label) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.label);

  it('puts a prefix match first', () => {
    expect(rank('log', ['Analytics', 'Logs', 'Dialoge'])[0]).toBe('Logs');
  });

  it('prefers the shorter label when both start with the query', () => {
    expect(rank('mo', ['Modelle konfigurieren', 'Modelle'])[0]).toBe('Modelle');
  });

  it('matches a word inside a multi-word label', () => {
    expect(rank('auto', ['Browser Automation'])).toEqual(['Browser Automation']);
  });

  it('finds abbreviations through a subsequence match', () => {
    expect(rank('brwsr', ['Browser Automation', 'Dokumente'])).toEqual(['Browser Automation']);
  });

  it('matches on keywords when the label does not contain the query', () => {
    expect(scoreCommand('rag', 'Wissen', ['rag', 'memory'])).toBeGreaterThan(0);
    expect(scoreCommand('rag', 'Wissen', [])).toBe(0);
  });

  it('drops non-matches instead of showing everything', () => {
    expect(rank('zzzz', ['Logs', 'Modelle', 'Skills'])).toEqual([]);
  });

  it('keeps every entry for an empty query', () => {
    expect(rank('', ['Logs', 'Modelle'])).toHaveLength(2);
  });
});
