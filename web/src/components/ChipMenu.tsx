import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface ChipMenuOption {
  /** Stable identity. The empty string is a legitimate value: "no override". */
  value: string;
  label: string;
  hint?: string | null;
  disabled?: boolean;
}

interface ChipMenuProps {
  icon: ReactNode;
  /** Shown on the chip itself — the current choice, kept short. */
  label: string;
  title: string;
  options: ChipMenuOption[];
  value: string;
  onChange: (value: string) => void;
  /** A chip with nothing to switch between still reports the current state. */
  disabled?: boolean;
  /** Explains why the chip is frozen, e.g. an open conversation owns its model. */
  disabledHint?: string;
}

/**
 * A compact "current value + pick another" control, sized to sit in a toolbar
 * next to a heading rather than in a form.
 *
 * A native `<select>` would have been less code, but it cannot show a second
 * line of explanation per option — and here the explanation is the point: which
 * provider a model belongs to, which profile the dashboard actually runs as.
 */
export function ChipMenu({
  icon,
  label,
  title,
  options,
  value,
  onChange,
  disabled = false,
  disabledHint,
}: ChipMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  // Clicking elsewhere or pressing Escape closes the menu. Without the first,
  // opening the other chip would leave two menus stacked on screen.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        title={disabled ? (disabledHint ?? title) : title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-[var(--color-hairline)] px-2.5 py-1 text-[0.7rem] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)]/40 hover:text-[var(--color-ink)] disabled:cursor-default disabled:opacity-60 disabled:hover:border-[var(--color-hairline)] disabled:hover:text-[var(--color-ink-muted)]"
      >
        <span className="shrink-0 text-[var(--color-ink-faint)]" aria-hidden>
          {icon}
        </span>
        <span className="truncate font-mono">{label}</span>
        {!disabled && <ChevronDown size={11} className="shrink-0" aria-hidden />}
      </button>

      {open && (
        <ul
          id={menuId}
          role="listbox"
          className="absolute end-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl border border-[var(--color-hairline)] bg-[var(--color-raised)] p-1 shadow-lg"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={option.value || '__default__'}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  onClick={() => {
                    setOpen(false);
                    if (!selected) onChange(option.value);
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start transition-colors disabled:cursor-default disabled:opacity-45 ${
                    selected
                      ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                      : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-base)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Check
                    size={12}
                    className={`mt-0.5 shrink-0 ${selected ? '' : 'invisible'}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[0.7rem]">{option.label}</span>
                    {option.hint && (
                      <span className="mt-0.5 block truncate text-[0.65rem] text-[var(--color-ink-faint)]">
                        {option.hint}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
