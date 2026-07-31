import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Pencil, Plus, Sparkles, Store, Trash2 } from 'lucide-react';
import {
  createSkill,
  getSkillContent,
  getSkillList,
  queryKeys,
  toggleSkill,
  uninstallSkill,
  updateSkillContent,
} from '@/lib/api';
import { FilterChips, FilterSelect, PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import type { SkillEntry } from '@/lib/hermesTypes';

type Provenance = 'alle' | 'bundled' | 'hub' | 'agent';

const PROVENANCE_META: Record<string, { icon: typeof Package; labelKey: string; hintKey: string }> =
  {
    bundled: { icon: Package, labelKey: 'skills.bundled', hintKey: 'skills.bundledHint' },
    hub: { icon: Store, labelKey: 'skills.hub', hintKey: 'skills.hubHint' },
    agent: { icon: Sparkles, labelKey: 'skills.agent', hintKey: 'skills.agentHint' },
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

/**
 * Hermes truncates the skill index to this many characters, and refuses to
 * create a skill whose description overruns it — an over-long description would
 * silently lose the routing signal that makes the agent reach for the skill at
 * all. Existing skills are exempt, so this is checked only when authoring.
 */
const NEW_SKILL_DESCRIPTION_LIMIT = 60;

/** A minimal SKILL.md that passes Hermes' frontmatter validation as written. */
function skillTemplate(name: string): string {
  return `---
name: ${name || 'my-skill'}
description: One sentence, trigger first, ends with a period.
---

# ${name || 'my-skill'}

Describe what the agent should do when this skill applies.
`;
}

/** Reads the `description:` line out of frontmatter, for the length check. */
function frontmatterDescription(content: string): string | null {
  // A leading BOM (Windows editors) sits before the fence; Hermes tolerates it,
  // so this has to as well or it would find no frontmatter at all.
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^\uFEFF/, ''));
  if (!match) return null;
  const line = /^description:\s*(.*)$/m.exec(match[1] ?? '');
  return line ? (line[1] ?? '').trim().replace(/^['"]|['"]$/g, '') : null;
}

function SkillRow({
  skill,
  confirming,
  pending,
  onToggle,
  onConfirmDisable,
  onCancel,
  onEdit,
  onRemove,
  children,
}: {
  skill: SkillEntry;
  confirming: boolean;
  pending: boolean;
  onToggle: (skill: SkillEntry) => void;
  onConfirmDisable: (skill: SkillEntry) => void;
  onCancel: () => void;
  onEdit: (skill: SkillEntry) => void;
  onRemove: (skill: SkillEntry) => void;
  /** The remove confirmation, so it stays inside this row's <li>. */
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const provenance = skill.provenance ? PROVENANCE_META[skill.provenance] : undefined;
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
        <span className="sr-only">{skill.enabled ? t('common.active') : t('common.inactive')}</span>

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
            title={provenance ? t(provenance.hintKey) : undefined}
          >
            <Icon size={11} aria-hidden />
            {provenance && t(provenance.labelKey)}
          </span>
        )}

        <span className="mt-0.5 w-10 shrink-0 text-right font-mono text-xs text-[var(--color-ink-faint)]">
          {skill.usage > 0 ? t('skills.usage', { count: skill.usage }) : '—'}
        </span>

        <span className="mt-0.5 flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(skill)}
            title={t('skills.edit')}
            aria-label={`${t('skills.edit')} ${skill.name}`}
            className="rounded-lg border border-[var(--color-hairline)] p-1 text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)]/40 hover:text-[var(--color-ink)]"
          >
            <Pencil size={12} aria-hidden />
          </button>
          {/* Bundled skills ship with Hermes and come back on the next update,
              so removing one is offered only where it actually sticks. */}
          {skill.provenance !== 'bundled' && (
            <button
              type="button"
              onClick={() => onRemove(skill)}
              title={t('skills.remove')}
              aria-label={`${t('skills.remove')} ${skill.name}`}
              className="rounded-lg border border-[var(--color-hairline)] p-1 text-[var(--color-danger)] transition-colors hover:border-[var(--color-danger)]/40"
            >
              <Trash2 size={12} aria-hidden />
            </button>
          )}
        </span>

        <ToggleSwitch
          enabled={skill.enabled}
          disabled={pending}
          onClick={() => onToggle(skill)}
          label={`${skill.name} ${skill.enabled ? t('common.disable') : t('common.enable')}`}
        />
      </div>

      {confirming && (
        <ConfirmInline
          tone="warn"
          message={t('skills.disableConfirm', { name: skill.name })}
          confirmLabel={t('common.disable')}
          pending={pending}
          onConfirm={() => onConfirmDisable(skill)}
          onCancel={onCancel}
        />
      )}

      {children}
    </li>
  );
}

export function SkillsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();

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
  /**
   * The editor. `name` empty means authoring a new skill; otherwise it is an
   * existing one whose SKILL.md was loaded for rewriting.
   */
  const [editor, setEditor] = useState<{
    name: string;
    category: string;
    content: string;
    isNew: boolean;
  } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const openEditor = async (skill: SkillEntry) => {
    setEditor({ name: skill.name, category: skill.category ?? '', content: '', isNew: false });
    try {
      const loaded = await getSkillContent(skill.name);
      // Only fill in if the user has not moved on to another skill meanwhile.
      setEditor((current) =>
        current && current.name === skill.name ? { ...current, content: loaded.content } : current,
      );
    } catch (loadError) {
      setEditor(null);
      toast.push({
        tone: 'error',
        title: t('skills.loadFailed'),
        description: loadError instanceof Error ? loadError.message : undefined,
      });
    }
  };

  const save = useMutation({
    mutationFn: () => {
      if (!editor) throw new Error('no editor');
      return editor.isNew
        ? createSkill(editor.name, editor.content, editor.category || undefined)
        : updateSkillContent(editor.name, editor.content);
    },
    onSuccess: async () => {
      const wasNew = editor?.isNew === true;
      const name = editor?.name ?? '';
      setEditor(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skillList });
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      toast.push({
        tone: 'success',
        title: wasNew ? t('skills.created', { name }) : t('skills.saved', { name }),
      });
    },
    onError: (saveError: Error) =>
      toast.push({ tone: 'error', title: t('skills.saveFailed'), description: saveError.message }),
  });

  const remove = useMutation({
    mutationFn: (name: string) => uninstallSkill(name),
    onSuccess: async (_result, name) => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skillList });
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      /*
       * Hermes spawns `hermes skills uninstall` and answers with the child's pid,
       * so the skill is still listed at this point — reporting success would be a
       * guess. These re-reads let the list correct itself once the CLI finishes.
       *
       * The last one also checks. On Hermes 0.19.0 the spawned command carries a
       * `--yes` flag its own CLI does not accept, so the child dies on an argument
       * error while the endpoint has already answered ok — the removal never
       * happens and nothing anywhere says so. Rather than leave that silent, the
       * page looks at whether the skill is still there and reports what it sees.
       */
      toast.push({ tone: 'info', title: t('skills.removeStarted', { name }) });

      for (const delay of [3000, 8000]) {
        setTimeout(() => {
          void (async () => {
            await queryClient.invalidateQueries({ queryKey: queryKeys.skillList });
            await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
            if (delay !== 8000) return;
            const list = queryClient.getQueryData<SkillEntry[]>(queryKeys.skillList);
            if (list?.some((entry) => entry.name === name)) {
              toast.push({ tone: 'error', title: t('skills.removeStuck', { name }) });
            }
          })();
        }, delay);
      }
    },
    onError: (removeError: Error) =>
      toast.push({
        tone: 'error',
        title: t('skills.removeFailed'),
        description: removeError.message,
      }),
  });

  const toggle = useMutation({
    mutationFn: (skill: SkillEntry) => toggleSkill(skill.name, !skill.enabled),
    onSuccess: async (_result, skill) => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: queryKeys.skillList });
      await queryClient.invalidateQueries({ queryKey: queryKeys.skills });
      toast.push({
        tone: 'success',
        title: skill.enabled
          ? t('skills.disabledToast', { name: skill.name })
          : t('skills.enabledToast', { name: skill.name }),
      });
    },
    onError: (mutationError: Error) =>
      toast.push({
        tone: 'error',
        title: t('toast.toggleFailed'),
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
    return (
      [...counts.entries()]
        // Category names come from Hermes; only our own "no category" bucket is ours to translate.
        .map(([id, count]) => ({ id, label: id === 'ohne' ? t('skills.noCategory') : id, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    );
  }, [skills, t]);

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
      title={t('nav.skills')}
      description={t('page.skills.desc')}
      actions={
        <div className="flex items-center gap-2">
          <SearchField value={search} onChange={setSearch} label={t('skills.searchLabel')} />
          <button
            type="button"
            onClick={() =>
              setEditor({ name: '', category: '', content: skillTemplate(''), isNew: true })
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
          >
            <Plus size={14} aria-hidden />
            {t('skills.new')}
          </button>
        </div>
      }
    >
      {isPending ? (
        <SkeletonText lines={10} />
      ) : error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <>
          {editor && (
            <SkillEditor
              editor={editor}
              onChange={setEditor}
              onSave={() => save.mutate()}
              onCancel={() => setEditor(null)}
              pending={save.isPending}
            />
          )}

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
            <FilterChips
              label={t('skills.origin')}
              value={provenance}
              onChange={setProvenance}
              options={[
                { id: 'alle', label: t('common.all'), count: skills.length },
                { id: 'bundled', label: t('skills.bundled'), count: provenanceCounts.bundled },
                { id: 'hub', label: t('skills.hub'), count: provenanceCounts.hub },
                { id: 'agent', label: t('skills.agent'), count: provenanceCounts.agent },
              ]}
            />
          </div>

          {/* A dropdown, not chips: this install has a dozen-plus categories. */}
          <div className="mb-4">
            <FilterSelect
              label={t('skills.category')}
              value={category}
              onChange={setCategory}
              options={[
                { id: 'alle', label: t('skills.categories'), count: skills.length },
                ...categories,
              ]}
            />
          </div>

          <p className="mb-2 text-xs text-[var(--color-ink-faint)]" role="status">
            {t('skills.count', { visible: visible.length, total: skills.length })}
          </p>

          {visible.length === 0 ? (
            <p className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">
              {t('skills.noMatch')}
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
                  onEdit={(target) => void openEditor(target)}
                  onRemove={(target) => setRemoving(target.name)}
                >
                  {removing === skill.name && (
                    <ConfirmInline
                      tone="danger"
                      message={
                        <>
                          {t('skills.removeConfirm', { name: skill.name })}
                          {/*
                           * Hermes' uninstall path goes through the hub lock file
                           * and refuses anything not listed there, so a skill made
                           * here can never be removed by it. Said before the click,
                           * because afterwards there is nothing to see: the endpoint
                           * answers ok either way.
                           */}
                          {skill.provenance !== 'hub' && (
                            <span className="mt-1 block text-[var(--color-ink-muted)]">
                              {t('skills.removeOnlyHub')}
                            </span>
                          )}
                        </>
                      }
                      confirmLabel={t('skills.remove')}
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate(skill.name)}
                      onCancel={() => setRemoving(null)}
                    />
                  )}
                </SkillRow>
              ))}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}

interface EditorState {
  name: string;
  category: string;
  content: string;
  isNew: boolean;
}

/**
 * SKILL.md is the skill — Hermes has no structured form behind it, so this is a
 * plain text editor with the two checks that decide whether a save can succeed
 * at all, made visible before the round trip rather than after it.
 */
function SkillEditor({
  editor,
  onChange,
  onSave,
  onCancel,
  pending,
}: {
  editor: EditorState;
  onChange: (next: EditorState) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
}) {
  const { t } = useI18n();

  /** An existing skill opens empty and is filled once its file arrives. */
  const loading = !editor.isNew && editor.content === '';
  const description = frontmatterDescription(editor.content);
  const tooLong =
    editor.isNew && description !== null && description.length > NEW_SKILL_DESCRIPTION_LIMIT;
  const nameOk = /^[A-Za-z0-9._-]+$/.test(editor.name);
  const canSave = !pending && nameOk && editor.content.trim() !== '' && !tooLong;

  return (
    <section className="card mb-4 space-y-3 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1">
          <span className="text-xs text-[var(--color-ink-faint)]">{t('skills.name')}</span>
          <input
            value={editor.name}
            // The name is the directory; renaming would be a move, not an edit.
            disabled={!editor.isNew}
            onChange={(event) => {
              const name = event.target.value;
              const templateUnchanged = editor.content === skillTemplate(editor.name);
              onChange({
                ...editor,
                name,
                content: templateUnchanged ? skillTemplate(name) : editor.content,
              });
            }}
            placeholder="my-skill"
            className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-sm outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-60"
          />
        </label>
        {editor.isNew && (
          <label className="min-w-0 flex-1">
            <span className="text-xs text-[var(--color-ink-faint)]">
              {t('skills.categoryField')}
            </span>
            <input
              value={editor.category}
              onChange={(event) => onChange({ ...editor, category: event.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            />
          </label>
        )}
      </div>

      {editor.name !== '' && !nameOk && (
        <p className="text-xs text-[var(--color-danger)]">{t('skills.nameInvalid')}</p>
      )}

      {/*
       * An existing skill's SKILL.md arrives after the editor opens, so the box
       * is briefly empty. Saving is blocked meanwhile (canSave wants content),
       * but an empty box reads like an empty skill — hence the note.
       */}
      {loading && <p className="text-xs text-[var(--color-ink-faint)]">{t('common.loading')}</p>}

      <textarea
        value={editor.content}
        onChange={(event) => onChange({ ...editor, content: event.target.value })}
        rows={18}
        spellCheck={false}
        disabled={loading}
        className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-60"
      />

      {tooLong ? (
        <p className="text-xs text-[var(--color-danger)]">
          {t('skills.descTooLong', {
            count: description?.length ?? 0,
            limit: NEW_SKILL_DESCRIPTION_LIMIT,
          })}
        </p>
      ) : (
        <p className="text-xs text-[var(--color-ink-faint)]">
          {editor.isNew ? t('skills.descHint', { limit: NEW_SKILL_DESCRIPTION_LIMIT }) : ''}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canSave}
          onClick={onSave}
          className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-1.5 text-sm text-[var(--color-accent)] disabled:opacity-40"
        >
          {pending ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)]"
        >
          {t('common.cancel')}
        </button>
      </div>
    </section>
  );
}
