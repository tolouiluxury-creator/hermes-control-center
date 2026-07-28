import type { AgentSummary, HostMetrics, ReadinessCheck } from './hermes/normalize.js';
import type {
  AnalyticsSummary,
  CronJobSummary,
  LogLine,
  MemorySummary,
  SkillSummary,
} from './hermes/inventory.js';

/**
 * Rule-based observations over data the control center already collects.
 *
 * Deliberately not a language model. Every insight is a deterministic rule with
 * the numbers that triggered it attached, so a reader can check the reasoning
 * instead of trusting it. Calling this "AI" would be the easy lie; it is a set
 * of checks, and the UI says so.
 *
 * A rule earns its place only if it is actionable. "CPU is at 40%" is not an
 * insight, it is a gauge.
 */

export type InsightSeverity = 'info' | 'warn' | 'critical';

/**
 * One row of the numbers behind a verdict.
 *
 * A label is either our own copy (`labelKey`, translated in the browser) or a
 * name that came from Hermes — a component, a job — which is data and stays
 * verbatim. The same split applies to the value.
 */
export interface InsightEvidence {
  labelKey?: string;
  label?: string;
  valueKey?: string;
  value?: string | number;
}

export interface Insight {
  /** Stable across runs so dismissals can stick. */
  id: string;
  severity: InsightSeverity;
  /**
   * Dictionary keys, not sentences. The interface language is a per-device
   * browser preference, so the server has no business choosing the wording —
   * it reports what it found and lets the browser say it.
   */
  titleKey: string;
  bodyKey: string;
  /** Interpolation values for the title and body. */
  params: Record<string, string | number>;
  /** The numbers behind the verdict, shown so the rule can be checked. */
  evidence: InsightEvidence[];
  /** A command the user can run, when one exists. */
  action?: string;
}

export interface InsightInput {
  host: HostMetrics | null;
  agent: AgentSummary | null;
  readiness: ReadinessCheck[];
  apiServerReachable: boolean;
  logs: LogLine[] | null;
  skills: SkillSummary | null;
  analytics: AnalyticsSummary | null;
  cron: CronJobSummary[] | null;
  memory: MemorySummary | null;
}

const DISK_WARN = 80;
const DISK_CRITICAL = 92;
const MEMORY_WARN = 90;
/** Below this share of errors, a few stack traces in a long log are just noise. */
const LOG_ERROR_SHARE_WARN = 0.05;

export function deriveInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];

  // --- Storage and memory ---------------------------------------------------

  const disk = input.host?.diskPercent;
  if (disk !== null && disk !== undefined && disk >= DISK_WARN) {
    insights.push({
      id: 'disk-pressure',
      severity: disk >= DISK_CRITICAL ? 'critical' : 'warn',
      titleKey: 'insight.disk.title',
      bodyKey: disk >= DISK_CRITICAL ? 'insight.disk.bodyCritical' : 'insight.disk.body',
      params: { percent: Math.round(disk) },
      evidence: [{ labelKey: 'insight.used', value: `${disk.toFixed(1)} %` }],
    });
  }

  const memory = input.host?.memoryPercent;
  if (memory !== null && memory !== undefined && memory >= MEMORY_WARN) {
    insights.push({
      id: 'memory-pressure',
      severity: 'warn',
      titleKey: 'insight.memory.title',
      bodyKey: 'insight.memory.body',
      params: { percent: Math.round(memory) },
      evidence: [{ labelKey: 'insight.used', value: `${memory.toFixed(1)} %` }],
    });
  }

  // --- Agent health ---------------------------------------------------------

  if (input.agent && input.agent.gatewayRunning === false) {
    insights.push({
      id: 'gateway-stopped',
      severity: 'critical',
      titleKey: 'insight.gateway.title',
      bodyKey: input.agent.gatewayExitReason
        ? 'insight.gateway.bodyWithReason'
        : 'insight.gateway.body',
      params: { reason: input.agent.gatewayExitReason ?? '' },
      evidence: [
        input.agent.gatewayState
          ? { labelKey: 'insight.gateway.state', value: input.agent.gatewayState }
          : { labelKey: 'insight.gateway.state', valueKey: 'insight.unknown' },
      ],
      action: 'hermes gateway',
    });
  }

  const failing = input.readiness.filter((check) => check.ok === false);
  if (failing.length > 0) {
    insights.push({
      id: 'components-failing',
      severity: 'critical',
      titleKey:
        failing.length === 1 ? 'insight.components.titleOne' : 'insight.components.titleMany',
      bodyKey: 'insight.components.body',
      params: { name: failing[0]?.name ?? '', count: failing.length },
      evidence: failing.map((check) =>
        check.detail
          ? { label: check.name, value: check.detail }
          : { label: check.name, valueKey: 'insight.error' },
      ),
    });
  }

  if (!input.apiServerReachable) {
    insights.push({
      id: 'api-server-off',
      severity: 'info',
      titleKey: 'insight.apiServer.title',
      bodyKey: 'insight.apiServer.body',
      params: {},
      evidence: [],
      action: 'hermes gateway restart',
    });
  }

  // --- Logs -----------------------------------------------------------------

  if (input.logs && input.logs.length > 0) {
    const errors = input.logs.filter((line) => line.level === 'error');

    // Timestamps differ on every line, so they are stripped before comparing.
    const signatures = new Map<string, number>();
    for (const line of errors) {
      const signature = line.text.replace(/^[\d\-:, ]+/, '').slice(0, 60);
      signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    }
    const [topSignature = '', topCount = 0] =
      [...signatures.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

    /*
     * Two independent triggers, and the repetition one must not be gated behind
     * the share. A service failing to start every twenty seconds produced only
     * 3.5% of the lines in a real log — under any sensible share threshold, yet
     * it is the single most important thing in that file. A loop is a loop even
     * when it is quiet.
     */
    const repeating = topCount >= 3 && topCount >= errors.length * 0.6;
    const widespread = errors.length / input.logs.length >= LOG_ERROR_SHARE_WARN;

    if (repeating || widespread) {
      insights.push({
        id: 'log-errors',
        severity: repeating ? 'warn' : 'info',
        titleKey: repeating ? 'insight.logs.titleRepeating' : 'insight.logs.titleWidespread',
        bodyKey: repeating ? 'insight.logs.bodyRepeating' : 'insight.logs.bodyWidespread',
        params: { repeats: topCount, errors: errors.length },
        evidence: [
          { labelKey: 'insight.logs.errorLines', value: errors.length },
          { labelKey: 'insight.logs.checkedLines', value: input.logs.length },
          ...(repeating
            ? [
                { labelKey: 'insight.logs.message', value: topSignature.trim() },
                { labelKey: 'insight.logs.repeats', value: topCount },
              ]
            : []),
        ],
      });
    }
  }

  // --- Housekeeping ---------------------------------------------------------

  if (input.skills && input.skills.total > 0) {
    const used = input.skills.top.filter((skill) => skill.usage > 0).length;
    if (used === 0) {
      insights.push({
        id: 'skills-unused',
        severity: 'info',
        titleKey: 'insight.skills.title',
        bodyKey: 'insight.skills.body',
        params: { count: input.skills.total },
        evidence: [{ labelKey: 'insight.skills.installed', value: input.skills.total }],
      });
    }
  }

  if (input.memory && input.memory.configured.length === 0 && input.memory.availableCount === 0) {
    insights.push({
      id: 'memory-provider-missing',
      severity: 'info',
      titleKey: 'insight.memoryProvider.title',
      bodyKey: 'insight.memoryProvider.body',
      params: {},
      evidence: [],
    });
  }

  const paused = (input.cron ?? []).filter((job) => job.paused);
  if (paused.length > 0) {
    insights.push({
      id: 'cron-paused',
      severity: 'info',
      titleKey: paused.length === 1 ? 'insight.cron.titleOne' : 'insight.cron.titleMany',
      bodyKey: 'insight.cron.body',
      params: { count: paused.length },
      evidence: paused
        .slice(0, 5)
        .map((job) => ({ label: job.name, valueKey: 'insight.cron.pausedValue' })),
    });
  }

  // --- Cost -----------------------------------------------------------------

  const daily = input.analytics?.daily ?? [];
  if (daily.length >= 6) {
    const recent = daily.slice(-3);
    const earlier = daily.slice(-6, -3);
    const sum = (entries: typeof daily): number =>
      entries.reduce((total, entry) => total + entry.inputTokens + entry.outputTokens, 0);

    const recentTokens = sum(recent);
    const earlierTokens = sum(earlier);

    // Only worth mentioning if the base was meaningful; doubling from nearly
    // nothing is not news.
    if (earlierTokens > 10_000 && recentTokens > earlierTokens * 2) {
      insights.push({
        id: 'token-spike',
        severity: 'info',
        titleKey: 'insight.tokenSpike.title',
        bodyKey: 'insight.tokenSpike.body',
        params: {},
        // Raw numbers: the browser knows the locale, so it does the grouping.
        evidence: [
          { labelKey: 'insight.tokenSpike.recent', value: recentTokens },
          { labelKey: 'insight.tokenSpike.earlier', value: earlierTokens },
        ],
      });
    }
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warn: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
