import { useQuery } from '@tanstack/react-query';
import { getMemory, queryKeys } from '@/lib/api';
import { formatCompact } from '@/lib/format';
import { useI18n, type TFunction } from '@/lib/i18n';
import { WidgetState } from './WidgetState';

const STATUS_KEY: Record<string, string> = {
  ready: 'wissen.status.ready',
  unavailable: 'wissen.status.unavailable',
  needs_config: 'wissen.status.needs_config',
  error: 'wissen.status.error',
};

const STATUS_COLOR: Record<string, string> = {
  ready: 'var(--color-ok)',
  unavailable: 'var(--color-ink-faint)',
  needs_config: 'var(--color-warn)',
  error: 'var(--color-danger)',
};

/** A status Hermes does not name stays verbatim rather than being dropped. */
function statusLabel(t: TFunction, status: string | null): string {
  const key = status ? STATUS_KEY[status] : undefined;
  return key ? t(key) : (status ?? '');
}

/** What the agent remembers: its memory provider and the built-in note files. */
export function KnowledgeWidget() {
  const { t, lang } = useI18n();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.memory,
    queryFn: getMemory,
    staleTime: 60_000,
  });

  return (
    <WidgetState isPending={isPending} error={error}>
      {data && (
        <div className="flex h-full flex-col gap-3">
          {data.files.length > 0 && (
            <div className="flex gap-4">
              {data.files.map((file) => (
                <div key={file.name} className="min-w-0">
                  <p className="font-mono text-xl tracking-tight">
                    {formatCompact(file.entries, lang)}
                  </p>
                  <p className="truncate text-[0.7rem] text-[var(--color-ink-faint)]">
                    {file.name === 'memory' ? t('wissen.files.memory') : file.name}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--color-hairline)] pt-2">
            <p className="mb-1 text-[0.7rem] text-[var(--color-ink-faint)]">
              {t('wissen.providers')}
              {data.active
                ? ` · ${t('wissen.activeProvider', { name: data.active })}`
                : ` · ${t('wissen.noneActive')}`}
            </p>

            {data.configured.length === 0 ? (
              <p className="text-xs text-[var(--color-ink-faint)]">
                {t('knowledgeWidget.noneConfigured')}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {data.configured.map((provider) => (
                  <li key={provider.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{
                        background: STATUS_COLOR[provider.status ?? ''] ?? 'var(--color-ink-faint)',
                      }}
                      aria-hidden
                    />
                    <span className="truncate">{provider.name}</span>
                    <span className="ml-auto shrink-0 text-[0.65rem] text-[var(--color-ink-faint)]">
                      {statusLabel(t, provider.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </WidgetState>
  );
}
