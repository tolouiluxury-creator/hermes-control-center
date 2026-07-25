import { Construction } from 'lucide-react';
import type { NavItem } from '@/lib/nav';

/**
 * Stands in for a page that has not been built yet.
 *
 * It states plainly that nothing is here and what will be, rather than showing
 * an empty shell that looks broken or, worse, mock content that looks real.
 */
export function PlaceholderPage({ item, planned }: { item: NavItem; planned: string }) {
  const Icon = item.icon;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="card p-8 text-center">
        <span
          className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
          aria-hidden
        >
          <Icon size={22} />
        </span>

        <h2 className="mt-4 text-lg font-semibold tracking-tight">{item.label}</h2>

        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">{planned}</p>

        <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-ink-faint)]">
          <Construction size={13} aria-hidden />
          Noch nicht gebaut — hier stehen später echte Daten, keine Platzhalter
        </p>
      </div>
    </div>
  );
}
