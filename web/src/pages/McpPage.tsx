import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Server, Trash2 } from 'lucide-react';
import { deleteMcpServer, getMcpServers, queryKeys, setMcpEnabled, testMcpServer } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

const CONNECTED = ['connected', 'ok', 'ready', 'running', 'online'];

export function McpPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
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
          ? t('skills.enabledToast', { name: variables.name })
          : t('skills.disabledToast', { name: variables.name }),
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.toggleFailed'), description: e.message }),
  });

  const test = useMutation({
    mutationFn: (name: string) => testMcpServer(name),
    onSuccess: (result, name) =>
      toast.push({
        tone: result.ok ? 'success' : 'warning',
        title: t('mcp.test', { name }),
        description:
          result.message ??
          result.state ??
          (result.ok ? t('label.reachable') : t('label.unreachable')),
      }),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.testFailed'), description: e.message }),
  });

  const remove = useMutation({
    mutationFn: deleteMcpServer,
    onSuccess: async () => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: t('common.remove') });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('toast.removeFailed'), description: e.message }),
  });

  const busy = (name: string) =>
    (toggle.isPending && toggle.variables?.name === name) ||
    (test.isPending && test.variables === name) ||
    (remove.isPending && remove.variables === name);

  const servers = data ?? [];

  return (
    <PageShell title={t('nav.mcp')} description={t('page.mcp.desc')}>
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
          <p className="mt-4 text-sm font-medium">{t('mcp.empty.title')}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            {t('mcp.empty.desc')}
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
                      {server.status ?? t('label.statusUnknown')}
                      {server.transport && ` · ${server.transport}`}
                      {!server.enabled && ` · ${t('common.disabled')}`}
                    </p>
                  </div>
                  {server.toolCount !== null && (
                    <span className="shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                      {t('mcp.tools', { count: server.toolCount })}
                    </span>
                  )}

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => test.mutate(server.name)}
                      disabled={disabled}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
                    >
                      {t('common.test')}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle.mutate({ name: server.name, enabled: !server.enabled })}
                      disabled={disabled}
                      className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                    >
                      {server.enabled ? t('common.disable') : t('common.enable')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(server.name)}
                      disabled={disabled}
                      aria-label={t('common.remove')}
                      title={t('common.remove')}
                      className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                </div>

                {confirmDelete === server.name && (
                  <ConfirmInline
                    tone="danger"
                    message={t('mcp.removeConfirm', { name: server.name })}
                    confirmLabel={t('common.remove')}
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
