import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Server, Trash2 } from 'lucide-react';
import { deleteMcpServer, getMcpServers, queryKeys, setMcpEnabled, testMcpServer } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';

const CONNECTED = ['connected', 'ok', 'ready', 'running', 'online'];

export function McpPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.mcp,
    queryFn: getMcpServers,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.mcp });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      setMcpEnabled(name, enabled),
    onSuccess: async (_r, variables) => {
      await invalidate();
      toast.push({
        tone: 'success',
        title: variables.enabled
          ? `„${variables.name}" aktiviert`
          : `„${variables.name}" deaktiviert`,
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Umschalten fehlgeschlagen', description: e.message }),
  });

  const test = useMutation({
    mutationFn: (name: string) => testMcpServer(name),
    onSuccess: (result, name) =>
      toast.push({
        tone: result.ok ? 'success' : 'warning',
        title: `Test: ${name}`,
        description:
          result.message ?? result.state ?? (result.ok ? 'Erreichbar' : 'Nicht erreichbar'),
      }),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Test fehlgeschlagen', description: e.message }),
  });

  const remove = useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: 'Server entfernt' });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Entfernen fehlgeschlagen', description: e.message }),
  });

  const busy = (name: string) =>
    (toggle.isPending && toggle.variables?.name === name) ||
    (test.isPending && test.variables === name) ||
    (remove.isPending && remove.variables === name);

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
            const disabled = busy(server.name);

            return (
              <li key={server.name} className="card p-4">
                <div className="flex items-center gap-3">
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
                    <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                      {server.toolCount} Werkzeuge
                    </span>
                  )}

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => test.mutate(server.name)}
                      disabled={disabled}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
                    >
                      Testen
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ name: server.name, enabled: !server.enabled })}
                      disabled={disabled}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                    >
                      {server.enabled ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(server.name)}
                      disabled={disabled}
                      aria-label={`${server.name} entfernen`}
                      title="Entfernen"
                      className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>

                {confirmDelete === server.name && (
                  <ConfirmInline
                    tone="danger"
                    message={<>„{server.name}" entfernen? Der Agent verliert dessen Werkzeuge.</>}
                    confirmLabel="Entfernen"
                    pending={remove.isPending && remove.variables === server.name}
                    onConfirm={() => remove.mutate(server.name)}
                    onCancel={() => setConfirmDelete(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
