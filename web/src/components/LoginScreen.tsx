import { useId, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { ApiError, login } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Password gate. It says as little as possible about why a login failed — the
 * server answers the same way for a wrong password and for a throttled attempt
 * beyond the retry hint, so probing gains nothing.
 */
export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const errorId = useId();

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || password === '') return;

    setBusy(true);
    setError(null);

    try {
      await login(password);
      setPassword('');
      onSuccess();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(
          caught.status === 429
            ? caught.message
            : caught.status === 401
              ? t('login.wrongPassword')
              : caught.message,
        );
      } else {
        setError(t('login.failed'));
      }
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-6 py-10">
      <form
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-2xl border border-[var(--color-hairline)] p-6"
        style={{ background: 'var(--glass-bg)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-center gap-2 text-[var(--color-accent)]">
          <KeyRound size={16} aria-hidden />
          <span className="text-xs font-medium tracking-widest uppercase">{t('login.title')}</span>
        </div>

        <h1 className="mt-3 text-lg font-semibold tracking-tight">Hermes Control Center</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t('login.prompt')}</p>

        <label htmlFor={fieldId} className="mt-5 block text-xs text-[var(--color-ink-faint)]">
          {t('login.password')}
        </label>
        <input
          id={fieldId}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
        />

        {error && (
          <p id={errorId} role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || password === ''}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
        >
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
          {busy ? t('login.checking') : t('login.submit')}
        </button>

        <p className="mt-4 text-xs text-[var(--color-ink-faint)]">
          {t('login.forgotten')}{' '}
          <code className="font-mono">hermes-control-center --set-password</code>
        </p>
      </form>
    </div>
  );
}
