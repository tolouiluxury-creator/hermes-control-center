import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useStatus } from '@/lib/useStatus';
import { useI18n } from '@/lib/i18n';

/**
 * A slim, dismissible notice for a partly-working Hermes.
 *
 * The API server being off is a legitimate configuration, so it must not block
 * the app — but the pages it powers would otherwise look mysteriously empty.
 * This says which capability is missing and why, once, without nagging.
 */
export function DegradedBanner() {
  const { t } = useI18n();
  const { data: snapshot } = useStatus();
  const [dismissed, setDismissed] = useState(false);

  if (!snapshot || dismissed || snapshot.setupRequired) return null;

  const apiMissing = !snapshot.apiServer.reachable;
  const keyMissing = snapshot.apiServer.reachable && !snapshot.apiServer.hasKey;
  if (!apiMissing && !keyMissing) return null;

  const reason = apiMissing ? t('degraded.apiMissing') : t('degraded.keyMissing');

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-[var(--color-warn)]/25 bg-[var(--color-warn)]/8 px-4 py-2 text-xs"
    >
      <AlertTriangle size={14} className="shrink-0 text-[var(--color-warn)]" aria-hidden />
      <p className="min-w-0 flex-1 text-[var(--color-ink-muted)]">
        <span className="text-[var(--color-ink)]">{reason}</span> {t('degraded.consequence')}
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="-m-1 shrink-0 rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        aria-label={t('degraded.dismiss')}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  );
}
