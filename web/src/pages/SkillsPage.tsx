import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Sparkles, Store } from 'lucide-react';
import { getSkillList, queryKeys } from '@/lib/api';
import { FilterChips, PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import type { SkillEntry } from '@/lib/hermesTypes';

type Provenance = 'alle' | 'bundled' | 'hub' | 'agent';

const PROVENANCE_LABEL: Record<string, { label: string; icon: typeof Package; hint: string }> = {
  bundled: { label: 'mitgeliefert', icon: Package, hint: 'Kommt mit Hermes' },
  hub: { label: 'Hub', icon: Store, hint: 'Aus dem Skill-Hub installiert' },
  agent: { label: 'selbst erstellt', icon: Sparkles, hint: 'Vom Agenten angelegt' },
};

function SkillRow({ skill }: { skill: SkillEntry }) {
  const provenance = skill.provenance ? PROVENANCE_LABEL[skill.provenance] : undefined;
  const Icon = provenance?.icon;

  return (
    <li className="flex items-start gap-3 border-b border-[var(--color-hairline)] px-3 py-2.5 last:border-b-0">
      <span
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
          skill.enabled ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-ink-faint)]'
        }`}
        aria-hidden
      />
      <span className="sr-only">{skill.enabled ? 'aktiv' : 'inaktiv'}</span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm">{skill.name}</span>
          {skill.category && (
            <span className="text-[0.7rem] text-[var(--color-ink-faint)]">{skill.category}</span>
          )}
        </div>
        {skill.description && (
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{skill.description}</p>
        )}
      </div>

      {Icon && (
        <span
          className="mt-0.5 flex shrink-0 items-center gap-1 text-[0.65rem] text-[var(--color-ink-faint)]"
          title={provenance?.hint}
        >
          <Icon size={11} aria-hidden />
          {provenance?.label}
        </span>
      )}

      <span className="mt-0.5 w-12 shrink-0 text-right font-mono text-xs text-[var(--color-ink-faint)]">
        {skill.usage > 0 ? `${skill.usage}×` : '—'}
      </span>
    </li>
  );
}

export function SkillsPage() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.skillList,
    queryFn: getSkillList,
    staleTime: 60_000,
  });

  const [search, setSearch] = useState('');
  const [provenance, setProvenance] = useState<Provenance>('alle');
  const [category, setCategory] = useState<string>('alle');

  const skills = useMemo(() => data ?? [], [data]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of skills) {
      const name = skill.category ?? 'ohne';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [skills]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return skills.filter((skill) => {
      if (provenance !== 'alle' && skill.provenance !== provenance) return false;
      if (category !== 'alle' && (skill.category ?? 'ohne') !== category) return false;
      if (needle === '') return true;
      return (
        skill.name.toLowerCase().includes(needle) ||
        (skill.description ?? '').toLowerCase().includes(needle) ||
        (skill.category ?? '').toLowerCase().includes(needle)
      );
    });
  }, [skills, search, provenance, category]);

  const provenanceCounts = useMemo(() => {
    const counts = { bundled: 0, hub: 0, agent: 0 };
    for (const skill of skills) {
      if (skill.provenance && skill.provenance in counts) {
        counts[skill.provenance as keyof typeof counts] += 1;
      }
    }
    return counts;
  }, [skills]);

  return (
    <PageShell
      title="Skills"
      description="Fähigkeiten, die dein Agent nutzen kann. Die Nutzungszahl zeigt, was davon tatsächlich zum Einsatz kommt."
      actions={<SearchField value={search} onChange={setSearch} label="Skills durchsuchen" />}
    >
      {isPending ? (
        <SkeletonText lines={10} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
            <FilterChips
              label="Herkunft"
              value={provenance}
              onChange={setProvenance}
              options={[
                { id: 'alle', label: 'Alle', count: skills.length },
                { id: 'bundled', label: 'mitgeliefert', count: provenanceCounts.bundled },
                { id: 'hub', label: 'Hub', count: provenanceCounts.hub },
                { id: 'agent', label: 'selbst erstellt', count: provenanceCounts.agent },
              ]}
            />
          </div>

          <div className="mb-4 flex flex-wrap gap-1.5">
            <FilterChips
              label="Kategorie"
              value={category}
              onChange={setCategory}
              options={[{ id: 'alle', label: 'Alle Kategorien' }, ...categories]}
            />
          </div>

          <p className="mb-2 text-xs text-[var(--color-ink-faint)]" role="status">
            {visible.length} von {skills.length} Skills
          </p>

          {visible.length === 0 ? (
            <p className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">
              Kein Skill passt zu dieser Auswahl.
            </p>
          ) : (
            <ul className="card overflow-hidden p-0">
              {visible.map((skill) => (
                <SkillRow key={skill.name} skill={skill} />
              ))}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}
