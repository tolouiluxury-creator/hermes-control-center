import { useStatus } from '@/lib/useStatus';
import { formatDuration } from '@/lib/format';

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline)] py-1.5 last:border-b-0">
      <dt className="shrink-0 text-xs text-[var(--color-ink-faint)]">{label}</dt>
      <dd
        className="truncate font-mono text-sm"
        style={tone ? { color: tone } : undefined}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Facts about the agent itself. `gatewayState` is preferred over the boolean
 * because "stopped" says more than "not running", and the exit reason explains
 * why when there is one.
 */
export function AgentWidget() {
  const { data: snapshot } = useStatus();
  const agent = snapshot?.agent;

  if (!agent) return null;

  const running = agent.gatewayRunning === true;
  const state = agent.gatewayState ?? (running ? 'running' : 'unbekannt');

  return (
    <dl className="h-full overflow-y-auto">
      <Row label="Hermes" value={agent.version ?? '—'} />
      <Row label="Gateway" value={state} tone={running ? 'var(--color-ok)' : 'var(--color-warn)'} />
      {agent.gatewayExitReason && <Row label="Grund" value={agent.gatewayExitReason} />}
      <Row label="Sitzungen" value={agent.activeSessions?.toString() ?? '—'} />
      <Row
        label="Profile"
        value={agent.profiles.length > 0 ? agent.profiles.join(', ') : (agent.profile ?? '—')}
      />
      <Row label="Uptime" value={formatDuration(snapshot?.host?.uptimeSeconds)} />
      {snapshot?.host?.os && <Row label="System" value={snapshot.host.os} />}
    </dl>
  );
}
