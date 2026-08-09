import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * The agent's replies are markdown — headings, lists, fenced code, links.
 * Rendering `message.text` as plain text left every `**bold**` and `# heading`
 * showing its own punctuation. `pre code` gets a transparent background via
 * `.markdown-body` in app.css rather than a JS inline/block check, because
 * react-markdown no longer tells the `code` renderer which one it is.
 */
const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>
  ),
  // Not `text-base`: this theme also names its page-background color token
  // `base`, and Tailwind's generated color utility wins that collision on
  // `color` — `text-base` would render an invisible heading, not a 1rem one.
  h1: ({ children }) => <h1 className="mb-1.5 text-[1rem] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 text-[0.95rem] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[var(--color-accent)] underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-[var(--color-hairline)] pl-2.5 text-[var(--color-ink-muted)] last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-[var(--color-hairline)]" />,
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-[var(--color-base)] p-2.5 last:mb-0">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[var(--color-base)] px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  ),
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown-body text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
