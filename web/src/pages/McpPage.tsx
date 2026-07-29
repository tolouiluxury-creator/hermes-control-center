import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Server, Trash2 } from 'lucide-react';
import {
  createMcpServer,
  deleteMcpServer,
  getMcpServers,
  queryKeys,
  setMcpEnabled,
  testMcpServer,
  updateMcpServer,
} from '@/lib/api';
import type { McpServerSummary } from '@/lib/hermesTypes';
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
  /** `null` = closed, `''` = adding a new server, otherwise the name being edited. */
  const [editing, setEditing] = useState<string | null>(null);

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

  const save = useMutation({
    mutationFn: (draft: ServerDraft) =>
      draft.isNew
        ? createMcpServer({
            name: draft.name,
            url: draft.transport === 'http' ? draft.url : undefined,
            command: draft.transport === 'stdio' ? draft.command : undefined,
            args: splitArgs(draft.args),
            env: parseEnv(draft.env),
          })
        : updateMcpServer(draft.name, {
            ...(draft.transport === 'http' ? { url: draft.url } : { command: draft.command }),
            args: splitArgs(draft.args),
            // Only variables the user actually typed travel; the rest keep the
            // real values this page is never allowed to see.
            ...(Object.keys(parseEnv(draft.env)).length > 0 ? { env: parseEnv(draft.env) } : {}),
          }),
    onSuccess: async (_r, draft) => {
      setEditing(null);
      await invalidate();
      toast.push({
        tone: 'success',
        title: draft.isNew
          ? t('mcp.added', { name: draft.name })
          : t('mcp.saved', { name: draft.name }),
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: t('mcp.saveFailed'), description: e.message }),
  });

  const busy = (name: string) =>
    (toggle.isPending && toggle.variables?.name === name) ||
    (test.isPending && test.variables === name) ||
    (remove.isPending && remove.variables === name);

  const servers = data ?? [];

  return (
    <PageShell
      title={t('nav.mcp')}
      description={t('page.mcp.desc')}
      actions={
        <button
          type="button"
          onClick={() => setEditing('')}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
        >
          <Plus size={14} aria-hidden />
          {t('mcp.new')}
        </button>
      }
    >
      {editing === '' && (
        <ServerForm
          server={null}
          pending={save.isPending}
          onSave={(draft) => save.mutate(draft)}
          onCancel={() => setEditing(null)}
        />
      )}

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
                      onClick={() => setEditing(server.name)}
                      disabled={disabled}
                      aria-label={t('common.edit')}
                      title={t('common.edit')}
                      className="rounded-lg p-1.5 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                    >
                      <Pencil size={14} aria-hidden />
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

                {editing === server.name && (
                  <ServerForm
                    server={server}
                    pending={save.isPending}
                    onSave={(draft) => save.mutate(draft)}
                    onCancel={() => setEditing(null)}
                  />
                )}

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

interface ServerDraft {
  isNew: boolean;
  name: string;
  transport: 'http' | 'stdio';
  url: string;
  command: string;
  args: string;
  env: string;
}

/** Splits a command line into arguments. Quotes are honoured, nothing else. */
function splitArgs(raw: string): string[] {
  return (raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) => part.replace(/^["']|["']$/g, ''));
}

/** Reads `KEY=value` lines. Blank lines and lines without `=` are skipped. */
function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key !== '') out[key] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * Add or change one MCP server.
 *
 * The environment box is deliberately empty when editing, and says why. Hermes
 * masks every env value it returns, so pre-filling the box would put `sk-…abcd`
 * in front of the user and save that string over their real key the moment they
 * pressed save. Existing variables are listed above it, read-only; typing a
 * `KEY=value` line replaces exactly that one and leaves the rest alone.
 */
function ServerForm({
  server,
  pending,
  onSave,
  onCancel,
}: {
  server: McpServerSummary | null;
  pending: boolean;
  onSave: (draft: ServerDraft) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ServerDraft>(() => ({
    isNew: server === null,
    name: server?.name ?? '',
    transport: server?.transport === 'stdio' ? 'stdio' : server ? 'http' : 'http',
    url: server?.url ?? '',
    command: server?.command ?? '',
    args: (server?.args ?? []).join(' '),
    env: '',
  }));

  const nameOk = /^[A-Za-z0-9._-]+$/.test(draft.name);
  const targetOk =
    draft.transport === 'http' ? draft.url.trim() !== '' : draft.command.trim() !== '';

  return (
    <section className="mt-3 space-y-3 rounded-xl border border-[var(--color-hairline)] p-4">
      {draft.isNew && (
        <label className="block">
          <span className="text-xs text-[var(--color-ink-faint)]">{t('mcp.name')}</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="context7"
            className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
          {draft.name !== '' && !nameOk && (
            <span className="mt-1 block text-xs text-[var(--color-danger)]">
              {t('mcp.nameInvalid')}
            </span>
          )}
        </label>
      )}

      <div className="flex gap-2">
        {(['http', 'stdio'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setDraft({ ...draft, transport: mode })}
            aria-pressed={draft.transport === mode}
            className={`rounded-lg border px-3 py-1 text-xs transition-colors ${
              draft.transport === mode
                ? 'border-[var(--color-accent)]/40 text-[var(--color-accent)]'
                : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)]'
            }`}
          >
            {mode === 'http' ? t('mcp.overHttp') : t('mcp.overCommand')}
          </button>
        ))}
      </div>

      {draft.transport === 'http' ? (
        <label className="block">
          <span className="text-xs text-[var(--color-ink-faint)]">{t('mcp.url')}</span>
          <input
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            placeholder="https://example.com/mcp"
            className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
          />
        </label>
      ) : (
        <>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-faint)]">{t('mcp.command')}</span>
            <input
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
              placeholder="npx"
              className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-ink-faint)]">{t('mcp.args')}</span>
            <input
              value={draft.args}
              onChange={(event) => setDraft({ ...draft, args: event.target.value })}
              placeholder="-y @upstash/context7-mcp"
              className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
            />
          </label>
        </>
      )}

      {server && server.envKeys.length > 0 && (
        <div>
          <p className="text-xs text-[var(--color-ink-faint)]">{t('mcp.envExisting')}</p>
          <ul className="mt-1 space-y-0.5">
            {server.envKeys.map((key) => (
              <li key={key} className="font-mono text-xs text-[var(--color-ink-muted)]">
                {key} ={' '}
                <span className="text-[var(--color-ink-faint)]">{server.maskedEnv[key]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="block">
        <span className="text-xs text-[var(--color-ink-faint)]">{t('mcp.env')}</span>
        <textarea
          value={draft.env}
          onChange={(event) => setDraft({ ...draft, env: event.target.value })}
          rows={3}
          spellCheck={false}
          placeholder={'API_KEY=…'}
          className="mt-1 w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
        />
        <span className="mt-1 block text-xs text-[var(--color-ink-faint)]">
          {draft.isNew ? t('mcp.envHintNew') : t('mcp.envHintEdit')}
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !nameOk || !targetOk}
          onClick={() => onSave(draft)}
          className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:opacity-40"
        >
          {pending ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </section>
  );
}
