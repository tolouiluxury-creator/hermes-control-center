import type { ChatSessionSummary } from './api.js';

export interface ChatSessionGroup {
  label:
    | 'chat.groupPinned'
    | 'chat.groupToday'
    | 'chat.groupYesterday'
    | 'chat.groupThisWeek'
    | 'chat.groupOlder';
  sessions: ChatSessionSummary[];
  /**
   * Pinned group only: `sessions[0..pinnedTelegramCount)` are Telegram
   * conversations. They're auto-pinned (regardless of `session.pinned`) and
   * always sort first, ahead of the user's own manually pinned sessions —
   * the UI draws a divider between the two using this count.
   */
  pinnedTelegramCount?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Groups by local calendar day relative to `now`, not by a rolling 24h/7d
 * window — "yesterday" means the previous calendar day, matching how every
 * other date-grouped list (email, chat apps) reads.
 */
export function groupByRecency(
  sessions: ChatSessionSummary[],
  now: number = Date.now(),
): ChatSessionGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 7 * DAY_MS;

  const buckets: Record<ChatSessionGroup['label'], ChatSessionSummary[]> = {
    'chat.groupPinned': [],
    'chat.groupToday': [],
    'chat.groupYesterday': [],
    'chat.groupThisWeek': [],
    'chat.groupOlder': [],
  };
  // Telegram conversations are pinned by default, ahead of anything the user
  // pinned by hand — kept in their own array so they can be spliced in front
  // regardless of arrival order.
  const pinnedTelegram: ChatSessionSummary[] = [];

  for (const session of sessions) {
    if (session.source === 'telegram') {
      pinnedTelegram.push(session);
      continue;
    }
    if (session.pinned) {
      buckets['chat.groupPinned'].push(session);
      continue;
    }
    const startedAt = session.startedAt;
    if (startedAt === null || startedAt < weekStart) {
      buckets['chat.groupOlder'].push(session);
    } else if (startedAt >= todayStart) {
      buckets['chat.groupToday'].push(session);
    } else if (startedAt >= yesterdayStart) {
      buckets['chat.groupYesterday'].push(session);
    } else {
      buckets['chat.groupThisWeek'].push(session);
    }
  }

  buckets['chat.groupPinned'] = [...pinnedTelegram, ...buckets['chat.groupPinned']];

  return (Object.keys(buckets) as ChatSessionGroup['label'][])
    .map((label) => ({
      label,
      sessions: buckets[label],
      ...(label === 'chat.groupPinned' ? { pinnedTelegramCount: pinnedTelegram.length } : {}),
    }))
    .filter((group) => group.sessions.length > 0);
}
