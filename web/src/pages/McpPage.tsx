import { useQuery } from '@tanstack/react-query';
import { Server } from 'lucide-react';
import { getMcpServers, queryKeys } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';

const CONNECTED = ['connected', 'ok', 'ready', 'running', 'online'];

export function McpPage() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.mcp,
    queryFn: getMcpServers,
    staleTime: 30_000,
  });

  const servers = data ?? [];

  return (
    <PageShell
      title="MCP-Server"
      description="Über das Model Context Protocol angebundene Werkzeugserver. Jeder Server bringt deinem Agenten zusätzliche Werkzeuge bei."
    >
      {isPending ? (
        <SkeletonText lines={6} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : servers.length === 0 ? (
        <div className="card p-10 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
            aria-hidden
          >
            <Server size={22} />
          </span>
          <p className="mt-4 text-sm font-medium">Keine MCP-Server eingerichtet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            Auf deinem Hermes ist derzeit kein MCP-Server konfiguriert. Eingerichtet werden sie in
            der Hermes-Konfiguration unter <code className="font-mono">mcpServers</code>; hier
            erscheinen sie dann mit Status und Werkzeugliste.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {servers.map((server) => {
            const connected = server.status
              ? CONNECTED.includes(server.status.toLowerCase())
              : null;

            return (
              <li key={server.name} className="card flex items-center gap-3 p-4">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    background: !server.enabled
                      ? 'var(--color-ink-faint)'
                      : connected === true
                        ? 'var(--color-ok)'
                        : connected === false
                          ? 'var(--color-danger)'
                          : 'var(--color-warn)',
                  }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{server.name}</p>
                  <p className="text-xs text-[var(--color-ink-faint)]">
                    {server.status ?? 'Status unbekannt'}
                    {server.transport && ` · ${server.transport}`}
                    {!server.enabled && ' · deaktiviert'}
                  </p>
                </div>
                {server.toolCount !== null && (
                  <span className="shrink-0 font-mono text-sm text-[var(--color-ink-muted)]">
                    {server.toolCount} Werkzeuge
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
