import { describe, expect, it } from 'vitest';
import { groupByRecency } from './chatGroups.js';
import type { ChatSessionSummary } from './api.js';

function session(id: string, startedAt: number | null, pinned = false): ChatSessionSummary {
  return {
    id,
    title: '',
    preview: '',
    startedAt,
    messageCount: 0,
    source: '',
    model: null,
    pinned,
    tokens: null,
  };
}

describe('groupByRecency', () => {
  const now = new Date('2026-08-03T12:00:00').getTime();
  const day = 24 * 60 * 60 * 1000;

  it('buckets into today, yesterday, this week, and older', () => {
    const sessions = [
      session('today', now - 2 * 60 * 60 * 1000),
      session('yesterday', now - day - 60 * 1000),
      session('this-week', now - 3 * day),
      session('older', now - 30 * day),
    ];
    const groups = groupByRecency(sessions, now);
    expect(groups.map((g) => g.label)).toEqual([
      'chat.groupToday',
      'chat.groupYesterday',
      'chat.groupThisWeek',
      'chat.groupOlder',
    ]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['today']);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(['yesterday']);
    expect(groups[2]?.sessions.map((s) => s.id)).toEqual(['this-week']);
    expect(groups[3]?.sessions.map((s) => s.id)).toEqual(['older']);
  });

  it('omits empty groups entirely', () => {
    const groups = groupByRecency([session('today', now)], now);
    expect(groups).toHaveLength(1);
  });

  it('puts a session with no startedAt into "older" rather than dropping it', () => {
    const groups = groupByRecency([session('unknown', null)], now);
    expect(groups[0]?.label).toBe('chat.groupOlder');
  });

  it('groups a pinned session ahead of the date-based buckets regardless of age', () => {
    const sessions = [
      session('older', now - 30 * day),
      session('pinned-old', now - 30 * day, true),
    ];
    const groups = groupByRecency(sessions, now);
    expect(groups.map((g) => g.label)).toEqual(['chat.groupPinned', 'chat.groupOlder']);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['pinned-old']);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(['older']);
  });
});
