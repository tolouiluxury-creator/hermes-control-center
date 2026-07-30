import { describe, expect, it } from 'vitest';
import {
  classifyLogLine,
  normalizeAnalytics,
  normalizeCronDeliveryTargets,
  normalizeCronJobs,
  normalizeMcpServers,
  normalizeMemory,
  normalizeMessagingPlatforms,
  normalizeModelInfo,
  normalizePairing,
  normalizeProfiles,
  normalizeSessionMessages,
  normalizeSessions,
  normalizeSkills,
  normalizeWebhooks,
  toEpochMs,
} from './inventory.js';

/**
 * The payloads below are copied from a real Hermes 0.19.0. Keeping them here is
 * what stops these normalisers from drifting back to assumptions.
 */

describe('normalizeSkills', () => {
  const real = [
    { name: 'pdf', description: 'PDF', category: 'productivity', enabled: true, usage: 12 },
    { name: 'canvas-design', description: '', category: 'creative', enabled: true, usage: 3 },
    { name: 'legacy', description: '', category: null, enabled: false, usage: 0 },
  ];

  it('counts totals and enabled skills', () => {
    const summary = normalizeSkills(real);
    expect(summary.total).toBe(3);
    expect(summary.enabled).toBe(2);
  });

  it('groups categories, largest first, and names the missing one', () => {
    const summary = normalizeSkills(real);
    expect(summary.categories.map((entry) => entry.name)).toContain('Ohne Kategorie');
    expect(summary.categories[0]?.count).toBeGreaterThanOrEqual(1);
  });

  it('ranks by usage, not alphabetically', () => {
    expect(normalizeSkills(real).top[0]?.name).toBe('pdf');
  });

  it('treats a missing enabled flag as enabled, matching the dashboard', () => {
    expect(normalizeSkills([{ name: 'x' }]).enabled).toBe(1);
  });
});

describe('normalizeCronJobs', () => {
  /** Copied from GET /api/cron/jobs on the real server, 30.07.2026. */
  const real = [
    {
      id: '235f3731da4b',
      name: 'Finanzbericht Morgenroutine',
      prompt: 'Erstelle den Bericht',
      schedule: { kind: 'cron', expr: '0 7 * * *', display: '0 7 * * *' },
      schedule_display: '0 7 * * *',
      next_run_at: '2026-07-29T07:00:00+02:00',
      last_run_at: '2026-07-18T07:00:33.050274+00:00',
      last_status: 'error',
      last_error: "ImportError: cannot import name 'TELEGRAM_RICH_MESSAGES_HINT'",
      profile: 'default',
    },
  ];

  it('reads the schedule out of the nested object', () => {
    expect(normalizeCronJobs(real)[0]?.schedule).toBe('0 7 * * *');
  });

  /*
   * Hermes names these `*_at` and sends ISO strings. Reading `next_run` with a
   * plain Number() left every timestamp null, and the page showed nothing — for
   * as long as the page has existed.
   */
  it('reads the ISO timestamps out of the *_at fields', () => {
    const [job] = normalizeCronJobs(real);
    expect(job?.nextRun).toBe(Date.parse('2026-07-29T07:00:00+02:00'));
    expect(job?.lastRun).toBe(Date.parse('2026-07-18T07:00:33.050274+00:00'));
  });

  it('still accepts the older epoch-number fields', () => {
    const [job] = normalizeCronJobs([{ id: 'a', next_run: 1_784_000_000_000, last_run: '17840' }]);
    expect(job?.nextRun).toBe(1_784_000_000_000);
    expect(job?.lastRun).toBe(17_840);
  });

  it('carries the failure through instead of hiding it', () => {
    const [job] = normalizeCronJobs(real);
    expect(job?.lastStatus).toBe('error');
    expect(job?.lastError).toContain('TELEGRAM_RICH_MESSAGES_HINT');
    expect(job?.profile).toBe('default');
  });

  it('carries prompt and deliver, so the edit form starts from the real job', () => {
    const [job] = normalizeCronJobs([
      { id: 'a', prompt: 'Erstelle den Bericht', deliver: 'telegram' },
    ]);
    expect(job?.prompt).toBe('Erstelle den Bericht');
    expect(job?.deliver).toBe('telegram');
  });

  it('leaves a job that never ran without invented values', () => {
    const [job] = normalizeCronJobs([{ id: 'a', next_run_at: null, last_run_at: null }]);
    expect(job?.nextRun).toBeNull();
    expect(job?.lastRun).toBeNull();
    expect(job?.lastStatus).toBeNull();
    expect(job?.lastError).toBeNull();
  });

  it('falls back to the prompt when a job has no name', () => {
    const [job] = normalizeCronJobs([{ id: 'a', prompt: 'Sende die Zusammenfassung' }]);
    expect(job?.name).toBe('Sende die Zusammenfassung');
  });

  /** Versions disagree on which flag pauses a job; either one must count. */
  it('treats both paused and enabled=false as paused', () => {
    expect(normalizeCronJobs([{ id: 'a', paused: true }])[0]?.paused).toBe(true);
    expect(normalizeCronJobs([{ id: 'b', enabled: false }])[0]?.paused).toBe(true);
    expect(normalizeCronJobs([{ id: 'c' }])[0]?.paused).toBe(false);
  });
});

describe('normalizeCronDeliveryTargets', () => {
  /** Copied from GET /api/cron/delivery-targets on the real server, 30.07.2026. */
  const real = {
    targets: [
      { id: 'local', name: 'Local (save only)', home_target_set: true, home_env_var: null },
      {
        id: 'telegram',
        name: 'Telegram',
        home_target_set: true,
        home_env_var: 'TELEGRAM_HOME_CHANNEL',
      },
    ],
  };

  it('keeps both targets with their env var', () => {
    const targets = normalizeCronDeliveryTargets(real);
    expect(targets.map((target) => target.id)).toEqual(['local', 'telegram']);
    expect(targets[1]?.homeEnvVar).toBe('TELEGRAM_HOME_CHANNEL');
  });

  /*
   * Hermes returns a platform without a home channel on purpose, so the UI can
   * say why it will not work. Only an explicit false means "not set".
   */
  it('marks a platform without a home channel, but keeps it', () => {
    const [target] = normalizeCronDeliveryTargets({
      targets: [{ id: 'telegram', name: 'Telegram', home_target_set: false }],
    });
    expect(target?.homeTargetSet).toBe(false);
    expect(normalizeCronDeliveryTargets({ targets: [{ id: 'x' }] })[0]?.homeTargetSet).toBe(true);
  });

  it('drops entries without an id and falls back to the id as name', () => {
    const targets = normalizeCronDeliveryTargets({ targets: [{ name: 'nameless' }, { id: 'x' }] });
    expect(targets).toHaveLength(1);
    expect(targets[0]?.name).toBe('x');
  });
});

describe('classifyLogLine', () => {
  it('recognises the levels Hermes actually writes', () => {
    expect(classifyLogLine('2026-07-26 10:23:21,968 WARNING hermes_cli.gateway: x')).toBe('warn');
    expect(classifyLogLine('2026-07-26 10:23:20,110 INFO hermes_cli.plugins: y')).toBe('info');
    expect(classifyLogLine('2026-07-26 10:23:20,110 ERROR boom')).toBe('error');
    expect(classifyLogLine('Traceback (most recent call last):')).toBe('error');
  });

  it('leaves ordinary output unmarked rather than colouring everything', () => {
    expect(classifyLogLine('  File "main.py", line 3')).toBe('plain');
    expect(classifyLogLine('Starting up')).toBe('plain');
  });

  /** "error" late in a message is not a level, and must not raise an alarm. */
  it('only looks at the head of the line', () => {
    const long = `${'x'.repeat(200)} ERROR`;
    expect(classifyLogLine(long)).toBe('plain');
  });
});

describe('toEpochMs', () => {
  /** Hermes reports seconds; passing them through would render 1970. */
  it('scales seconds up to milliseconds', () => {
    expect(toEpochMs(1784312971)).toBe(1784312971000);
  });

  it('leaves millisecond timestamps alone', () => {
    expect(toEpochMs(1784312971425)).toBe(1784312971425);
  });

  it('rejects absent and nonsensical values', () => {
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(0)).toBeNull();
    expect(toEpochMs('nope')).toBeNull();
  });
});

describe('normalizeSessions', () => {
  it('maps the real payload, converting timestamps', () => {
    const result = normalizeSessions({
      total: 25,
      sessions: [
        {
          id: '20260717_182929_d71e4d',
          source: 'cli',
          model: 'hermes-free',
          started_at: 1784312971.425,
          message_count: 12,
          end_reason: null,
        },
      ],
    });

    expect(result.total).toBe(25);
    expect(result.sessions[0]?.startedAt).toBe(1784312971425);
    expect(result.sessions[0]?.messages).toBe(12);
    expect(result.sessions[0]?.title).toBeNull();
  });

  it('keeps the profile a row belongs to, null meaning the launch profile', () => {
    const result = normalizeSessions({
      sessions: [
        { id: 'a', profile_name: null, model: 'hermes-free' },
        { id: 'b', profile_name: 'sunrise', model: 'hermes-free' },
      ],
    });

    expect(result.sessions[0]?.profile).toBeNull();
    expect(result.sessions[1]?.profile).toBe('sunrise');
  });
});

describe('normalizeMcpServers', () => {
  // Trimmed from a real GET /api/mcp/servers. Note the env value: Hermes runs
  // every one through redact_key before answering.
  const real = {
    servers: [
      {
        name: 'context7',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp'],
        env: { CONTEXT7_API_KEY: 'ctx7…9f2a' },
        auth: null,
        enabled: true,
        url: null,
      },
    ],
  };

  it('keeps the fields an edit needs', () => {
    const [server] = normalizeMcpServers(real);

    expect(server?.command).toBe('npx');
    expect(server?.args).toEqual(['-y', '@upstash/context7-mcp']);
    expect(server?.transport).toBe('stdio');
  });

  /**
   * The masked value is kept for display and named so nobody mistakes it for a
   * secret they may write back. Putting it into a save would replace the real
   * API key with the mask.
   */
  it('separates env key names from their masked values', () => {
    const [server] = normalizeMcpServers(real);

    expect(server?.envKeys).toEqual(['CONTEXT7_API_KEY']);
    expect(server?.maskedEnv.CONTEXT7_API_KEY).toBe('ctx7…9f2a');
  });
});

describe('normalizeProfiles', () => {
  // Trimmed from a real GET /api/profiles + GET /api/profiles/active.
  const list = {
    profiles: [
      {
        name: 'sunrise',
        path: '/root/.hermes/profiles/sunrise',
        is_default: false,
        model: 'hermes-free',
        provider: 'custom',
        description: '',
        skill_count: 130,
        gateway_running: true,
      },
      {
        name: 'default',
        path: '/root/.hermes',
        is_default: true,
        model: 'hermes-free',
        provider: 'custom',
        description: '',
        skill_count: 103,
        gateway_running: false,
      },
    ],
  };

  it('maps the real payload and sorts by name', () => {
    const result = normalizeProfiles(list, { active: 'sunrise', current: 'default' });

    expect(result.profiles.map((profile) => profile.name)).toEqual(['default', 'sunrise']);
    expect(result.profiles[0]?.isDefault).toBe(true);
    expect(result.profiles[1]?.skillCount).toBe(130);
    expect(result.profiles[1]?.gatewayRunning).toBe(true);
  });

  it('keeps the sticky profile and the running one apart', () => {
    // They genuinely disagree on this install, and confusing the two would send
    // new conversations to a database the dashboard is not reading.
    const result = normalizeProfiles(list, { active: 'sunrise', current: 'default' });

    expect(result.active).toBe('sunrise');
    expect(result.current).toBe('default');
  });

  it('reports an empty description as absent rather than as a blank line', () => {
    const result = normalizeProfiles(list, {});

    expect(result.profiles[0]?.description).toBeNull();
    expect(result.active).toBeNull();
  });
});

describe('normalizeAnalytics', () => {
  const real = {
    daily: [
      { day: '2026-07-12', input_tokens: 26018455, output_tokens: 143220, estimated_cost: 0 },
    ],
    by_model: [
      {
        model: 'hermes-free',
        input_tokens: 100,
        output_tokens: 50,
        estimated_cost: 0.5,
        api_calls: 7,
      },
    ],
    totals: {
      total_input: 30073124,
      total_output: 208554,
      total_estimated_cost: 1.25,
      total_actual_cost: 0,
      total_sessions: 28,
      total_api_calls: 620,
    },
    tools: [
      { tool: 'bash', count: 40 },
      { tool: 'read', count: 90 },
    ],
    period_days: 30,
  };

  it('reads totals from the real shape', () => {
    const summary = normalizeAnalytics(real);
    expect(summary.totals.inputTokens).toBe(30073124);
    expect(summary.totals.apiCalls).toBe(620);
    expect(summary.periodDays).toBe(30);
  });

  /**
   * Only some providers report a billed amount. Presenting an estimate as if it
   * were the invoice is the kind of small lie that costs trust.
   */
  it('marks the cost as an estimate when no actual cost is reported', () => {
    expect(normalizeAnalytics(real).totals.cost).toBe(1.25);
    expect(normalizeAnalytics(real).totals.costIsEstimate).toBe(true);

    const billed = normalizeAnalytics({
      ...real,
      totals: { ...real.totals, total_actual_cost: 3.5 },
    });
    expect(billed.totals.cost).toBe(3.5);
    expect(billed.totals.costIsEstimate).toBe(false);
  });

  it('sorts tools and models by size', () => {
    expect(normalizeAnalytics(real).topTools[0]?.tool).toBe('read');
    expect(normalizeAnalytics(real).byModel[0]?.tokens).toBe(150);
  });

  it('survives a payload with nothing in it', () => {
    const empty = normalizeAnalytics({});
    expect(empty.daily).toEqual([]);
    expect(empty.totals.cost).toBeNull();
  });
});

describe('normalizeMemory', () => {
  const real = {
    active: '',
    providers: [
      { name: 'holographic', available: true, configured: true, status: 'ready' },
      { name: 'byterover', available: false, configured: true, status: 'unavailable' },
      { name: 'other', available: false, configured: false, status: 'unavailable' },
    ],
    builtin_files: { memory: 879, user: 1106 },
  };

  it('keeps only configured providers and counts the available ones', () => {
    const summary = normalizeMemory(real);
    expect(summary.configured.map((entry) => entry.name)).toEqual(['holographic', 'byterover']);
    expect(summary.availableCount).toBe(1);
  });

  it('reads the built-in file counts', () => {
    expect(normalizeMemory(real).files).toEqual([
      { name: 'memory', entries: 879 },
      { name: 'user', entries: 1106 },
    ]);
  });

  it('lists every provider, usable ones first, and reports no active provider for an empty string', () => {
    const summary = normalizeMemory(real);
    expect(summary.active).toBeNull();
    expect(summary.providers.map((p) => p.name)).toEqual(['holographic', 'byterover', 'other']);
    expect(summary.providers[0]?.available).toBe(true);
  });
});

describe('normalizeSessionMessages', () => {
  // Trimmed from a real /api/sessions/{id}/messages payload.
  const real = {
    session_id: '1438af28793a',
    messages: [
      { role: 'user', content: 'bist du da' },
      { role: 'assistant', content: 'Ja, ich bin da.' },
      { role: 'assistant', content: '' }, // tool-only turn: dropped
      { role: 'tool', content: 'result' }, // internal role: dropped
    ],
  };

  it('keeps user and assistant turns with text, dropping empty and tool turns', () => {
    const messages = normalizeSessionMessages(real);
    expect(messages).toEqual([
      { role: 'user', text: 'bist du da' },
      { role: 'assistant', text: 'Ja, ich bin da.' },
    ]);
  });
});

describe('normalizeModelInfo and normalizeMcpServers', () => {
  it('prefers the effective context length', () => {
    const summary = normalizeModelInfo({
      model: 'hermes-free',
      provider: 'custom',
      auto_context_length: 128000,
      config_context_length: 200000,
      effective_context_length: 256000,
      capabilities: { vision: true, audio: false },
    });

    expect(summary.contextLength).toBe(256000);
    expect(summary.capabilities).toEqual(['vision']);
  });

  it('returns an empty list when no MCP servers are configured', () => {
    expect(normalizeMcpServers({ servers: [] })).toEqual([]);
    expect(normalizeMcpServers({})).toEqual([]);
  });

  it('derives the transport and tool count', () => {
    const [server] = normalizeMcpServers({
      servers: [{ name: 'files', tools: [{}, {}], command: 'npx' }],
    });
    expect(server?.toolCount).toBe(2);
    expect(server?.transport).toBe('stdio');
    expect(server?.enabled).toBe(true);
  });
});

describe('normalizeMessagingPlatforms', () => {
  // Trimmed from a real /api/messaging/platforms on Hermes 0.19.0.
  const real = {
    env_path: '/root/.hermes/profiles/sunrise/.env',
    platforms: [
      {
        id: 'discord',
        name: 'Discord',
        description: 'Run Hermes from Discord.',
        docs_url: 'https://discord.com/developers',
        enabled: false,
        configured: false,
        state: 'disabled',
        env_vars: [{ key: 'DISCORD_BOT_TOKEN', required: true, is_set: false, is_password: true }],
      },
      {
        id: 'telegram',
        name: 'Telegram',
        description: 'Run Hermes from Telegram DMs, groups, and topics.',
        docs_url: 'https://core.telegram.org/bots',
        enabled: false,
        configured: true,
        state: 'disabled',
        // Hermes 0.19 returns an object here, not a bare id.
        home_channel: { platform: 'telegram', chat_id: '170753950', name: 'Home' },
        env_vars: [
          {
            key: 'TELEGRAM_BOT_TOKEN',
            required: true,
            is_set: true,
            redacted_value: '8627...7lkE',
            is_password: true,
          },
          { key: 'TELEGRAM_ALLOWED_USERS', required: false, is_set: false },
        ],
      },
    ],
  };

  it('puts configured platforms ahead of the long tail', () => {
    const { platforms } = normalizeMessagingPlatforms(real);
    expect(platforms.map((p) => p.id)).toEqual(['telegram', 'discord']);
  });

  it('counts the required secrets that are still missing, without exposing any value', () => {
    const { platforms } = normalizeMessagingPlatforms(real);
    const telegram = platforms.find((p) => p.id === 'telegram');
    expect(telegram?.requiredTotal).toBe(1);
    expect(telegram?.requiredMissing).toBe(0);
    // The redacted secret must never survive normalisation.
    expect(JSON.stringify(telegram)).not.toContain('7lkE');
  });

  it('reports counts for the header', () => {
    const overview = normalizeMessagingPlatforms(real);
    expect(overview.configuredCount).toBe(1);
    expect(overview.enabledCount).toBe(0);
  });

  it('reads a home channel from either a bare id or an object', () => {
    const { platforms } = normalizeMessagingPlatforms(real);
    expect(platforms.find((p) => p.id === 'telegram')?.homeChannel).toBe('Home');
    const bare = normalizeMessagingPlatforms({
      platforms: [{ id: 'x', home_channel: '@chan' }],
    });
    expect(bare.platforms[0]?.homeChannel).toBe('@chan');
  });
});

describe('normalizeWebhooks', () => {
  it('reads the enabled flag and base URL from a real payload', () => {
    const overview = normalizeWebhooks({
      enabled: false,
      base_url: 'http://localhost:8644',
      subscriptions: [],
    });
    expect(overview.enabled).toBe(false);
    expect(overview.baseUrl).toBe('http://localhost:8644');
    expect(overview.subscriptions).toEqual([]);
  });
});

describe('normalizePairing', () => {
  // Real /api/pairing: seconds timestamp, one approved Telegram user.
  const real = {
    pending: [],
    approved: [
      {
        platform: 'telegram',
        user_id: '170753950',
        user_name: 'TestUser',
        approved_at: 1784467966.31,
      },
    ],
  };

  it('scales the seconds timestamp to milliseconds', () => {
    const { approved } = normalizePairing(real);
    expect(approved[0]?.userName).toBe('TestUser');
    expect(approved[0]?.at).toBe(Math.round(1784467966.31 * 1000));
  });
});
