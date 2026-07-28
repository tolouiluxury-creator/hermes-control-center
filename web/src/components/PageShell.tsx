import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * The frame every management page shares: a title, an optional sentence saying
 * what the page is for, and a slot for actions. Consistent structure means a
 * reader learns the layout once instead of per page.
 */
export function PageShell({
  title,
  description,
  actions,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** Log and table views want the full width; reading views do not. */
  wide?: boolean;
}) {
  return (
    <div className={`mx-auto px-6 py-6 ${wide ? 'max-w-[1600px]' : 'max-w-5xl'}`}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>

      {children}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Defaults to the translated "Search". */
  placeholder?: string;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5">
      <Search size={14} className="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? t('common.search')}
        aria-label={label}
        className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--color-ink-faint)]"
      />
    </label>
  );
}

/** A row of mutually exclusive filters, rendered as a radio group for keyboards. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              active
                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="ml-1.5 text-[var(--color-ink-faint)]">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
