/** Three staggered dots, the familiar "still composing" signal — shown in place of an empty assistant bubble while a reply streams in. */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" aria-label="…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-[var(--color-ink-faint)]"
          style={{ animationDelay: `${i * 160}ms`, animationDuration: '1100ms' }}
        />
      ))}
    </span>
  );
}
