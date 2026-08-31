/**
 * Three staggered dots, the familiar "still composing" signal — shown in place
 * of an empty assistant bubble while a reply streams in. Each dot swells and
 * fades in turn (`typing-dot` in app.css); the global reduced-motion block
 * freezes the animation for users who asked the OS to cut motion.
 */
export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" role="status" aria-label="…">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-[var(--color-ink-faint)]"
          style={{
            animation: 'typing-dot 1.1s ease-in-out infinite',
            animationDelay: `${i * 160}ms`,
          }}
        />
      ))}
    </span>
  );
}
