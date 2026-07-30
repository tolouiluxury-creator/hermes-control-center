import { useQuery } from '@tanstack/react-query';
import { getSkills, queryKeys } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { WidgetState } from './WidgetState';

export function SkillsWidget() {
  const { t } = useI18n();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.skills,
    queryFn: getSkills,
    staleTime: 60_000,
  });

  return (
    <WidgetState isPending={isPending} error={error} isEmpty={data?.total === 0}>
      {data && (
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl tracking-tight">{data.total}</span>
            <span className="text-xs text-[var(--color-ink-faint)]">
              {t('skillsWidget.installed')}
              {data.enabled !== data.total &&
                ` · ${t('skillsWidget.active', { count: data.enabled })}`}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* Usage counts are what distinguishes a working skill library from a
                hoarded one, so the most-used lead rather than the alphabet. */}
            {data.top.some((skill) => skill.usage > 0) ? (
              <ul className="space-y-1">
                {data.top
                  .filter((skill) => skill.usage > 0)
                  .map((skill) => (
                    <li key={skill.name} className="flex items-center gap-2 text-xs">
                      <span className="truncate" title={skill.name}>
                        {skill.name}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[var(--color-ink-faint)]">
                        {skill.usage}×
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {data.categories.slice(0, 10).map((category) => (
                  <li
                    key={category.name}
                    className="rounded-full border border-[var(--color-hairline)] px-2 py-0.5 text-[0.68rem] text-[var(--color-ink-muted)]"
                  >
                    {/* The empty bucket is the server's "uncategorised"; we name it. */}
                    {category.name === '' ? t('skills.noCategory') : category.name}
                    <span className="ml-1 text-[var(--color-ink-faint)]">{category.count}</span>
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
