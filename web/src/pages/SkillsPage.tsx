import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Sparkles, Store } from 'lucide-react';
import { getSkillList, queryKeys, toggleSkill } from '@/lib/api';
import { FilterChips, PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import type { SkillEntry } from '@/lib/hermesTypes';

type Provenance = 'alle' | 'bundled' | 'hub' | 'agent';

const PROVENANCE_LABEL: Record<string, { label: string; icon: typeof Package; hint: string }> = {
  bundled: { label: 'mitgeliefert', icon: Package, hint: 'Kommt mit Hermes' },
  hub: { label: 'Hub', icon: Store, hint: 'Aus dem Skill-Hub installiert' },
  agent: { label: 'selbst erstellt', icon: Sparkles, hint: 'Vom Agenten angelegt' },
};

function ToggleSwitch({
  enabled,
  onClick,
  disabled,
  label,
}: {
  enabled: boolean;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
      style={{ background: enabled ? 'var(--color-ok)' : 'var(--color-raised)' }}
    >
      <span
        className="absolute top-0.5 size-4 rounded-full bg-white transition-all"
        style={{ left: enabled ? 'calc(100% - 1.125rem)' : '0.125rem' }}
        aria-hidden
      />
    </button>
  );
}

function SkillRow({
  skill,
  confirming,
  pending,
  onToggle,
  onConfirmDisable,
  onCancel,
}: {
  skill: SkillEntry;
  confirming: boolean;
  pending: boolean;
  onToggle: (skill: SkillEntry) => void;
  onConfirmDisable: (skill: SkillEntry) => void;
  onCancel: () => void;
}) {
  const provenance = skill.provenance ? PROVENANCE_LABEL[skill.provenance] : undefined;
  const Icon = provenance?.icon;

  return (
    <li className="border-b border-[var(--color-hairline)] px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
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

        <span className="mt-0.5 w-10 shrink-0 text-right font-mono text-xs text-[var(--color-ink-faint)]">
          {skill.usage > 0 ? `${skill.usage}×` : '—'}
        </span>

        <ToggleSwitch
          enabled={skill.enabled}
          disabled={pending}
          onClick={() => onToggle(skill)}
          label={`${skill.name} ${skill.enabled ? 'deaktivieren' : 'aktivieren'}`}
        />
      </div>

      {confirming && (
        <ConfirmInline
          tone="warn"
          message={
            <>
              „{skill.name}" deaktivieren? Dein Agent kann diese Fähigkeit dann nicht mehr nutzen.
            </>
          }
          confirmLabel="Deaktivieren"
          pending={pending}
          onConfirm={() => onConfirmDisable(skill)}
          onCancel={onCancel}
        />
      )}
    </li>
  );
}

export function SkillsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.skillList,
    queryFn: getSkillList,
    staleTime: 60_000,
  });

  const [search, setSearch] = useState('');
  const [provenance, setProvenance] = useState<Provenance>('alle');
  const [category, setCategory] = useState<string>('alle');
  /** The skill whose disable is awaiting confirmation, if any. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (skill: SkillEntry) => toggleSkill(skill.name, !skill.enabled),
    onSuccess: async (_result, skill) => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skillList });
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      toast.push({
        tone: 'success',
        title: skill.enabled ? `„${skill.name}" deaktiviert` : `„${skill.name}" aktiviert`,
      });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: 'Umschalten fehlgeschlagen',
        description: mutationError.message,
      }),
  });

  // Enabling is safe and immediate; disabling removes a capability from the
  // running agent, so it asks first.
  const onToggle = (skill: SkillEntry) => {
    if (skill.enabled) setConfirming(skill.name);
    else toggle.mutate(skill);
  };

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
                <SkillRow
                  key={skill.name}
                  skill={skill}
                  confirming={confirming === skill.name}
                  pending={toggle.isPending && toggle.variables?.name === skill.name}
                  onToggle={onToggle}
                  onConfirmDisable={(target) => toggle.mutate(target)}
                  onCancel={() => setConfirming(null)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}
