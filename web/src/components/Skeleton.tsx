import type { CSSProperties } from 'react';
import { useI18n } from '@/lib/i18n';

/**
 * Loading placeholder. It conveys the *shape* of what is coming and never
 * invents plausible-looking content, which would be a lie the moment a reader
 * takes it at face value.
 *
 * The whole group is announced once as busy rather than each bar chattering,
 * so a screen reader hears "loading", not seventeen empty boxes.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className="h-3"
          // A ragged last line reads as text rather than as a block.
          style={{ width: index === lines - 1 ? '60%' : '100%' }}
        />
      ))}
    </div>
  );
}

export function LoadingRegion({
  label,
  children,
}: {
  /** Defaults to the translated "Loading …". */
  label?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label ?? t('common.loading')}</span>
      {children}
    </div>
  );
}
