import type { ReactNode } from 'react';
import { Inbox, TriangleAlert } from 'lucide-react';
import { SkeletonText } from '@/components/Skeleton';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * One place for the three states every data widget has, so a loading widget
 * always looks like a loading widget and an empty one never looks broken.
 *
 * An error says what failed and, for the common case of a locked API server,
 * why — a bare "Error" would send the user hunting.
 */
export function WidgetState({
  isPending,
  error,
  isEmpty,
  emptyMessage,
  children,
}: {
  isPending: boolean;
  error: Error | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();

  if (isPending) return <SkeletonText lines={4} />;

  if (error) {
    const unauthorized = error instanceof ApiError && error.status === 401;
    const unreachable = error instanceof ApiError && error.status === 503;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-2 text-center">
        <TriangleAlert size={16} className="text-[var(--color-warn)]" aria-hidden />
        <p className="text-xs text-[var(--color-ink-muted)]">
          {unauthorized
            ? t('widget.unauthorized')
            : unreachable
              ? t('widget.unreachable')
              : error.message}
        </p>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-2 text-center">
        <Inbox size={16} className="text-[var(--color-ink-faint)]" aria-hidden />
        <p className="text-xs text-[var(--color-ink-faint)]">{emptyMessage ?? t('widget.empty')}</p>
      </div>
    );
  }

  return <>{children}</>;
}
