import { useQuery } from '@tanstack/react-query';
import { getMeta } from '@/lib/api';

/**
 * Boot screen for milestone M0. It exists to prove the full chain works:
 * SPA -> /api proxy -> Fastify -> JSON. The real shell replaces this in M2.
 */
export default function App() {
  const meta = useQuery({ queryKey: ['meta'], queryFn: getMeta });

  return (
    <main className="grid min-h-full place-items-center p-6">
      <section
        className="w-full max-w-lg rounded-2xl border border-[var(--color-hairline)] p-6"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: `blur(var(--glass-blur))`,
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <h1 className="text-lg font-semibold tracking-tight">Hermes Control Center</h1>

        {meta.isPending && (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">Verbinde mit Backend …</p>
        )}

        {meta.isError && (
          <p className="mt-3 text-sm text-[var(--color-danger)]">
            Backend nicht erreichbar: {meta.error.message}
          </p>
        )}

        {meta.data && (
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-[var(--color-ink-faint)]">Version</dt>
            <dd className="font-mono text-[var(--color-accent)]">{meta.data.version}</dd>
            <dt className="text-[var(--color-ink-faint)]">Node</dt>
            <dd className="font-mono">{meta.data.node}</dd>
            <dt className="text-[var(--color-ink-faint)]">Hermes Home</dt>
            <dd className="truncate font-mono" title={meta.data.hermesHome}>
              {meta.data.hermesHome}
            </dd>
            <dt className="text-[var(--color-ink-faint)]">State</dt>
            <dd className="truncate font-mono" title={meta.data.stateHome}>
              {meta.data.stateHome}
            </dd>
          </dl>
        )}
      </section>
    </main>
  );
}
