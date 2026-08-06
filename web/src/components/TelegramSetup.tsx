import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound } from 'lucide-react';
import { queryKeys, setEnv } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

/**
 * The two env vars Hermes actually needs (`TELEGRAM_BOT_TOKEN`,
 * `TELEGRAM_ALLOWED_USERS`), through the same `setEnv` write Settings uses —
 * this card just asks for exactly those two rather than making someone find
 * them in a long generic list.
 *
 * An automatic path (Hermes' own Telegram "Managed Bots" onboarding) was
 * built and worked, but the user asked to drop it — manual is the one way
 * now.
 */
export function TelegramSetup({
  profile,
  configured,
}: {
  profile: string | null;
  /** From the same connection query the card above reads — one source of
   * truth for "is a bot already set up", not a local "I just saved" flag. */
  configured: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [token, setToken] = useState('');
  const [userId, setUserId] = useState('');
  // Only overrides the confirmed view when the user explicitly asks to
  // change something already configured; an unconfigured bot always shows
  // the form regardless of this.
  const [editing, setEditing] = useState(false);

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
      setEditing(false);
      await invalidate();
      toast.push({ tone: 'success', title: t('telegram.setup.savedToast') });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('toast.saveFailed'), description: error.message }),
  });

  const showForm = editing || !configured;

  return (
    <section className="card p-5">
      <div className="flex items-center gap-2">
        <KeyRound size={15} className="text-[var(--color-ink-faint)]" aria-hidden />
        <span className="text-sm font-medium">{t('telegram.setup.title')}</span>
      </div>

      {!showForm ? (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <CheckCircle2 size={16} className="shrink-0 text-[var(--color-ok)]" aria-hidden />
          <span>{t('telegram.setup.configuredNote')}</span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ms-1 rounded-lg px-2 py-1 text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
          >
            {t('common.change')}
          </button>
        </div>
      ) : (
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
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={save.isPending || (!token.trim() && !userId.trim())}
              className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
            >
              {t('common.save')}
            </button>
            {configured && (
              <button
                type="button"
                onClick={() => {
                  setToken('');
                  setUserId('');
                  setEditing(false);
                }}
                className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
              >
                {t('common.cancel')}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
