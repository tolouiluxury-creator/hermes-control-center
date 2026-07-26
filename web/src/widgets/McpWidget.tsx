import { useQuery } from '@tanstack/react-query';
import { getMcpServers, queryKeys } from '@/lib/api';
import { WidgetState } from './WidgetState';

const CONNECTED = ['connected', 'ok', 'ready', 'running', 'online'];

export function McpWidget() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.mcp,
    queryFn: getMcpServers,
    staleTime: 30_000,
  });

  const servers = data ?? [];

  return (
    <WidgetState
      isPending={isPending}
      error={error}
      isEmpty={servers.length === 0}
      emptyMessage="Keine MCP-Server eingerichtet"
    >
      <ul className="h-full space-y-1.5 overflow-y-auto">
        {servers.map((server) => {
          const connected = server.status ? CONNECTED.includes(server.status.toLowerCase()) : null;
          const color = !server.enabled
            ? 'var(--color-ink-faint)'
            : connected === true
              ? 'var(--color-ok)'
              : connected === false
                ? 'var(--color-danger)'
                : 'var(--color-warn)';

          return (
            <li key={server.name} className="flex items-center gap-2 text-sm">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: color }}
                aria-hidden
              />
              <span className="truncate">{server.name}</span>
              <span className="sr-only">{server.status ?? 'Status unbekannt'}</span>

              {server.transport && (
                <span className="shrink-0 text-[0.65rem] text-[var(--color-ink-faint)]">
                  {server.transport}
                </span>
              )}

              {server.toolCount !== null && (
                <span className="ml-auto shrink-0 font-mono text-xs text-[var(--color-ink-faint)]">
                  {server.toolCount} Tools
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </WidgetState>
  );
}
