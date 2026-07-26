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

export interface Insight {
  /** Stable across runs so dismissals can stick. */
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** The numbers behind the verdict, shown so the rule can be checked. */
  evidence: Record<string, string | number>;
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
      title: `Speicherplatz zu ${Math.round(disk)} % belegt`,
      body:
        disk >= DISK_CRITICAL
          ? 'Wenn die Platte volläuft, kann Hermes weder Sitzungen noch Logs schreiben.'
          : 'Noch unkritisch, aber der Trend ist einen Blick wert.',
      evidence: { belegt: `${disk.toFixed(1)} %` },
    });
  }

  const memory = input.host?.memoryPercent;
  if (memory !== null && memory !== undefined && memory >= MEMORY_WARN) {
    insights.push({
      id: 'memory-pressure',
      severity: 'warn',
      title: `Arbeitsspeicher zu ${Math.round(memory)} % belegt`,
      body: 'Bei anhaltendem Druck beendet der Kernel Prozesse — auch den Agenten.',
      evidence: { belegt: `${memory.toFixed(1)} %` },
    });
  }

  // --- Agent health ---------------------------------------------------------

  if (input.agent && input.agent.gatewayRunning === false) {
    insights.push({
      id: 'gateway-stopped',
      severity: 'critical',
      title: 'Das Gateway läuft nicht',
      body:
        'Ohne Gateway erreichen dich keine Nachrichten über Telegram, Discord oder die anderen Plattformen.' +
        (input.agent.gatewayExitReason
          ? ` Zuletzt gemeldet: ${input.agent.gatewayExitReason}`
          : ''),
      evidence: { Zustand: input.agent.gatewayState ?? 'unbekannt' },
      action: 'hermes gateway',
    });
  }

  const failing = input.readiness.filter((check) => check.ok === false);
  if (failing.length > 0) {
    insights.push({
      id: 'components-failing',
      severity: 'critical',
      title:
        failing.length === 1
          ? `Komponente „${failing[0]?.name}" meldet einen Fehler`
          : `${failing.length} Komponenten melden Fehler`,
      body: 'Hermes meldet diese Teile selbst als defekt.',
      evidence: Object.fromEntries(failing.map((check) => [check.name, check.detail ?? 'Fehler'])),
    });
  }

  if (!input.apiServerReachable) {
    insights.push({
      id: 'api-server-off',
      severity: 'info',
      title: 'Der API-Server ist nicht aktiv',
      body:
        'Chat, Sitzungen und Agent-Runs bleiben dadurch gesperrt. Alles andere funktioniert. ' +
        'Aktivieren heißt: API_SERVER_ENABLED und API_SERVER_KEY in ~/.hermes/.env setzen und das Gateway neu starten.',
      evidence: {},
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
        title: repeating
          ? `Ein Fehler wiederholt sich ${topCount}× im Log`
          : `${errors.length} Fehlerzeilen im aktuellen Log`,
        body: repeating
          ? 'Dieselbe Meldung immer wieder deutet auf einen Neustart-Kreislauf hin, nicht auf einen Einzelfall.'
          : 'Verteilte Fehler ohne erkennbares Muster.',
        evidence: {
          Fehlerzeilen: errors.length,
          'geprüfte Zeilen': input.logs.length,
          ...(repeating ? { Meldung: topSignature.trim(), Wiederholungen: topCount } : {}),
        },
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
        title: `${input.skills.total} Skills installiert, keiner davon genutzt`,
        body: 'Skills kosten Kontextfenster. Was nie zum Einsatz kommt, kann deaktiviert werden.',
        evidence: { installiert: input.skills.total },
      });
    }
  }

  if (input.memory && input.memory.configured.length === 0 && input.memory.availableCount === 0) {
    insights.push({
      id: 'memory-provider-missing',
      severity: 'info',
      title: 'Kein Speicher-Anbieter eingerichtet',
      body: 'Hermes nutzt nur seine eingebauten Dateien. Für dauerhaftes Wissen über Sitzungen hinweg braucht es einen Anbieter.',
      evidence: {},
    });
  }

  const paused = (input.cron ?? []).filter((job) => job.paused);
  if (paused.length > 0) {
    insights.push({
      id: 'cron-paused',
      severity: 'info',
      title: paused.length === 1 ? 'Ein Job ist pausiert' : `${paused.length} Jobs sind pausiert`,
      body: 'Pausierte Jobs laufen nicht wieder an, bis sie fortgesetzt werden.',
      evidence: Object.fromEntries(paused.slice(0, 5).map((job) => [job.name, 'pausiert'])),
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
        title: 'Der Tokenverbrauch hat sich mehr als verdoppelt',
        body: 'Die letzten drei Tage im Vergleich zu den drei davor.',
        evidence: {
          'letzte 3 Tage': recentTokens.toLocaleString('de'),
          davor: earlierTokens.toLocaleString('de'),
        },
      });
    }
  }

  const order: Record<InsightSeverity, number> = { critical: 0, warn: 1, info: 2 };
  return insights.sort((a, b) => order[a.severity] - order[b.severity]);
}
