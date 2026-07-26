import { describe, expect, it } from 'vitest';
import { deriveInsights, type InsightInput } from './insights.js';

const base: InsightInput = {
  host: null,
  agent: null,
  readiness: [],
  apiServerReachable: true,
  logs: null,
  skills: null,
  analytics: null,
  cron: null,
  memory: null,
};

const ids = (input: Partial<InsightInput>): string[] =>
  deriveInsights({ ...base, ...input }).map((insight) => insight.id);

const host = (overrides: Record<string, number>) =>
  ({
    os: null,
    cpuPercent: null,
    cpuCount: null,
    memoryPercent: null,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    diskPercent: null,
    diskUsedBytes: null,
    diskTotalBytes: null,
    uptimeSeconds: null,
    ...overrides,
  }) as InsightInput['host'];

describe('deriveInsights', () => {
  it('says nothing when there is nothing to say', () => {
    expect(deriveInsights(base)).toEqual([]);
  });

  /** A gauge is not an insight; only pressure worth acting on is. */
  it('stays quiet about healthy disk usage', () => {
    expect(ids({ host: host({ diskPercent: 42 }) })).toEqual([]);
  });

  it('warns about a filling disk and escalates when it is nearly full', () => {
    const warn = deriveInsights({ ...base, host: host({ diskPercent: 85 }) });
    expect(warn[0]?.id).toBe('disk-pressure');
    expect(warn[0]?.severity).toBe('warn');

    const critical = deriveInsights({ ...base, host: host({ diskPercent: 95 }) });
    expect(critical[0]?.severity).toBe('critical');
  });

  it('reports a stopped gateway as critical, with the reason Hermes gave', () => {
    const [insight] = deriveInsights({
      ...base,
      agent: {
        version: '0.19.0',
        gatewayRunning: false,
        gatewayState: 'stopped',
        gatewayExitReason: 'Gateway restart requested',
        activeSessions: 0,
        activeAgents: 0,
        profile: null,
        profiles: [],
        overall: 'degraded',
        hermesHome: null,
      },
    });

    expect(insight?.id).toBe('gateway-stopped');
    expect(insight?.severity).toBe('critical');
    expect(insight?.body).toContain('Gateway restart requested');
  });

  it('collects failing components into one insight with their details', () => {
    const [insight] = deriveInsights({
      ...base,
      readiness: [
        { name: 'storage', ok: false, detail: 'disk full' },
        { name: 'gateway', ok: true, detail: 'ok' },
        { name: 'model', ok: null, detail: 'degraded' },
      ],
    });

    expect(insight?.id).toBe('components-failing');
    expect(insight?.evidence).toEqual({ storage: 'disk full' });
  });

  describe('log errors', () => {
    const line = (text: string, level: 'error' | 'info' = 'error') => ({ text, level }) as const;

    it('ignores a couple of unrelated errors in a long log', () => {
      const logs = [
        ...Array.from({ length: 100 }, () => line('all fine', 'info')),
        line('2026-07-26 ERROR one thing broke'),
        line('2026-07-26 ERROR something else broke'),
      ];
      expect(ids({ logs })).toEqual([]);
    });

    /**
     * Taken from a real log: a service failing to start every twenty seconds
     * made up only 3.5% of the lines — below any sensible share threshold, yet
     * the most important thing in the file. Repetition must trigger on its own.
     */
    it('catches a quiet restart loop that never reaches the share threshold', () => {
      const logs = [
        ...Array.from({ length: 193 }, () => line('2026-07-26 INFO working', 'info')),
        ...Array.from({ length: 7 }, () =>
          line(
            '2026-07-26 10:42:32,417 ERROR gateway.run: Another gateway instance is already running',
          ),
        ),
      ];

      const [insight] = deriveInsights({ ...base, logs });
      expect(insight?.id).toBe('log-errors');
      expect(insight?.severity).toBe('warn');
      expect(insight?.evidence.Wiederholungen).toBe(7);
      // 3.5% — the share rule alone would have stayed silent.
      expect(7 / 200).toBeLessThan(0.05);
    });

    /**
     * The real case this was written for: a service restart loop writes the same
     * message every few seconds. That reads very differently from scattered
     * failures, and the rule has to tell them apart.
     */
    it('recognises one message repeating as a loop', () => {
      const logs = [
        ...Array.from({ length: 20 }, () =>
          line(
            '2026-07-26 10:42:32,417 ERROR gateway.run: Another gateway instance is already running',
          ),
        ),
        ...Array.from({ length: 30 }, () => line('info', 'info')),
      ];

      const [insight] = deriveInsights({ ...base, logs });
      expect(insight?.id).toBe('log-errors');
      expect(insight?.severity).toBe('warn');
      expect(insight?.title).toContain('wiederholt');
      expect(insight?.evidence.Wiederholungen).toBe(20);
    });

    it('describes scattered errors differently', () => {
      const logs = [
        line('2026-07-26 ERROR alpha failed'),
        line('2026-07-26 ERROR beta exploded'),
        line('2026-07-26 ERROR gamma timed out'),
        line('2026-07-26 ERROR delta refused'),
        ...Array.from({ length: 16 }, () => line('info', 'info')),
      ];

      const [insight] = deriveInsights({ ...base, logs });
      expect(insight?.title).toContain('4 Fehlerzeilen');
      expect(insight?.severity).toBe('info');
    });
  });

  it('mentions the API server only when it is actually missing', () => {
    expect(ids({ apiServerReachable: true })).not.toContain('api-server-off');
    expect(ids({ apiServerReachable: false })).toContain('api-server-off');
  });

  it('flags a library of skills that has never been used', () => {
    const unused = {
      total: 118,
      enabled: 118,
      categories: [],
      top: [{ name: 'pdf', usage: 0, enabled: true, category: null }],
    };
    expect(ids({ skills: unused })).toContain('skills-unused');

    const used = { ...unused, top: [{ name: 'pdf', usage: 12, enabled: true, category: null }] };
    expect(ids({ skills: used })).not.toContain('skills-unused');
  });

  it('lists paused cron jobs', () => {
    const jobs = [
      {
        id: '1',
        name: 'Bericht',
        schedule: '0 7 * * *',
        paused: true,
        nextRun: null,
        lastRun: null,
      },
      { id: '2', name: 'News', schedule: '0 7 * * 1', paused: false, nextRun: null, lastRun: null },
    ];
    const [insight] = deriveInsights({ ...base, cron: jobs });
    expect(insight?.id).toBe('cron-paused');
    expect(insight?.evidence).toEqual({ Bericht: 'pausiert' });
  });

  describe('token spike', () => {
    const day = (tokens: number) => ({
      day: '2026-07-01',
      inputTokens: tokens,
      outputTokens: 0,
      cost: 0,
    });

    const analytics = (values: number[]) =>
      ({
        periodDays: 30,
        totals: {
          inputTokens: null,
          outputTokens: null,
          cost: null,
          costIsEstimate: true,
          sessions: null,
          apiCalls: null,
        },
        daily: values.map(day),
        byModel: [],
        topTools: [],
      }) as InsightInput['analytics'];

    it('reports a genuine jump', () => {
      expect(
        ids({ analytics: analytics([10_000, 10_000, 10_000, 90_000, 90_000, 90_000]) }),
      ).toContain('token-spike');
    });

    /** Doubling from almost nothing is arithmetic, not news. */
    it('ignores a jump from a negligible base', () => {
      expect(ids({ analytics: analytics([10, 10, 10, 900, 900, 900]) })).not.toContain(
        'token-spike',
      );
    });

    it('needs enough history before comparing', () => {
      expect(ids({ analytics: analytics([10_000, 90_000]) })).not.toContain('token-spike');
    });
  });

  it('puts the most severe first', () => {
    const result = deriveInsights({
      ...base,
      apiServerReachable: false,
      host: host({ diskPercent: 95 }),
      cron: [{ id: '1', name: 'x', schedule: null, paused: true, nextRun: null, lastRun: null }],
    });

    expect(result.map((insight) => insight.severity)).toEqual(['critical', 'info', 'info']);
  });
});
