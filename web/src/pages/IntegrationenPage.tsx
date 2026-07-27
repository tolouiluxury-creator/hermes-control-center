import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plug, Users, Webhook } from 'lucide-react';
import {
  getMessaging,
  getPairing,
  getWebhooks,
  queryKeys,
  setPlatformEnabled,
  testPlatform,
} from '@/lib/api';
import { FilterChips, PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { formatRelativeTime } from '@/lib/format';
import type { MessagingPlatform } from '@/lib/hermesTypes';

/** A coarse colour for a platform's connection state; unknown states stay neutral. */
function stateColor(platform: MessagingPlatform): string {
  if (platform.errorMessage) return 'var(--color-danger)';
  if (platform.enabled) return 'var(--color-ok)';
  if (platform.configured) return 'var(--color-warn)';
  return 'var(--color-ink-faint)';
}

const STATE_LABEL: Record<string, string> = {
  connected: 'verbunden',
  disabled: 'deaktiviert',
  connecting: 'verbindet',
  error: 'Fehler',
  disconnected: 'getrennt',
};

function PlatformCard({
  platform,
  confirming,
  pending,
  onToggle,
  onConfirm,
  onCancel,
  onTest,
}: {
  platform: MessagingPlatform;
  confirming: boolean;
  pending: boolean;
  onToggle: (id: string) => void;
  onConfirm: (platform: MessagingPlatform) => void;
  onCancel: () => void;
  onTest: (id: string) => void;
}) {
  const color = stateColor(platform);
  // Only a configured platform can be started or tested — an unconfigured one
  // has no credentials, so its actions would only ever fail.
  const canAct = platform.configured;

  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <span
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium">{platform.name}</span>
            {platform.enabled ? (
              <span className="text-[0.65rem] text-[var(--color-ok)]">aktiv</span>
            ) : platform.configured ? (
              <span className="text-[0.65rem] text-[var(--color-warn)]">eingerichtet</span>
            ) : null}
            {platform.state && (
              <span className="text-[0.65rem] text-[var(--color-ink-faint)]">
                {STATE_LABEL[platform.state] ?? platform.state}
              </span>
            )}
          </div>
          {platform.description && (
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{platform.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem]">
            {platform.configured && platform.requiredMissing > 0 && (
              <span className="text-[var(--color-warn)]">
                {platform.requiredMissing} von {platform.requiredTotal} Pflichtangaben fehlen
              </span>
            )}
            {platform.errorMessage && (
              <span className="text-[var(--color-danger)]">{platform.errorMessage}</span>
            )}
            {platform.homeChannel && (
              <span className="text-[var(--color-ink-faint)]">Kanal: {platform.homeChannel}</span>
            )}
            {platform.docsUrl && (
              <a
                href={platform.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
              >
                Doku
                <ExternalLink size={10} aria-hidden />
              </a>
            )}
          </div>
        </div>

        {canAct && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => onTest(platform.id)}
              disabled={pending}
              className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
            >
              Testen
            </button>
            <button
              type="button"
              onClick={() => onToggle(platform.id)}
              disabled={pending}
              className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
            >
              {platform.enabled ? 'Deaktivieren' : 'Aktivieren'}
            </button>
          </div>
        )}
      </div>

      {confirming && (
        <ConfirmInline
          tone="warn"
          message={
            platform.enabled ? (
              <>
                „{platform.name}" deaktivieren? Der Kanal geht offline und empfängt keine
                Nachrichten mehr.
              </>
            ) : (
              <>„{platform.name}" aktivieren? Der Kanal geht online, sobald das Gateway neu lädt.</>
            )
          }
          confirmLabel={platform.enabled ? 'Deaktivieren' : 'Aktivieren'}
          pending={pending}
          onConfirm={() => onConfirm(platform)}
          onCancel={onCancel}
        />
      )}
    </li>
  );
}

function MessagingSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [scope, setScope] = useState<'eingerichtet' | 'alle'>('eingerichtet');
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.messaging,
    queryFn: getMessaging,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.messaging });

  const toggle = useMutation({
    mutationFn: (platform: MessagingPlatform) => setPlatformEnabled(platform.id, !platform.enabled),
    onSuccess: async (_r, platform) => {
      setConfirming(null);
      await invalidate();
      toast.push({
        tone: 'success',
        title: platform.enabled ? `„${platform.name}" deaktiviert` : `„${platform.name}" aktiviert`,
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Umschalten fehlgeschlagen', description: e.message }),
  });

  const test = useMutation({
    mutationFn: (id: string) => testPlatform(id),
    onSuccess: (result, id) =>
      toast.push({
        tone: result.ok ? 'success' : 'warning',
        title: `Test: ${id}`,
        description:
          result.message ?? result.state ?? (result.ok ? 'Erreichbar' : 'Nicht erreichbar'),
      }),
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Test fehlgeschlagen', description: e.message }),
  });

  const busy = (id: string) =>
    (toggle.isPending && toggle.variables?.id === id) || (test.isPending && test.variables === id);

  const platforms = useMemo(() => {
    const all = data?.platforms ?? [];
    return scope === 'eingerichtet' ? all.filter((p) => p.configured) : all;
  }, [data, scope]);

  if (isPending) return <SkeletonText lines={6} />;
  if (error)
    return (
      <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
        {error.message}
      </p>
    );
  if (!data) return null;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-ink-faint)]">
          {data.enabledCount} aktiv · {data.configuredCount} eingerichtet · {data.platforms.length}{' '}
          möglich
        </p>
        <FilterChips
          label="Umfang"
          value={scope}
          onChange={setScope}
          options={[
            { id: 'eingerichtet', label: 'Eingerichtet', count: data.configuredCount },
            { id: 'alle', label: 'Alle', count: data.platforms.length },
          ]}
        />
      </div>

      {platforms.length === 0 ? (
        <div className="card p-10 text-center">
          <span
            className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
            aria-hidden
          >
            <Plug size={22} />
          </span>
          <p className="mt-4 text-sm font-medium">Keine Plattform eingerichtet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
            Über „Alle" siehst du die {data.platforms.length} Plattformen, die dein Hermes anbinden
            kann. Eingerichtet werden sie in der Hermes-Konfiguration.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {platforms.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              confirming={confirming === platform.id}
              pending={busy(platform.id)}
              onToggle={setConfirming}
              onConfirm={(target) => toggle.mutate(target)}
              onCancel={() => setConfirming(null)}
              onTest={(id) => test.mutate(id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function WebhooksSection() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: getWebhooks,
    staleTime: 30_000,
  });

  if (isPending) return <SkeletonText lines={2} />;
  if (error)
    return (
      <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
        {error.message}
      </p>
    );
  if (!data) return null;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Webhook size={15} className="text-[var(--color-ink-faint)]" aria-hidden />
        <span className="text-sm font-medium">Eingehende Webhooks</span>
        <span
          className="rounded-full px-2 py-0.5 text-[0.65rem]"
          style={{
            background: data.enabled
              ? 'color-mix(in oklab, var(--color-ok) 15%, transparent)'
              : 'var(--color-raised)',
            color: data.enabled ? 'var(--color-ok)' : 'var(--color-ink-faint)',
          }}
        >
          {data.enabled ? 'aktiv' : 'inaktiv'}
        </span>
        {data.baseUrl && (
          <span className="ml-auto font-mono text-[0.7rem] text-[var(--color-ink-faint)]">
            {data.baseUrl}
          </span>
        )}
      </div>

      {data.subscriptions.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Keine Webhook-Abonnements. Hermes empfängt Ereignisse von Diensten wie GitHub oder Stripe,
          sobald hier ein Abonnement eingerichtet ist.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {data.subscriptions.map((sub, index) => (
            <li
              key={sub.name ?? sub.url ?? index}
              className="flex flex-wrap items-baseline gap-x-2 border-t border-[var(--color-hairline)] pt-1.5 text-xs first:border-t-0"
            >
              <span className="font-medium">{sub.name ?? 'Unbenannt'}</span>
              {sub.url && (
                <span className="font-mono text-[0.7rem] text-[var(--color-ink-faint)]">
                  {sub.url}
                </span>
              )}
              {sub.events.length > 0 && (
                <span className="text-[0.7rem] text-[var(--color-ink-muted)]">
                  {sub.events.join(', ')}
                </span>
              )}
              {!sub.enabled && (
                <span className="text-[0.65rem] text-[var(--color-ink-faint)]">deaktiviert</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PairingSection() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.pairing,
    queryFn: getPairing,
    staleTime: 30_000,
  });

  if (isPending) return <SkeletonText lines={2} />;
  if (error)
    return (
      <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
        {error.message}
      </p>
    );
  if (!data) return null;

  const empty = data.approved.length === 0 && data.pending.length === 0;

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Users size={15} className="text-[var(--color-ink-faint)]" aria-hidden />
        <span className="text-sm font-medium">Gekoppelte Nutzer</span>
      </div>

      {empty ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Noch niemand gekoppelt. Neue Nutzer werden über DM-Pairing auf der jeweiligen Plattform
          freigegeben.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {data.pending.length > 0 && (
            <div>
              <p className="mb-1 text-[0.7rem] uppercase tracking-wide text-[var(--color-warn)]">
                Wartet auf Freigabe
              </p>
              <ul className="space-y-1">
                {data.pending.map((user, index) => (
                  <li key={user.userId ?? index} className="flex items-baseline gap-2 text-xs">
                    <span className="font-medium">
                      {user.userName ?? user.userId ?? 'Unbekannt'}
                    </span>
                    {user.platform && (
                      <span className="text-[0.7rem] text-[var(--color-ink-faint)]">
                        {user.platform}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.approved.length > 0 && (
            <div>
              <p className="mb-1 text-[0.7rem] uppercase tracking-wide text-[var(--color-ink-faint)]">
                Freigegeben
              </p>
              <ul className="space-y-1">
                {data.approved.map((user, index) => (
                  <li
                    key={user.userId ?? index}
                    className="flex flex-wrap items-baseline gap-x-2 text-xs"
                  >
                    <span className="font-medium">
                      {user.userName ?? user.userId ?? 'Unbekannt'}
                    </span>
                    {user.platform && (
                      <span className="text-[0.7rem] text-[var(--color-ink-faint)]">
                        {user.platform}
                      </span>
                    )}
                    {user.userId && user.userName && (
                      <span className="font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
                        {user.userId}
                      </span>
                    )}
                    {user.at && (
                      <span className="ml-auto text-[0.65rem] text-[var(--color-ink-faint)]">
                        {formatRelativeTime(user.at)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IntegrationenPage() {
  return (
    <PageShell
      title="API & Integrationen"
      description="Wie dein Agent die Außenwelt erreicht: Messaging-Plattformen, eingehende Webhooks und die dafür freigegebenen Nutzer."
    >
      <div className="space-y-6">
        <MessagingSection />

        <section>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
            Webhooks & Kopplung
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            <WebhooksSection />
            <PairingSection />
          </div>
        </section>
      </div>
    </PageShell>
  );
}
