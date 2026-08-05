import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { ExternalLink, KeyRound, Loader2, Sparkles } from 'lucide-react';
import {
  cancelTelegramSetup,
  getTelegramSetupStatus,
  queryKeys,
  setEnv,
  startTelegramSetup,
} from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

const POLL_INTERVAL_MS = 2000;

type Mode = 'manual' | 'auto';

/**
 * Getting a bot connected without leaving the browser.
 *
 * Manual: the two env vars Hermes actually needs (`TELEGRAM_BOT_TOKEN`,
 * `TELEGRAM_ALLOWED_USERS`), through the same `setEnv` write Settings uses —
 * this page just asks for exactly those two rather than making someone find
 * them in a long generic list.
 *
 * Automatic: Hermes' own Telegram "Managed Bots" onboarding (the same
 * service its CLI uses) — not BotFather scripting. The user opens a deep
 * link or scans a QR code, Telegram creates a bot they own, and this page
 * polls until it is ready and applies both values itself.
 */
export function TelegramSetup({ profile }: { profile: string | null }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('auto');

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <KeyRound size={15} className="text-[var(--color-ink-faint)]" aria-hidden />
        <span className="text-sm font-medium">{t('telegram.setup.title')}</span>
        <div className="ms-auto inline-flex rounded-lg border border-[var(--color-hairline)] p-0.5 text-xs">
          <ModeButton active={mode === 'auto'} onClick={() => setMode('auto')}>
            {t('telegram.setup.auto')}
          </ModeButton>
          <ModeButton active={mode === 'manual'} onClick={() => setMode('manual')}>
            {t('telegram.setup.manual')}
          </ModeButton>
        </div>
      </div>

      {mode === 'auto' ? <AutoSetup profile={profile} /> : <ManualSetup profile={profile} />}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 transition-colors ${
        active
          ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
          : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
      }`}
    >
      {children}
    </button>
  );
}

function ManualSetup({ profile }: { profile: string | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('');

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.messagingFor(profile) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.envFor(profile) }),
    ]);
  };

  const save = useMutation({
    mutationFn: async () => {
      const trimmedToken = token.trim();
      const trimmedUserId = userId.trim();
      // Only writes what was actually typed — leaving one field blank keeps
      // whatever that variable was already set to, rather than clearing it.
      if (trimmedToken) await setEnv('TELEGRAM_BOT_TOKEN', trimmedToken, profile);
      if (trimmedUserId) await setEnv('TELEGRAM_ALLOWED_USERS', trimmedUserId, profile);
    },
    onSuccess: async () => {
      setToken('');
      setUserId('');
      await invalidate();
      toast.push({ tone: 'success', title: t('telegram.setup.savedToast') });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: error.message }),
  });

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (token.trim() || userId.trim()) save.mutate();
      }}
    >
      <p className="text-xs text-[var(--color-ink-muted)]">{t('telegram.setup.manualHint')}</p>
      <div>
        <label className="mb-1 block text-xs text-[var(--color-ink-muted)]">
          {t('telegram.setup.tokenLabel')}
        </label>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t('telegram.setup.tokenPlaceholder')}
          autoComplete="off"
          className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-[var(--color-ink-muted)]">
          {t('telegram.setup.userIdLabel')}
        </label>
        <input
          type="text"
          inputMode="numeric"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder={t('telegram.setup.userIdPlaceholder')}
          autoComplete="off"
          className="w-full max-w-[16rem] rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)]"
        />
      </div>
      <button
        type="submit"
        disabled={save.isPending || (!token.trim() && !userId.trim())}
        className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
      >
        {t('common.save')}
      </button>
    </form>
  );
}

function AutoSetup({ profile }: { profile: string | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollTimer.current !== null) clearInterval(pollTimer.current);
    pollTimer.current = null;
  };

  // Give up the pairing server-side too if the user navigates away mid-flow,
  // rather than leaving it to expire on its own after fifteen minutes.
  useEffect(
    () => () => {
      stopPolling();
      if (pairingId) void cancelTelegramSetup(pairingId).catch(() => {});
    },
    [pairingId],
  );

  const start = useMutation({
    mutationFn: () => startTelegramSetup(profile),
    onSuccess: (pairing) => {
      setPairingId(pairing.pairingId);
      setDeepLink(pairing.deepLink);
      const qr = qrcode(0, 'M');
      qr.addData(pairing.qrPayload);
      qr.make();
      setQrSvg(qr.createSvgTag({ scalable: true }));

      stopPolling();
      pollTimer.current = setInterval(() => {
        void (async () => {
          try {
            const status = await getTelegramSetupStatus(pairing.pairingId);
            if (status.status === 'pending') return;
            stopPolling();
            if (status.status === 'expired') {
              reset();
              toast.push({ tone: 'error', title: t('telegram.setup.expiredToast') });
              return;
            }
            reset();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.messagingFor(profile) }),
              queryClient.invalidateQueries({ queryKey: queryKeys.envFor(profile) }),
            ]);
            toast.push({
              tone: 'success',
              title: t('telegram.setup.readyToast', {
                bot: status.botUsername ? `@${status.botUsername}` : t('telegram.setup.readyBot'),
              }),
            });
          } catch (error) {
            stopPolling();
            toast.push({
              tone: 'error',
              title: t('toast.saveFailed'),
              description: error instanceof Error ? error.message : undefined,
            });
          }
        })();
      }, POLL_INTERVAL_MS);
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: error.message }),
  });

  const reset = () => {
    stopPolling();
    setPairingId(null);
    setDeepLink(null);
    setQrSvg(null);
  };

  const cancel = () => {
    if (pairingId) void cancelTelegramSetup(pairingId).catch(() => {});
    reset();
  };

  if (!pairingId) {
    return (
      <div className="mt-4">
        <p className="text-xs text-[var(--color-ink-muted)]">{t('telegram.setup.autoHint')}</p>
        <button
          type="button"
          onClick={() => start.mutate()}
          disabled={start.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
        >
          {start.isPending ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )}
          {t('telegram.setup.autoStart')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
      {qrSvg && (
        <div
          className="size-32 shrink-0 rounded-lg bg-white p-2"
          // The library's own SVG output; no user-controlled data reaches it —
          // the payload is the deep link this same request just returned.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      )}
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
          <Loader2 size={12} className="animate-spin" aria-hidden />
          {t('telegram.setup.waiting')}
        </p>
        {deepLink && (
          <a
            href={deepLink}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
          >
            <ExternalLink size={13} aria-hidden />
            {t('telegram.setup.openInTelegram')}
          </a>
        )}
        <button
          type="button"
          onClick={cancel}
          className="mt-2 ms-2 rounded-lg px-2 py-1 text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
