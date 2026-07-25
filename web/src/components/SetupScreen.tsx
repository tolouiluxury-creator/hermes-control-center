import { useState } from 'react';
import { AlertTriangle, Check, Copy, RefreshCw, Terminal } from 'lucide-react';
import type { StatusSnapshot } from '@/lib/types';

interface SetupStep {
  id: string;
  title: string;
  done: boolean;
  explanation: string;
  commands: string[];
}

function buildSteps(snapshot: StatusSnapshot): SetupStep[] {
  const { apiServer, dashboard, connection } = snapshot;

  return [
    {
      id: 'dashboard',
      title: 'Hermes-Dashboard starten',
      done: dashboard.reachable,
      explanation:
        'Liefert Konfiguration, Skills, MCP-Server, Modelle, Cron-Jobs, Logs und Systemmetriken. ' +
        `Erwartet unter ${dashboard.url}.`,
      commands: [
        'cd ~/.hermes/hermes-agent && uv pip install -e ".[web]"',
        'hermes dashboard --no-open',
      ],
    },
    {
      id: 'api-key',
      title: 'API-Server-Key setzen',
      done: apiServer.hasKey,
      explanation:
        'Ohne Key bleiben Chat, Sessions und Runs gesperrt. Der Key wird aus deiner Hermes-Konfiguration ' +
        'gelesen und verlässt den Server nie.',
      commands: [
        '# in ~/.hermes/.env',
        'API_SERVER_ENABLED=true',
        'API_SERVER_KEY=ein-langer-zufaelliger-string',
      ],
    },
    {
      id: 'api-server',
      title: 'Hermes-Gateway starten',
      done: apiServer.reachable,
      explanation: `Stellt den API-Server bereit (erwartet unter ${apiServer.url}).`,
      commands: ['hermes gateway'],
    },
  ].filter((step) => !step.done || connection.warnings.length > 0);
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const isComment = command.trimStart().startsWith('#');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard denied (non-secure context): the text stays selectable.
    }
  };

  return (
    <div className="group flex items-center gap-2">
      <code
        className={`flex-1 overflow-x-auto rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs whitespace-pre ${
          isComment ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-ink)]'
        }`}
      >
        {command}
      </code>
      {!isComment && (
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-lg border border-[var(--color-hairline)] p-2 text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
          aria-label={copied ? 'Kopiert' : `Befehl kopieren: ${command}`}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
      )}
    </div>
  );
}

/**
 * Shown when at least one Hermes surface is missing. It never blocks the app —
 * whatever already works stays usable — and it states exactly what is wrong plus
 * the command that fixes it, rather than a generic error.
 */
export function SetupScreen({
  snapshot,
  onRetry,
  retrying,
}: {
  snapshot: StatusSnapshot;
  onRetry: () => void;
  retrying: boolean;
}) {
  const steps = buildSteps(snapshot);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
          Einrichtung
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Hermes ist noch nicht vollständig verbunden
        </h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          Das Control Center läuft. Es braucht zwei Hermes-Oberflächen — was schon erreichbar ist,
          funktioniert bereits.
        </p>
      </header>

      <ol className="space-y-4">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="rounded-2xl border border-[var(--color-hairline)] p-5"
            style={{ background: 'var(--glass-bg)', boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  step.done
                    ? 'bg-[var(--color-ok)]/15 text-[var(--color-ok)]'
                    : 'bg-[var(--color-warn)]/15 text-[var(--color-warn)]'
                }`}
                aria-hidden
              >
                {step.done ? <Check size={13} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">
                  {step.title}
                  <span className="sr-only">{step.done ? ' (erledigt)' : ' (offen)'}</span>
                </h2>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{step.explanation}</p>
                <div className="mt-3 space-y-2">
                  {step.commands.map((command) => (
                    <CommandBlock key={command} command={command} />
                  ))}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {snapshot.connection.warnings.length > 0 && (
        <section className="mt-6 rounded-2xl border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-warn)]">
            <AlertTriangle size={15} aria-hidden />
            Hinweise aus deiner Hermes-Konfiguration
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-ink-muted)]">
            {snapshot.connection.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
        >
          <RefreshCw size={14} className={retrying ? 'animate-spin' : undefined} aria-hidden />
          Erneut prüfen
        </button>
        <p className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
          <Terminal size={13} aria-hidden />
          Ausführlicher Bericht im Terminal: <code>npx hermes-control-center --doctor</code>
        </p>
      </footer>
    </div>
  );
}
