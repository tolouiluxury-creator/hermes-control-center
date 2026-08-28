import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Pencil,
  Radio,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  createBot,
  deleteBot,
  getModelOptions,
  getBots,
  getCronJobs,
  getCronDeliveryTargets,
  getProfiles,
  pauseBot,
  queryKeys,
  resumeBot,
  updateBot,
  archiveBot,
  setBotHidden,
  setBotRoutine,
  unlinkBotRoutine,
  createCronJob,
  type BotDetails,
} from '@/lib/api';
import { botModelChoices } from '@/lib/botModelChoices';
import { buildSchedule, DEFAULT_DRAFT, type ScheduleDraft } from '@/lib/schedule';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { ScheduleField } from '@/components/ScheduleField';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { botStatus } from '@/lib/botStatus';

const ACCENTS = [
  { key: null, label: 'Standard', value: 'var(--color-accent)' },
  { key: 'green', label: 'Grün', value: '#22c55e' },
  { key: 'blue', label: 'Blau', value: '#3b82f6' },
  { key: 'purple', label: 'Violett', value: '#a855f7' },
  { key: 'amber', label: 'Amber', value: '#f59e0b' },
  { key: 'rose', label: 'Rose', value: '#f43f5e' },
] as const;

const STICKERS = [
  '🤖', '🧠', '⚡', '🎯', '🚀', '👾', '🛸', '🧙',
  '🦊', '🐱', '🐶', '🐼', '🦉', '🐝', '🌈', '🔥',
  '💎', '🔮', '🧩', '🎨', '🖥️', '🧑‍💻', '👨‍💻', '🤝',
  '💡', '📚', '🔍', '📊', '📈', '📝', '✍️', '🗣️',
  '🌍', '🌙', '⭐', '☀️', '🍀', '🦾', '🎓', '🏆',
] as const;

function BotAvatar({
  bot,
  size = 44,
}: {
  bot: Pick<BotDetails['bot'], 'name' | 'avatarKey' | 'accent'>;
  size?: number;
}) {
  const accent =
    ACCENTS.find((a) => a.key === bot.accent)?.value ?? 'var(--color-accent)';
  return (
    <span
      className="grid shrink-0 place-items-center rounded-2xl text-white ring-2 ring-[var(--color-accent)]/25 ring-offset-2 ring-offset-[var(--color-base)]"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${accent}, color-mix(in oklab, ${accent} 55%, black))`,
        fontSize: Math.round(size * 0.45),
      }}
      aria-hidden
    >
      {bot.avatarKey || '🤖'}
    </span>
  );
}

function PresenceDot({ bot }: { bot: BotDetails['bot'] }) {
  const active = bot.lastSeenAt != null && Date.now() - bot.lastSeenAt < 90_000;
  if (!active) return null;
  return (
    <span className="relative flex h-2.5 w-2.5" aria-label="Active now">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-ok)] opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-ok)]" />
    </span>
  );
}

function BotHealth({ bot }: { bot: BotDetails }) {
  const channels = bot.messaging?.platforms ?? [];
  const status = botStatus({ state: bot.bot.state, platforms: channels });
  const color =
    status === 'online'
      ? 'bg-[var(--color-ok)] shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-ok)_12%,transparent)]'
      : status === 'setup'
        ? 'bg-[var(--color-warn)]'
        : 'bg-[var(--color-ink-faint)]';
  return (
    <div className="flex items-center gap-1.5" aria-label={status}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[0.68rem] text-[var(--color-ink-muted)]">{status}</span>
    </div>
  );
}

function BotCard({
  bot,
  selected,
  onSelect,
}: {
  bot: BotDetails;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`card card-hover group relative overflow-hidden p-4 text-left ${selected ? 'border-[var(--color-accent)]/50 ring-1 ring-[var(--color-accent)]/20' : ''}`}
    >
      <span
        className="absolute top-0 right-0 h-20 w-20 rounded-full bg-[var(--color-accent)]/5 blur-xl transition-transform group-hover:scale-150"
        aria-hidden
      />
      <span className="relative flex items-start gap-3">
        <BotAvatar bot={bot.bot} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block truncate text-sm font-semibold">{bot.bot.name}</span>
            <PresenceDot bot={bot.bot} />
          </span>
          <span className="mt-0.5 block truncate font-mono text-[0.68rem] text-[var(--color-ink-faint)]">
            {bot.bot.profileName}
          </span>
        </span>
        <BotHealth bot={bot} />
      </span>
      <span className="relative mt-4 block min-h-9 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        {bot.bot.description || '—'}
      </span>
      <span className="relative mt-4 flex items-center gap-3 border-t border-[var(--color-hairline)] pt-3 text-[0.68rem] text-[var(--color-ink-faint)]">
        <span>{bot.profile?.model ?? 'model —'}</span>
        <span aria-hidden>·</span>
        <span>{bot.profile?.skillCount ?? 0} skills</span>
        {bot.bot.state === 'paused' ? (
          <span className="ms-auto inline-flex items-center gap-1 font-medium text-[var(--color-warn)]">
            <Pause size={10} aria-hidden />
            {t('bots.statePaused')}
          </span>
        ) : (
          <span className="ms-auto inline-flex items-center gap-1 font-medium text-[var(--color-ok)]">
            <Play size={10} aria-hidden />
            {t('bots.stateActive')}
          </span>
        )}
      </span>
    </button>
  );
}

export function BotsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(
    () => searchParams.get('bot') ?? null,
  );
  const [creating, setCreating] = useState(() => searchParams.get('create') === '1');
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    description: '',
    cloneFrom: '',
    modelChoice: '',
  });
  // Routine-Option beim Erstellen: optional einen Job mitgeben
  const [createWithRoutine, setCreateWithRoutine] = useState(false);
  const [createRoutineDraft, setCreateRoutineDraft] = useState({ name: '', prompt: '' });
  const [createScheduleDraft, setCreateScheduleDraft] = useState<ScheduleDraft>(DEFAULT_DRAFT);
  const [createDeliver, setCreateDeliver] = useState('local');
  const [confirmPause, setConfirmPause] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editDraft, setEditDraft] = useState({
    name: '',
    description: '',
    modelChoice: '',
  });
  const [avatarDraft, setAvatarDraft] = useState('');
  const [accentDraft, setAccentDraft] = useState<string | null>(null);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [quickRoutinePick, setQuickRoutinePick] = useState('');
  const [routineCreating, setRoutineCreating] = useState(false);
  /** Formular offen vs. API-Call läuft — getrennt, damit der Button nie „läuft" zeigt, solange nur das Formular offen ist. */
  const [routineFormOpen, setRoutineFormOpen] = useState(false);
  const [routineDraft, setRoutineDraft] = useState({ name: '', prompt: '' });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(DEFAULT_DRAFT);
  const [deliver, setDeliver] = useState('local');

  const bots = useQuery({
    queryKey: queryKeys.bots(showArchived),
    queryFn: () => getBots(showArchived),
    staleTime: 15_000,
  });
  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 60_000,
  });
  const modelOptions = useQuery({
    queryKey: queryKeys.models,
    queryFn: getModelOptions,
    staleTime: 60_000,
  });
  const cronJobs = useQuery({
    queryKey: queryKeys.cron,
    queryFn: getCronJobs,
    staleTime: 60_000,
  });
  const deliverTargets = useQuery({
    queryKey: queryKeys.cronDeliveryTargets,
    queryFn: getCronDeliveryTargets,
    staleTime: 60_000,
  });
  const modelChoices = botModelChoices(modelOptions.data);
  const roster =
    bots.data?.bots.filter((entry) => (showArchived ? entry.bot.hidden : !entry.bot.hidden)) ?? [];
  const selected = roster.find((bot) => bot.bot.id === selectedId) ?? null;
  // A bot's routines often live in that bot's own profile, not in the default
  // profile the CC UI runs under. Load the selected bot's cron jobs too, so
  // routine IDs resolve to real names instead of raw IDs.
  const botCronJobs = useQuery({
    queryKey: [...queryKeys.cron, 'bot-profile', selected?.bot.profileName ?? '__none__'],
    queryFn: () => getCronJobs(selected?.bot.profileName),
    enabled: !!selected?.bot.profileName,
    staleTime: 60_000,
  });

  const selectBot = (bot: BotDetails) => {
    setSelectedId(bot.bot.id);
    setSearchParams({ bot: bot.bot.id }, { replace: true });
    setAvatarDraft(bot.bot.avatarKey ?? '');
    setAccentDraft(bot.bot.accent ?? null);
    setEditing(false);
    setConfirmArchive(false);
    setConfirmDelete(false);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bots'] });
  const create = useMutation({
    mutationFn: () =>
      createBot({
        name: draft.name,
        description: draft.description || undefined,
        cloneFrom: draft.cloneFrom || undefined,
        ...(draft.modelChoice
          ? {
              provider: draft.modelChoice.split('|')[0],
              model: draft.modelChoice.split('|').slice(1).join('|'),
            }
          : {}),
      }),
    onSuccess: async (bot) => {
      // Optionale Routine direkt beim Erstellen anlegen + verknüpfen
      if (createWithRoutine) {
        const expression = buildSchedule(createScheduleDraft);
        if (expression && createRoutineDraft.prompt.trim()) {
          try {
            const result = await createCronJob({
              name: createRoutineDraft.name.trim() || `${bot.name} Routine`,
              schedule: expression,
              prompt: createRoutineDraft.prompt.trim(),
              deliver: createDeliver,
              profile: bot.profileName,
            });
            const routineId =
              (result as { id?: string }).id ??
              (result as { job?: { id?: string } }).job?.id ??
              '';
            if (routineId) {
              await setBotRoutine(bot.id, { type: 'cron', routineId, enabled: true });
            }
          } catch (error) {
            toast.push({
              title: t('bots.routine').concat(' ', t('bots.failed')),
              description: error instanceof Error ? error.message : String(error),
              tone: 'error',
            });
          }
        }
      }
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['cron'] });
      setSelectedId(bot.id);
      setSearchParams({ bot: bot.id }, { replace: true });
      setCreating(false);
      setDraft({ name: '', description: '', cloneFrom: '', modelChoice: '' });
      setCreateWithRoutine(false);
      setCreateRoutineDraft({ name: '', prompt: '' });
      setCreateScheduleDraft(DEFAULT_DRAFT);
      setCreateDeliver('local');
      toast.push({ title: t('bots.created'), tone: 'success' });
    },
    onError: (error: Error) =>
      toast.push({ title: t('bots.failed'), description: error.message, tone: 'error' }),
  });
  const state = useMutation({
    mutationFn: () =>
      selected?.bot.state === 'paused'
        ? resumeBot(selected.bot.id)
        : pauseBot(selected?.bot.id ?? ''),
    onSuccess: async (result) => {
      await refresh();
      setConfirmPause(false);
      for (const warning of result.warnings)
        toast.push({ title: t('bots.partial'), description: warning, tone: 'warning' });
      toast.push({ title: t('bots.stateChanged'), tone: 'success' });
    },
    onError: (error: Error) =>
      toast.push({ title: t('bots.failed'), description: error.message, tone: 'error' }),
  });
  const hide = useMutation({
    mutationFn: () => archiveBot(selected?.bot.id ?? ''),
    onSuccess: async () => {
      await refresh();
      setSelectedId(null);
      setSearchParams({}, { replace: true });
      setConfirmArchive(false);
      toast.push({ title: t('bots.archived'), tone: 'success' });
    },
    onError: (error: Error) =>
      toast.push({ title: t('bots.failed'), description: error.message, tone: 'error' }),
  });
  const restore = useMutation({
    mutationFn: () => setBotHidden(selected?.bot.id ?? '', false),
    onSuccess: async () => {
      await refresh();
      setSelectedId(null);
      toast.push({ title: t('bots.restored'), tone: 'success' });
    },
    onError: (error: Error) =>
      toast.push({ title: t('bots.failed'), description: error.message, tone: 'error' }),
  });
  const update = useMutation({
    mutationFn: () => {
      const [provider, ...modelParts] = editDraft.modelChoice.split('|');
      return updateBot(selected?.bot.id ?? '', {
        name: editDraft.name,
        description: editDraft.description,
        ...(editDraft.modelChoice ? { provider, model: modelParts.join('|') } : {}),
      });
    },
    onSuccess: async () => {
      await refresh();
      setEditing(false);
      toast.push({ title: t('bots.updated'), tone: 'success' });
    },
    onError: (error: Error) =>
      toast.push({ title: t('bots.failed'), description: error.message, tone: 'error' }),
  });
  const remove = useMutation({
    mutationFn: () => deleteBot(selected?.bot.id ?? ''),
    onSuccess: async () => {
      await refresh();
      setSelectedId(null);
      setSearchParams({}, { replace: true });
      setConfirmDelete(false);
      toast.push({ title: t('bots.deleted'), tone: 'success' });
    },
    onError: (error: Error) =>
      toast.push({ title: t('bots.failed'), description: error.message, tone: 'error' }),
  });

  const beginEdit = () => {
    if (!selected) return;
    setEditDraft({
      name: selected.bot.name,
      description: selected.bot.description,
      modelChoice:
        selected.profile?.provider && selected.profile.model
          ? `${selected.profile.provider}|${selected.profile.model}`
          : '',
    });
    setEditing(true);
    setConfirmArchive(false);
    setConfirmDelete(false);
  };

  const saveAvatar = async () => {
    if (!selected) return;
    setAvatarSaving(true);
    try {
      await updateBot(selected.bot.id, {
        avatarKey: avatarDraft || null,
        accent: accentDraft,
      });
      await refresh();
      toast.push({ title: t('bots.updated'), tone: 'success' });
    } catch (error) {
      toast.push({
        title: t('bots.failed'),
        description: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    } finally {
      setAvatarSaving(false);
    }
  };

  const toggleRoutine = async (routineId: string, enabled: boolean) => {
    if (!selected) return;
    try {
      await setBotRoutine(selected.bot.id, { type: 'cron', routineId, enabled });
      await refresh();
    } catch (error) {
      toast.push({
        title: t('bots.failed'),
        description: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  };

  const removeRoutine = async (routineId: string) => {
    if (!selected) return;
    try {
      await unlinkBotRoutine(selected.bot.id, { type: 'cron', routineId });
      await refresh();
    } catch (error) {
      toast.push({
        title: t('bots.failed'),
        description: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    }
  };

  const createRoutine = async () => {
    if (!selected) return;
    const expression = buildSchedule(scheduleDraft);
    if (!expression) {
      toast.push({
        title: t('bots.failed'),
        description: t('schedule.incomplete'),
        tone: 'error',
      });
      return;
    }
    // Prompt-Pflicht (Server: "A job needs a prompt or at least one skill")
    if (!routineDraft.prompt.trim()) {
      toast.push({
        title: t('bots.failed'),
        description: t('bots.routinePromptNeeded'),
        tone: 'error',
      });
      return;
    }
    setRoutineCreating(true);
    try {
      const result = await createCronJob({
        name: routineDraft.name.trim() || `${selected.bot.name} Routine`,
        schedule: expression,
        prompt: routineDraft.prompt.trim(),
        deliver,
        // Bot-Cron im eigenen Profil anlegen (Desktop-Verhalten)
        profile: selected.bot.profileName,
      });
      // Antwort enthält das volle Cron-Objekt (id direkt oder unter job)
      const routineId =
        (result as { id?: string }).id ??
        (result as { job?: { id?: string } }).job?.id ??
        String((result as { jobId?: string | number })?.jobId ?? '');
      if (!routineId) {
        toast.push({
          title: t('bots.failed'),
          description: 'Routine erstellt, aber ID fehlt in Antwort',
          tone: 'error',
        });
        return;
      }
      await setBotRoutine(selected.bot.id, { type: 'cron', routineId, enabled: true });
      await queryClient.invalidateQueries({ queryKey: ['cron'] });
      await refresh();
      toast.push({ title: t('bots.routineCreated'), tone: 'success' });
    } catch (error) {
      toast.push({
        title: t('bots.failed'),
        description: error instanceof Error ? error.message : String(error),
        tone: 'error',
      });
    } finally {
      setRoutineCreating(false);
    }
    setRoutineDraft({ name: '', prompt: '' });
    setScheduleDraft(DEFAULT_DRAFT);
    setDeliver('local');
  };

  const linkedRoutineIds = new Set(
    (selected?.routines ?? []).filter((r) => r.enabled).map((r) => r.routineId),
  );
  const availableCrons = cronJobs.data?.filter((job) => !linkedRoutineIds.has(job.id)) ?? [];

  return (
    <PageShell
      wide
      title={t('nav.bots')}
      description={t('page.bots.desc')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/bots/chats')}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
          >
            <MessageCircle size={14} aria-hidden />
            {t('bots.chatCenterTitle')}
          </button>
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)]"
          >
            <Plus size={14} aria-hidden />
            {t('bots.new')}
          </button>
        </div>
      }
    >
      {creating && (
        <section className="card mb-5 grid gap-3 p-5 lg:grid-cols-4">
          <div className="lg:col-span-4">
            <h3 className="text-sm font-semibold">{t('bots.createTitle')}</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t('bots.createDesc')}</p>
          </div>
          <label className="text-xs text-[var(--color-ink-faint)]">
            {t('bots.name')}
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
              placeholder="Researcher"
            />
          </label>
          <label className="text-xs text-[var(--color-ink-faint)]">
            {t('bots.clone')}
            <select
              value={draft.cloneFrom}
              onChange={(event) => setDraft({ ...draft, cloneFrom: event.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none"
            >
              <option value="">{t('bots.cloneNone')}</option>
              {profiles.data?.profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--color-ink-faint)]">
            {t('bots.modelChoice')}
            <select
              value={draft.modelChoice}
              onChange={(event) => setDraft({ ...draft, modelChoice: event.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            >
              {modelChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.value === '' ? t('bots.modelInherit') : choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--color-ink-faint)]">
            {t('bots.description')}
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              className="mt-1 w-full rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
            />
          </label>
          <div className="lg:col-span-4">
            <button
              type="button"
              aria-pressed={createWithRoutine}
              onClick={() => setCreateWithRoutine((value) => !value)}
              className="inline-flex items-center gap-2 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded border transition-colors ${
                  createWithRoutine
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
                    : 'border-[var(--color-hairline)]'
                }`}
              >
                {createWithRoutine && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                    <path
                      d="M2 5.2 4.2 7.4 8 2.6"
                      stroke="white"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              {t('bots.createWithRoutine')}
            </button>
            {createWithRoutine && (
              <div className="mt-3 grid gap-3 rounded-xl border border-[var(--color-hairline)] p-3 lg:grid-cols-2">
                <label className="block text-xs text-[var(--color-ink-faint)]">
                  {t('bots.routineName')}
                  <input
                    value={createRoutineDraft.name}
                    onChange={(event) =>
                      setCreateRoutineDraft({ ...createRoutineDraft, name: event.target.value })
                    }
                    placeholder={t('bots.routineName')}
                    className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                  />
                </label>
                <label className="block text-xs text-[var(--color-ink-faint)]">
                  {t('tasks.form.deliver')}
                  <select
                    value={createDeliver}
                    onChange={(event) => setCreateDeliver(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                  >
                    {(deliverTargets.data ?? []).map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="lg:col-span-2">
                  <ScheduleField draft={createScheduleDraft} onChange={setCreateScheduleDraft} />
                </div>
                <label className="block text-xs text-[var(--color-ink-faint)] lg:col-span-2">
                  {t('bots.routinePrompt')}
                  <textarea
                    value={createRoutineDraft.prompt}
                    onChange={(event) =>
                      setCreateRoutineDraft({ ...createRoutineDraft, prompt: event.target.value })
                    }
                    placeholder={t('bots.routinePrompt')}
                    rows={2}
                    className="mt-1 w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                  />
                </label>
              </div>
            )}
          </div>
          <div className="flex gap-2 lg:col-span-4">
            <button
              type="button"
              disabled={create.isPending || !draft.name.trim()}
              onClick={() => create.mutate()}
              className="rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              {create.isPending ? t('common.running') : t('bots.create')}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
            >
              {t('common.cancel')}
            </button>
          </div>
        </section>
      )}

      {bots.isPending ? (
        <SkeletonText lines={8} />
      ) : bots.error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {bots.error.message}
        </p>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">
                {showArchived ? t('bots.archivedBots') : t('bots.roster')} · {roster.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowArchived((value) => !value);
                  setSelectedId(null);
                }}
                aria-pressed={showArchived}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                  showArchived
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-ink)]'
                }`}
              >
                <Archive size={13} aria-hidden />
                {showArchived ? t('bots.activeBots') : t('bots.showArchived')}
              </button>
            </div>
            {roster.length === 0 ? (
              <div className="card grid min-h-56 place-items-center p-8 text-center">
                <Sparkles className="text-[var(--color-accent)]" size={26} aria-hidden />
                <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t('bots.empty')}</p>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {roster.map((bot) => (
                  <BotCard
                    key={bot.bot.id}
                    bot={bot}
                    selected={bot.bot.id === selectedId}
                    onSelect={() => selectBot(bot)}
                  />
                ))}
              </div>
            )}
          </section>
          <aside className="card overflow-hidden p-5">
            {selected ? (
              <>
                <div className="flex items-start gap-3">
                  <BotAvatar bot={selected.bot} size={48} />
                  <div className="min-w-0">
                    <h3 className="flex items-center gap-2 truncate text-lg font-semibold">
                      {selected.bot.name}
                      <PresenceDot bot={selected.bot} />
                    </h3>
                    <p className="font-mono text-[0.68rem] text-[var(--color-ink-faint)]">
                      {selected.bot.profileName}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-[var(--color-subtle)] p-3">
                    <Radio className="mx-auto text-[var(--color-accent)]" size={15} aria-hidden />
                    <p className="mt-1 text-lg font-semibold">
                      {selected.messaging?.enabledCount ?? 0}
                    </p>
                    <p className="text-[0.65rem] text-[var(--color-ink-faint)]">
                      {t('bots.channels')}
                    </p>
                  </div>
                  <div className="rounded-xl bg-[var(--color-subtle)] p-3">
                    <Sparkles
                      className="mx-auto text-[var(--color-accent)]"
                      size={15}
                      aria-hidden
                    />
                    <p className="mt-1 text-lg font-semibold">
                      {selected.profile?.skillCount ?? 0}
                    </p>
                    <p className="text-[0.65rem] text-[var(--color-ink-faint)]">
                      {t('bots.skills')}
                    </p>
                  </div>
                </div>
                <dl className="mt-5 space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--color-ink-faint)]">{t('bots.model')}</dt>
                    <dd className="truncate text-right">{selected.profile?.model ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--color-ink-faint)]">{t('bots.gateway')}</dt>
                    <dd className="text-right">
                      {selected.profile?.gatewayRunning ? t('bots.online') : t('bots.offline')}
                    </dd>
                  </div>
                  {selected.bot.lastSeenAt != null && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-[var(--color-ink-faint)]">{t('bots.lastSeen')}</dt>
                      <dd className="text-right">
                        {new Date(selected.bot.lastSeenAt).toLocaleString()}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="mt-4 space-y-3 rounded-xl border border-[var(--color-hairline)] p-3">
                  <label className="block text-xs text-[var(--color-ink-faint)]">
                    {t('bots.avatar')}
                    <div className="mt-1 flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveAvatar()}
                        disabled={avatarSaving}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs text-white disabled:opacity-40"
                      >
                        <Save size={13} aria-hidden />
                        {t('bots.save')}
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-8 gap-1">
                      <button
                        type="button"
                        onClick={() => setAvatarDraft('')}
                        aria-pressed={avatarDraft === ''}
                        className={`grid h-8 w-8 place-items-center rounded-lg text-base transition-colors ${
                          avatarDraft === ''
                            ? 'bg-[var(--color-accent)]/20 ring-1 ring-[var(--color-accent)]'
                            : 'bg-[var(--color-subtle)] hover:bg-[var(--color-hairline)]'
                        }`}
                        title={t('bots.avatarNone')}
                      >
                        🚫
                      </button>
                      {STICKERS.map((sticker) => (
                        <button
                          key={sticker}
                          type="button"
                          onClick={() => setAvatarDraft(sticker)}
                          aria-pressed={avatarDraft === sticker}
                          aria-label={sticker}
                          className={`grid h-8 w-8 place-items-center rounded-lg text-lg transition-transform hover:scale-110 ${
                            avatarDraft === sticker
                              ? 'bg-[var(--color-accent)]/20 ring-1 ring-[var(--color-accent)]'
                              : 'bg-[var(--color-subtle)] hover:bg-[var(--color-hairline)]'
                          }`}
                        >
                          {sticker}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div>
                    <span className="text-xs text-[var(--color-ink-faint)]">{t('bots.accent')}</span>
                    <div className="mt-1.5 flex gap-1.5">
                      {ACCENTS.map((a) => (
                        <button
                          key={a.key ?? 'default'}
                          type="button"
                          aria-label={a.label}
                          aria-pressed={(accentDraft ?? null) === a.key}
                          onClick={() => setAccentDraft(a.key)}
                          className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                            (accentDraft ?? null) === a.key
                              ? 'border-white ring-2 ring-[var(--color-accent)]'
                              : 'border-transparent'
                          }`}
                          style={{ background: a.value }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-2 rounded-xl border border-[var(--color-hairline)] p-3">
                  <span className="text-xs font-semibold text-[var(--color-ink-muted)]">
                    {t('bots.routines')}
                  </span>
                  {selected.routines.length === 0 ? (
                    <p className="text-xs text-[var(--color-ink-faint)]">{t('bots.noRoutines')}</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {selected.routines.map((routine) => {
                        const job =
                        botCronJobs.data?.find((j) => j.id === routine.routineId) ??
                        cronJobs.data?.find((j) => j.id === routine.routineId);
                        return (
                          <li key={routine.routineId} className="flex items-center gap-2 text-xs">
                            <span className="min-w-0 flex-1 truncate">
                              {job?.name ?? routine.routineId}
                            </span>
                            <button
                              type="button"
                              aria-pressed={routine.enabled}
                              onClick={() => toggleRoutine(routine.routineId, !routine.enabled)}
                              className={`rounded-full px-2 py-0.5 text-[0.65rem] ${
                                routine.enabled
                                  ? 'bg-[var(--color-ok)]/15 text-[var(--color-ok)]'
                                  : 'bg-[var(--color-ink-faint)]/10 text-[var(--color-ink-faint)]'
                              }`}
                            >
                              {routine.enabled ? t('bots.routineOn') : t('bots.routineOff')}
                            </button>
                            <button
                              type="button"
                              aria-label={t('bots.removeRoutine')}
                              onClick={() => removeRoutine(routine.routineId)}
                              className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                            >
                              <X size={12} aria-hidden />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex gap-2 pt-1">
                    <select
                      value={quickRoutinePick}
                      onChange={(event) => setQuickRoutinePick(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                    >
                      <option value="">{t('bots.routineSelect')}</option>
                      {availableCrons.map((job) => (
                        <option key={job.id} value={job.id}>
                          {job.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!quickRoutinePick}
                      onClick={async () => {
                        if (!quickRoutinePick) return;
                        await toggleRoutine(quickRoutinePick, true);
                        setQuickRoutinePick('');
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-xs text-white disabled:opacity-40"
                    >
                      <Plus size={12} aria-hidden />
                      {t('bots.addRoutine')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRoutineFormOpen((v) => !v)}
                    className="w-full rounded-lg border border-[var(--color-hairline)] px-2 py-1.5 text-xs text-[var(--color-ink-muted)] hover:border-[var(--color-accent)]/40"
                  >
                    {t('bots.newRoutine')}
                  </button>
                  {routineFormOpen && (
                    <div className="space-y-2 rounded-lg border border-[var(--color-hairline)] p-2">
                      <label className="block text-xs text-[var(--color-ink-faint)]">
                        {t('bots.routineName')}
                        <input
                          value={routineDraft.name}
                          onChange={(event) =>
                            setRoutineDraft({ ...routineDraft, name: event.target.value })
                          }
                          placeholder={t('bots.routineName')}
                          className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                        />
                      </label>
                      <label className="block text-xs text-[var(--color-ink-faint)]">
                        {t('tasks.form.deliver')}
                        <select
                          value={deliver}
                          onChange={(event) => setDeliver(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                        >
                          {(deliverTargets.data ?? []).map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <ScheduleField draft={scheduleDraft} onChange={setScheduleDraft} />
                      <label className="block text-xs text-[var(--color-ink-faint)]">
                        {t('bots.routinePrompt')}
                        <textarea
                          value={routineDraft.prompt}
                          onChange={(event) =>
                            setRoutineDraft({ ...routineDraft, prompt: event.target.value })
                          }
                          placeholder={t('bots.routinePrompt')}
                          rows={3}
                          className="mt-1 w-full resize-y rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
                        />
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={routineCreating}
                          onClick={createRoutine}
                          className="flex-1 rounded-lg bg-[var(--color-accent)] px-2 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          {routineCreating ? t('common.running') : t('bots.routineCreate')}
                        </button>
                        <button
                          type="button"
                          disabled={routineCreating}
                          onClick={() => {
                            setRoutineFormOpen(false);
                            setRoutineCreating(false);
                            setRoutineDraft({ name: '', prompt: '' });
                            setScheduleDraft(DEFAULT_DRAFT);
                            setDeliver('local');
                          }}
                          className="rounded-lg border border-[var(--color-hairline)] px-2 py-1.5 text-xs text-[var(--color-ink-muted)] disabled:opacity-40"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="mt-5 space-y-2">
                  {selected.bot.hidden ? (
                    <button
                      type="button"
                      onClick={() => restore.mutate()}
                      disabled={restore.isPending}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] disabled:opacity-40"
                    >
                      <RotateCcw size={14} aria-hidden />
                      {t('bots.restore')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        navigate(`/bots/chats?bot=${encodeURIComponent(selected.bot.id)}`)
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white"
                    >
                      <MessageCircle size={14} aria-hidden />
                      {t('bots.openChat')}
                    </button>
                  )}
                  {editing ? (
                    <div className="space-y-2 rounded-xl border border-[var(--color-hairline)] p-3">
                      <label className="block text-xs text-[var(--color-ink-faint)]">
                        {t('bots.name')}
                        <input
                          value={editDraft.name}
                          onChange={(event) =>
                            setEditDraft({ ...editDraft, name: event.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                        />
                      </label>
                      <label className="block text-xs text-[var(--color-ink-faint)]">
                        {t('bots.description')}
                        <input
                          value={editDraft.description}
                          onChange={(event) =>
                            setEditDraft({ ...editDraft, description: event.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                        />
                      </label>
                      <label className="block text-xs text-[var(--color-ink-faint)]">
                        {t('bots.modelChoice')}
                        <select
                          value={editDraft.modelChoice}
                          onChange={(event) =>
                            setEditDraft({ ...editDraft, modelChoice: event.target.value })
                          }
                          className="mt-1 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                        >
                          <option value="">{t('bots.modelChangeOptional')}</option>
                          {modelChoices
                            .filter((choice) => choice.value)
                            .map((choice) => (
                              <option key={choice.value} value={choice.value}>
                                {choice.label}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={update.isPending || !editDraft.name.trim()}
                          onClick={() => update.mutate()}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs text-white disabled:opacity-40"
                        >
                          <Save size={13} aria-hidden />
                          {t('bots.save')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-hairline)] px-3 py-2 text-xs text-[var(--color-ink-muted)]"
                        >
                          <X size={13} aria-hidden />
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={beginEdit}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
                    >
                      <Pencil size={14} aria-hidden />
                      {t('bots.edit')}
                    </button>
                  )}
                  {selected.bot.state === 'paused' || !confirmPause ? (
                    <button
                      type="button"
                      onClick={() =>
                        selected.bot.state === 'paused' ? state.mutate() : setConfirmPause(true)
                      }
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-sm text-[var(--color-ink-muted)]"
                    >
                      {selected.bot.state === 'paused' ? (
                        <Play size={14} aria-hidden />
                      ) : (
                        <Pause size={14} aria-hidden />
                      )}
                      {selected.bot.state === 'paused' ? t('bots.resume') : t('bots.pause')}
                    </button>
                  ) : (
                    <ConfirmInline
                      tone="warn"
                      message={t('bots.pauseConfirm')}
                      confirmLabel={t('bots.pause')}
                      pending={state.isPending}
                      onConfirm={() => state.mutate()}
                      onCancel={() => setConfirmPause(false)}
                    />
                  )}
                  {!selected.bot.hidden && !confirmArchive ? (
                    <button
                      type="button"
                      onClick={() => setConfirmArchive(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-xs text-[var(--color-ink-faint)]"
                    >
                      <Archive size={13} aria-hidden />
                      {t('bots.archive')}
                    </button>
                  ) : !selected.bot.hidden ? (
                    <ConfirmInline
                      tone="warn"
                      message={t('bots.archive')}
                      confirmLabel={t('bots.archive')}
                      pending={hide.isPending}
                      onConfirm={() => hide.mutate()}
                      onCancel={() => setConfirmArchive(false)}
                    />
                  ) : null}
                  {!confirmDelete ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-danger)]/30 px-3 py-2 text-xs text-[var(--color-danger)]"
                    >
                      <Trash2 size={13} aria-hidden />
                      {t('bots.deleteForever')}
                    </button>
                  ) : (
                    <ConfirmInline
                      message={t('bots.deleteForeverConfirm')}
                      confirmLabel={t('bots.deleteForever')}
                      pending={remove.isPending}
                      onConfirm={() => remove.mutate()}
                      onCancel={() => setConfirmDelete(false)}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="grid min-h-56 place-items-center text-center">
                <Settings2 className="text-[var(--color-ink-faint)]" size={22} aria-hidden />
                <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t('bots.select')}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </PageShell>
  );
}
