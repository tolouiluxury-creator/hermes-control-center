import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Plus, Trash2, Edit2, Play, Pause, Clock
} from 'lucide-react';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import {
  getBots, createBot, updateBot, deleteBot,
  pauseBot, resumeBot, queryKeys
} from '@/lib/api';
import type { Bot } from '@/lib/api';

const ACCENTS = ['green', 'blue', 'purple', 'amber', 'rose'] as const;
type Accent = (typeof ACCENTS)[number];

const ACCENT_MAP: Record<Accent, { bg: string; text: string; border: string }> = {
  green: { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30' },
  blue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  purple: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  amber: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  rose: { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' },
};

interface BotFormState {
  name: string;
  description: string;
  profileName: string;
  accent: Accent | null;
}

function BotCard({
  bot,
  onEdit,
  onDelete,
  onToggleState,
}: {
  bot: Bot;
  onEdit: (bot: Bot) => void;
  onDelete: (id: string) => void;
  onToggleState: (bot: Bot) => void;
}) {
  const accent = ACCENT_MAP[(bot.accent as Accent) || 'blue'];
  const active = bot.state === 'active';

  return (
    <div className={`rounded-lg border ${accent.border} ${accent.bg} p-4`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${accent.bg} ${accent.text}`}>
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-white">{bot.name}</h3>
            <p className="text-sm text-gray-400">Profile: {bot.profileName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(bot)}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
            title="Bearbeiten"
          >
            <Edit2 className="w-4 h-4 text-gray-400" />
          </button>
          <button
            onClick={() => onDelete(bot.id)}
            className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors"
            title="Löschen"
          >
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>
        </div>
      </div>

      {bot.description && (
        <p className="text-sm text-gray-300 mb-3 line-clamp-2">{bot.description}</p>
      )}

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {active ? (
            <Play className="w-4 h-4 text-green-400" />
          ) : (
            <Pause className="w-4 h-4 text-amber-400" />
          )}
          <span className={`capitalize ${active ? 'text-green-400' : 'text-amber-400'}`}>
            {active ? 'aktiv' : 'pause'}
          </span>
        </div>
        <button
          onClick={() => onToggleState(bot)}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
            active
              ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
          }`}
        >
          {active ? 'Pausieren' : 'Aktivieren'}
        </button>
      </div>

      <div className="mt-3 pt-3 border-t border-white/5">
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            <span>
              {bot.lastSeenAt
                ? `Gesehen: ${new Date(bot.lastSeenAt).toLocaleDateString('de-DE')}`
                : 'Noch nie aktiv'}
            </span>
          </div>
          <div className="text-right font-mono">ID: {bot.id.slice(0, 8)}…</div>
        </div>
      </div>
    </div>
  );
}

function BotModal({
  isOpen,
  onClose,
  onSubmit,
  initial,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: BotFormState) => void;
  initial?: Bot;
}) {
  const [form, setForm] = useState<BotFormState>({
    name: initial?.name || '',
    description: initial?.description || '',
    profileName: initial?.profileName || '',
    accent: (initial?.accent as Accent | null) || null,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit(form);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-white mb-4">
          {initial ? 'Bot bearbeiten' : 'Neuen Bot erstellen'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Bot-Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              placeholder="z.B. Designer, Coder, Writer"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Hermes-Profile {initial && '(nicht änderbar)'}
            </label>
            <input
              type="text"
              value={form.profileName}
              disabled={!!initial}
              onChange={(e) => setForm({ ...form, profileName: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="z.B. designer, coder, ehsan"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Beschreibung
            </label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 resize-none"
              rows={3}
              placeholder="Was macht dieser Bot?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Farbe
            </label>
            <div className="flex gap-2">
              {ACCENTS.map((accent) => (
                <button
                  key={accent}
                  type="button"
                  onClick={() => setForm({ ...form, accent })}
                  className={`w-8 h-8 rounded-full ${ACCENT_MAP[accent].bg} border-2 ${
                    form.accent === accent ? 'border-white' : 'border-transparent'
                  } transition-all`}
                  title={accent}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              {initial ? 'Speichern' : 'Erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BotsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBot, setEditingBot] = useState<Bot | undefined>();

  const bots = useQuery({
    queryKey: queryKeys.bots(false),
    queryFn: async () => {
      const res = await getBots(false);
      return res.bots.map((b) => b.bot);
    },
    staleTime: 10_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.bots(false) });

  const createMutation = useMutation({
    mutationFn: createBot,
    onSuccess: () => {
      invalidate();
      toast.push({ tone: 'success', title: 'Bot erstellt' });
      setModalOpen(false);
      setEditingBot(undefined);
    },
    onError: () => {
      toast.push({ tone: 'error', title: 'Fehler', description: 'Bot konnte nicht erstellt werden.' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateBot>[1] }) =>
      updateBot(id, patch),
    onSuccess: () => {
      invalidate();
      toast.push({ tone: 'success', title: 'Bot aktualisiert' });
      setModalOpen(false);
      setEditingBot(undefined);
    },
    onError: () => {
      toast.push({ tone: 'error', title: 'Fehler', description: 'Bot konnte nicht aktualisiert werden.' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBot,
    onSuccess: () => {
      invalidate();
      toast.push({ tone: 'success', title: 'Bot gelöscht' });
    },
    onError: () => {
      toast.push({ tone: 'error', title: 'Fehler', description: 'Bot konnte nicht gelöscht werden.' });
    },
  });

  const stateMutation = useMutation({
    mutationFn: (bot: Bot) =>
      bot.state === 'active' ? pauseBot(bot.id) : resumeBot(bot.id),
    onSuccess: () => {
      invalidate();
    },
    onError: () => {
      toast.push({ tone: 'error', title: 'Fehler', description: 'Status konnte nicht geändert werden.' });
    },
  });

  const handleCreate = useCallback(
    (data: BotFormState) => {
      createMutation.mutate({
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        profileName: data.profileName.trim() || undefined,
        accent: data.accent,
      });
    },
    [createMutation],
  );

  const handleUpdate = useCallback(
    (data: BotFormState) => {
      if (!editingBot) return;
      updateMutation.mutate({
        id: editingBot.id,
        patch: {
          name: data.name.trim(),
          description: data.description.trim(),
          accent: data.accent,
        },
      });
    },
    [editingBot, updateMutation],
  );

  const handleEdit = useCallback((bot: Bot) => {
    setEditingBot(bot);
    setModalOpen(true);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      const bot = bots.data?.find((b) => b.id === id);
      if (window.confirm(`Bot "${bot?.name ?? id}" wirklich löschen?`)) {
        deleteMutation.mutate(id);
      }
    },
    [bots.data, deleteMutation],
  );

  const handleToggleState = useCallback(
    (bot: Bot) => {
      stateMutation.mutate(bot);
    },
    [stateMutation],
  );

  return (
    <PageShell title="Bots" icon={Bot}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Bot-Verwaltung</h1>
            <p className="text-gray-400 mt-1">
              Verwalte deine KI-Bots — erstellen, bearbeiten, aktivieren/pausieren
            </p>
          </div>
          <button
            onClick={() => {
              setEditingBot(undefined);
              setModalOpen(true);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Bot erstellen</span>
          </button>
        </div>

        {/* Loading State */}
        {bots.isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-gray-700 bg-gray-900/50 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <SkeletonText width={40} height={40} />
                  <div className="space-y-2 flex-1">
                    <SkeletonText width={100} />
                    <SkeletonText width={60} />
                  </div>
                </div>
                <SkeletonText width="100%" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {bots.isError && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Bot className="w-12 h-12 mb-4 text-red-400" />
            <p className="text-lg font-medium">Fehler beim Laden</p>
            <p className="text-sm mt-1">Die Bot-Daten konnten nicht geladen werden.</p>
          </div>
        )}

        {/* Empty State */}
        {bots.isSuccess && bots.data.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Bot className="w-16 h-16 mb-4 text-gray-600" />
            <p className="text-lg font-medium text-gray-300">Keine Bots registriert</p>
            <p className="text-sm mt-1 mb-4">Erstelle deinen ersten Bot, um zu starten.</p>
            <button
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Ersten Bot erstellen</span>
            </button>
          </div>
        )}

        {/* Bot Grid */}
        {bots.isSuccess && bots.data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bots.data.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggleState={handleToggleState}
              />
            ))}
          </div>
        )}

        {/* Stats Footer */}
        {bots.isSuccess && bots.data.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mt-8">
            <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 text-center">
              <div className="text-2xl font-bold text-white">{bots.data.length}</div>
              <div className="text-sm text-gray-400">Gesamt</div>
            </div>
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-center">
              <div className="text-2xl font-bold text-green-400">
                {bots.data.filter((b) => b.state === 'active').length}
              </div>
              <div className="text-sm text-green-400/70">Aktiv</div>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-center">
              <div className="text-2xl font-bold text-amber-400">
                {bots.data.filter((b) => b.state === 'paused').length}
              </div>
              <div className="text-sm text-amber-400/70">Pause</div>
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      <BotModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingBot(undefined);
        }}
        onSubmit={editingBot ? handleUpdate : handleCreate}
        initial={editingBot}
      />
    </PageShell>
  );
}