import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Monitor, Moon, Sun } from 'lucide-react';
import {
  deleteEnv,
  getConfigRaw,
  getCurator,
  getEnv,
  getToolsets,
  getUpdate,
  queryKeys,
  runCurator,
  saveConfigRaw,
  setCuratorPaused,
  setEnv,
  toggleToolset,
} from '@/lib/api';
import { FilterChips, PageShell, SearchField } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { useToast } from '@/components/Toast';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { useI18n, LANGUAGES } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';
import type { EnvVar, Toolset } from '@/lib/hermesTypes';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && (
        <p className="mt-0.5 mb-3 max-w-2xl text-xs text-[var(--color-ink-muted)]">{description}</p>
      )}
      {!description && <div className="mb-3" />}
      {children}
    </section>
  );
}

// --- Appearance -------------------------------------------------------------

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: typeof Moon }[] = [
  { id: 'dark', label: 'Dunkel', icon: Moon },
  { id: 'light', label: 'Hell', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
];

const THEME_LABEL_KEY: Record<ThemePreference, string> = {
  dark: 'settings.theme.dark',
  light: 'settings.theme.light',
  system: 'settings.theme.system',
};

function LanguageSection() {
  const { t, lang, setLang } = useI18n();
  return (
    <Section title={t('settings.language')} description={t('settings.language.desc')}>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map(({ id, endonym }) => {
          const active = lang === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setLang(id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              {endonym}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const { t } = useI18n();
  const { preference, setPreference } = useTheme();
  return (
    <Section title={t('settings.appearance')} description={t('settings.appearance.desc')}>
      <div className="flex flex-wrap gap-2">
        {THEME_OPTIONS.map(({ id, icon: Icon }) => {
          const active = preference === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPreference(id)}
              className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                  : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              }`}
            >
              <Icon size={14} aria-hidden />
              {t(THEME_LABEL_KEY[id])}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// --- Toolsets ---------------------------------------------------------------

function ToolsetRow({
  toolset,
  pending,
  onToggle,
}: {
  toolset: Toolset;
  pending: boolean;
  onToggle: (toolset: Toolset) => void;
}) {
  return (
    <li className="flex items-start gap-3 border-b border-[var(--color-hairline)] px-3 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{toolset.label}</span>
          <span className="font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
            {toolset.name}
          </span>
          {!toolset.available && (
            <span className="text-[0.65rem] text-[var(--color-warn)]">nicht verfügbar</span>
          )}
        </div>
        {toolset.description && (
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{toolset.description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={toolset.enabled}
        aria-label={`${toolset.label} ${toolset.enabled ? 'deaktivieren' : 'aktivieren'}`}
        onClick={() => onToggle(toolset)}
        disabled={pending || !toolset.available}
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40"
        style={{ background: toolset.enabled ? 'var(--color-ok)' : 'var(--color-raised)' }}
      >
        <span
          className="absolute top-0.5 size-4 rounded-full bg-white transition-all"
          style={{ left: toolset.enabled ? 'calc(100% - 1.125rem)' : '0.125rem' }}
          aria-hidden
        />
      </button>
    </li>
  );
}

function ToolsetsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.toolsets,
    queryFn: getToolsets,
    staleTime: 30_000,
  });

  const toggle = useMutation({
    mutationFn: (toolset: Toolset) => toggleToolset(toolset.name, !toolset.enabled),
    onSuccess: async (_r, toolset) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.toolsets });
      toast.push({
        tone: 'success',
        title: toolset.enabled ? `„${toolset.label}" deaktiviert` : `„${toolset.label}" aktiviert`,
      });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Umschalten fehlgeschlagen', description: e.message }),
  });

  return (
    <Section title={t('settings.tools')} description={t('settings.tools.desc')}>
      {isPending ? (
        <SkeletonText lines={5} />
      ) : error ? (
        <p className="card p-4 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <ul className="card overflow-hidden p-0">
          {(data ?? []).map((toolset) => (
            <ToolsetRow
              key={toolset.name}
              toolset={toolset}
              pending={toggle.isPending && toggle.variables?.name === toolset.name}
              onToggle={(t) => toggle.mutate(t)}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

// --- Maintenance: update + curator -----------------------------------------

function MaintenanceSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const update = useQuery({ queryKey: queryKeys.update, queryFn: getUpdate, staleTime: 300_000 });
  const curator = useQuery({ queryKey: queryKeys.curator, queryFn: getCurator, staleTime: 60_000 });

  const invalidateCurator = () => queryClient.invalidateQueries({ queryKey: queryKeys.curator });

  const pause = useMutation({
    mutationFn: (paused: boolean) => setCuratorPaused(paused),
    onSuccess: async (_r, paused) => {
      await invalidateCurator();
      toast.push({ tone: 'success', title: paused ? 'Kurator pausiert' : 'Kurator fortgesetzt' });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Fehlgeschlagen', description: e.message }),
  });

  const run = useMutation({
    mutationFn: () => runCurator(),
    onSuccess: async () => {
      await invalidateCurator();
      toast.push({ tone: 'success', title: 'Kurator gestartet' });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Start fehlgeschlagen', description: e.message }),
  });

  return (
    <Section title={t('settings.maintenance')} description={t('settings.maintenance.desc')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs text-[var(--color-ink-faint)]">Version</p>
          {update.isPending ? (
            <SkeletonText lines={2} />
          ) : update.error ? (
            <p className="text-sm text-[var(--color-danger)]">{update.error.message}</p>
          ) : (
            <>
              <p className="mt-1 font-mono text-lg">{update.data?.currentVersion ?? '—'}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                {update.data?.message ?? ''}
              </p>
              {update.data?.updateAvailable && update.data.updateCommand && (
                <p className="mt-2 text-xs text-[var(--color-warn)]">
                  Update verfügbar — auf dem Server:{' '}
                  <code className="font-mono">{update.data.updateCommand}</code>
                </p>
              )}
            </>
          )}
        </div>

        <div className="card p-4">
          <p className="text-xs text-[var(--color-ink-faint)]">Gedächtnis-Kurator</p>
          {curator.isPending ? (
            <SkeletonText lines={2} />
          ) : curator.error ? (
            <p className="text-sm text-[var(--color-danger)]">{curator.error.message}</p>
          ) : (
            <>
              <p className="mt-1 text-sm">
                {curator.data?.paused ? 'pausiert' : curator.data?.enabled ? 'aktiv' : 'aus'}
                {curator.data?.lastRunAt && (
                  <span className="text-[var(--color-ink-faint)]">
                    {' '}
                    · zuletzt {formatRelativeTime(curator.data.lastRunAt)}
                  </span>
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => run.mutate()}
                  disabled={run.isPending}
                  className="rounded-lg border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
                >
                  Jetzt ausführen
                </button>
                <button
                  type="button"
                  onClick={() => pause.mutate(!curator.data?.paused)}
                  disabled={pause.isPending}
                  className="rounded-lg border border-[var(--color-hairline)] px-3 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  {curator.data?.paused ? 'Fortsetzen' : 'Pausieren'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  );
}

// --- Environment variables and secrets --------------------------------------

const ENV_CATEGORY_LABEL: Record<string, string> = {
  provider: 'Anbieter',
  tool: 'Werkzeuge',
  skill: 'Skills',
  messaging: 'Messaging',
  setting: 'Einstellungen',
  sonstige: 'Sonstige',
};

function EnvRow({
  entry,
  editing,
  pending,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  entry: EnvVar;
  editing: boolean;
  pending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState('');

  return (
    <li className="border-b border-[var(--color-hairline)] px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
            entry.isSet ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-ink-faint)]'
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs">{entry.key}</span>
            {entry.isSet && entry.redactedValue && (
              <span className="font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
                {entry.redactedValue}
              </span>
            )}
          </div>
          {entry.description && (
            <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{entry.description}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-40"
          >
            {entry.isSet ? 'Ändern' : 'Setzen'}
          </button>
          {entry.isSet && (
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg px-2 py-1 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-40"
            >
              Löschen
            </button>
          )}
        </div>
      </div>

      {editing && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim() !== '') onSave(value);
          }}
        >
          <input
            type={entry.isPassword ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            placeholder={`Wert für ${entry.key}`}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-1.5 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={pending || value.trim() === ''}
            className="rounded-lg bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)] disabled:opacity-40"
          >
            Speichern
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
          >
            Abbrechen
          </button>
        </form>
      )}
    </li>
  );
}

function EnvSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('gesetzt');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.env,
    queryFn: getEnv,
    staleTime: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.env });

  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => setEnv(key, value),
    onSuccess: async (_r, variables) => {
      setEditing(null);
      await invalidate();
      toast.push({ tone: 'success', title: `${variables.key} gespeichert` });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Speichern fehlgeschlagen', description: e.message }),
  });

  const remove = useMutation({
    mutationFn: (key: string) => deleteEnv(key),
    onSuccess: async (_r, key) => {
      setConfirmDelete(null);
      await invalidate();
      toast.push({ tone: 'success', title: `${key} entfernt` });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Entfernen fehlgeschlagen', description: e.message }),
  });

  const entries = useMemo(() => data ?? [], [data]);
  const categories = useMemo(() => {
    const set = new Set(entries.map((e) => e.category));
    return [...set].sort();
  }, [entries]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (needle === '') {
        // With no search, "gesetzt" shows configured vars; otherwise a category.
        if (category === 'gesetzt') return entry.isSet;
        return entry.category === category;
      }
      return (
        entry.key.toLowerCase().includes(needle) ||
        (entry.description ?? '').toLowerCase().includes(needle)
      );
    });
  }, [entries, search, category]);

  return (
    <Section title={t('settings.env')} description={t('settings.env.desc')}>
      {isPending ? (
        <SkeletonText lines={5} />
      ) : error ? (
        <p className="card p-4 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchField value={search} onChange={setSearch} label="Variablen durchsuchen" />
          </div>
          {search.trim() === '' && (
            <div className="mb-3">
              <FilterChips
                label="Bereich"
                value={category}
                onChange={setCategory}
                options={[
                  { id: 'gesetzt', label: 'Gesetzt', count: entries.filter((e) => e.isSet).length },
                  ...categories.map((id) => ({
                    id,
                    label: ENV_CATEGORY_LABEL[id] ?? id,
                    count: entries.filter((e) => e.category === id).length,
                  })),
                ]}
              />
            </div>
          )}

          <p className="mb-2 text-xs text-[var(--color-ink-faint)]" role="status">
            {visible.length} Variablen
          </p>

          {visible.length === 0 ? (
            <p className="card p-6 text-center text-sm text-[var(--color-ink-muted)]">
              Keine Variable passt zu dieser Auswahl.
            </p>
          ) : (
            <ul className="card overflow-hidden p-0">
              {visible.slice(0, 100).map((entry) => (
                <div key={entry.key}>
                  <EnvRow
                    entry={entry}
                    editing={editing === entry.key}
                    pending={
                      (save.isPending && save.variables?.key === entry.key) ||
                      (remove.isPending && remove.variables === entry.key)
                    }
                    onEdit={() => {
                      setConfirmDelete(null);
                      setEditing(entry.key);
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={(value) => save.mutate({ key: entry.key, value })}
                    onDelete={() => {
                      setEditing(null);
                      setConfirmDelete(entry.key);
                    }}
                  />
                  {confirmDelete === entry.key && (
                    <div className="px-3 pb-2">
                      <ConfirmInline
                        tone="danger"
                        message={<>{entry.key} entfernen? Der Wert geht verloren.</>}
                        confirmLabel="Entfernen"
                        pending={remove.isPending && remove.variables === entry.key}
                        onConfirm={() => remove.mutate(entry.key)}
                        onCancel={() => setConfirmDelete(null)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </ul>
          )}
          {visible.length > 100 && (
            <p className="mt-2 text-xs text-[var(--color-ink-faint)]">
              Nur die ersten 100 werden gezeigt — suche, um weitere zu finden.
            </p>
          )}
        </>
      )}
    </Section>
  );
}

// --- Raw config -------------------------------------------------------------

function ConfigSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirm, setConfirm] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.configRaw,
    queryFn: getConfigRaw,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (yaml: string) => saveConfigRaw(yaml),
    onSuccess: async () => {
      setConfirm(false);
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.configRaw });
      toast.push({ tone: 'success', title: 'Konfiguration gespeichert' });
    },
    onError: (e: Error) =>
      toast.push({ tone: 'error', title: 'Speichern fehlgeschlagen', description: e.message }),
  });

  return (
    <Section title={t('settings.config')} description={t('settings.config.desc')}>
      {isPending ? (
        <SkeletonText lines={6} />
      ) : error ? (
        <p className="card p-4 text-sm text-[var(--color-danger)]" role="alert">
          {error.message}
        </p>
      ) : (
        <div className="card p-4">
          {data?.path && (
            <p className="mb-2 font-mono text-[0.65rem] text-[var(--color-ink-faint)]">
              {data.path}
            </p>
          )}
          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={18}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] p-3 font-mono text-xs outline-none focus-visible:border-[var(--color-accent)]"
              />
              {confirm ? (
                <ConfirmInline
                  tone="danger"
                  message="Konfiguration überschreiben? Ungültiges YAML kann den Agenten beeinträchtigen."
                  confirmLabel="Speichern"
                  pending={save.isPending}
                  onConfirm={() => save.mutate(draft)}
                  onCancel={() => setConfirm(false)}
                />
              ) : (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirm(true)}
                    className="rounded-lg bg-[var(--color-accent)]/10 px-3 py-1.5 text-xs text-[var(--color-accent)]"
                  >
                    Speichern
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-ink-muted)]"
                  >
                    Abbrechen
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <pre className="max-h-72 overflow-auto rounded-lg bg-[var(--color-base)] p-3 font-mono text-xs whitespace-pre-wrap text-[var(--color-ink-muted)]">
                {data?.yaml || '(leer)'}
              </pre>
              <button
                type="button"
                onClick={() => {
                  setDraft(data?.yaml ?? '');
                  setEditing(true);
                }}
                className="mt-2 rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
              >
                Bearbeiten
              </button>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

// --- Security ---------------------------------------------------------------

function SecuritySection() {
  const { t } = useI18n();
  const [before, after] = t('settings.security.password').split('{command}');
  return (
    <Section title={t('settings.security')} description={t('settings.security.desc')}>
      <div className="card flex items-start gap-3 p-4">
        <KeyRound size={16} className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
        <p className="text-xs text-[var(--color-ink-muted)]">
          {before}
          <code className="font-mono text-[var(--color-ink)]">
            hermes-control-center --set-password
          </code>
          {after}
        </p>
      </div>
    </Section>
  );
}

export function EinstellungenPage() {
  const { t } = useI18n();
  return (
    <PageShell title={t('nav.einstellungen')} description={t('page.einstellungen.desc')}>
      <LanguageSection />
      <AppearanceSection />
      <ToolsetsSection />
      <MaintenanceSection />
      <EnvSection />
      <ConfigSection />
      <SecuritySection />
    </PageShell>
  );
}
