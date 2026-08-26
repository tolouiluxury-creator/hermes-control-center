import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { MessagesSquare, MessageSquare, Plus, Send, Trash2, UserPlus, Users } from 'lucide-react';
import {
  createGroupRoom,
  deliberateGroupRoom,
  deleteGroupRoom,
  getBots,
  getGroupRoom,
  getGroupRooms,
  queryKeys,
  sendGroupRoomMessage,
  setGroupRoomMembers,
  type GroupMessage,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { useI18n } from '@/lib/i18n';
import { useToast } from '@/components/Toast';

export function GroupRoomsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('room');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [deliberating, setDeliberating] = useState(false);
  /** Solange dieser Zeitpunkt nicht erreicht ist, wird die Raum-Abfrage alle 4s
   *  nachgezogen — die Bot-Antworten treffen nach dem Senden im Hintergrund ein. */
  const [pollUntil, setPollUntil] = useState<number | null>(null);
  const [editingMembers, setEditingMembers] = useState(false);
  const [memberDraft, setMemberDraft] = useState<string[]>([]);

  const rooms = useQuery({ queryKey: queryKeys.rooms, queryFn: getGroupRooms, staleTime: 15_000 });
  const bots = useQuery({ queryKey: queryKeys.bots(false), queryFn: () => getBots(false), staleTime: 15_000 });
  const room = useQuery({
    queryKey: queryKeys.room(selectedId ?? '__none__'),
    queryFn: () => getGroupRoom(selectedId as string),
    enabled: !!selectedId,
    // Bot-Antworten treffen im Hintergrund ein — solange das Polling-Fenster
    // aktiv ist, alle 4s nachziehen, damit Antworten sofort sichtbar werden.
    refetchInterval: pollUntil && Date.now() < pollUntil ? 4000 : false,
  });

  const createRoom = async () => {
    if (!newName.trim() || newMembers.length === 0) return;
    const created = await createGroupRoom(newName.trim(), newMembers);
    setCreating(false);
    setNewName('');
    setNewMembers([]);
    await queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    setSearchParams({ room: created.room.id });
    toast.push({ tone: 'success', title: t('rooms.created') });
  };

  const removeRoom = async (id: string) => {
    await deleteGroupRoom(id);
    await queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    if (selectedId === id) setSearchParams({});
    toast.push({ tone: 'success', title: t('rooms.deleted') });
  };

  const send = async () => {
    if (!selectedId || !text.trim() || sending) return;
    setSending(true);
    try {
      await sendGroupRoomMessage(selectedId, text.trim());
      setText('');
      // Bot-Antworten treffen jetzt im Hintergrund ein — 2,5 Minuten nachziehen,
      // damit sie alle sichtbar werden (auch nachdem `sending` längst false ist).
      setPollUntil(Date.now() + 150_000);
      await queryClient.invalidateQueries({ queryKey: queryKeys.room(selectedId) });
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('rooms.sendFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSending(false);
    }
  };

  const selectedRoom = rooms.data?.rooms.find((r) => r.room.id === selectedId) ?? null;
  const availableBots = bots.data?.bots ?? [];
  const messages: GroupMessage[] = room.data?.messages ?? [];

  const deliberate = async () => {
    if (!selectedId || deliberating) return;
    setDeliberating(true);
    try {
      await deliberateGroupRoom(selectedId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.room(selectedId) });
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('rooms.deliberationFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeliberating(false);
    }
  };

  const startEditMembers = () => {
    setMemberDraft(selectedRoom?.room.memberBotIds ?? []);
    setEditingMembers(true);
  };

  const saveMembers = async () => {
    if (!selectedId) return;
    try {
      await setGroupRoomMembers(selectedId, memberDraft);
      setEditingMembers(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
      await queryClient.invalidateQueries({ queryKey: queryKeys.room(selectedId) });
      toast.push({ tone: 'success', title: t('rooms.membersSaved') });
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('rooms.membersFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  const toggleMember = (botId: string) =>
    setNewMembers((current) =>
      current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId],
    );

  return (
    <PageShell
      title={t('rooms.title')}
      description={t('rooms.desc')}
      actions={
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)]"
        >
          <Plus size={14} aria-hidden />
          {t('rooms.new')}
        </button>
      }
      wide
    >
      <div className="grid h-full grid-cols-[16rem_1fr] gap-4">
        {/* Room list */}
        <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto">
          {rooms.isPending ? (
            <SkeletonText lines={4} />
          ) : rooms.data?.rooms.length === 0 ? (
            <p className="px-2 text-sm text-[var(--color-ink-muted)]">{t('rooms.empty')}</p>
          ) : (
            rooms.data?.rooms.map((entry) => (
              <button
                key={entry.room.id}
                type="button"
                onClick={() => setSearchParams({ room: entry.room.id })}
                className={`group flex items-center gap-2 rounded-xl border px-3 py-2 text-left ${
                  selectedId === entry.room.id
                    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-hairline)] hover:bg-[var(--color-raised)]'
                }`}
              >
                <MessageSquare size={14} className="shrink-0 text-[var(--color-ink-muted)]" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{entry.room.name}</span>
                <span className="hidden shrink-0 text-[0.65rem] text-[var(--color-ink-faint)] group-hover:inline">
                  {entry.members.length}
                </span>
                <button
                  type="button"
                  aria-label={t('rooms.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeRoom(entry.room.id);
                  }}
                  className="shrink-0 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </button>
            ))
          )}

          {creating && (
            <div className="space-y-2 rounded-xl border border-[var(--color-hairline)] p-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('rooms.namePlaceholder')}
                className="h-9 w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 text-xs"
                aria-label={t('rooms.namePlaceholder')}
              />
              <div className="flex flex-wrap gap-1.5">
                {availableBots.map((entry) => {
                  const picked = newMembers.includes(entry.bot.id);
                  return (
                    <button
                      key={entry.bot.id}
                      type="button"
                      onClick={() => toggleMember(entry.bot.id)}
                      aria-pressed={picked}
                      className={`rounded-lg border px-2 py-1 text-xs ${
                        picked
                          ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                          : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)]'
                      }`}
                    >
                      {entry.bot.name}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void createRoom()}
                disabled={!newName.trim() || newMembers.length === 0}
                className="w-full rounded-lg bg-[var(--color-accent)]/12 px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] disabled:opacity-40"
              >
                {t('rooms.create')}
              </button>
            </div>
          )}
        </aside>

        {/* Room transcript */}
        <section className="flex min-h-0 flex-col rounded-xl border border-[var(--color-hairline)] bg-[var(--color-raised)]">
          {!selectedRoom ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <Users size={26} className="mx-auto text-[var(--color-ink-faint)]" aria-hidden />
                <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t('rooms.select')}</p>
              </div>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-2 border-b border-[var(--color-hairline)] px-4 py-2.5">
                <span className="text-sm font-semibold">{selectedRoom.room.name}</span>
                {editingMembers ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {availableBots.map((entry) => {
                      const picked = memberDraft.includes(entry.bot.id);
                      return (
                        <button
                          key={entry.bot.id}
                          type="button"
                          aria-pressed={picked}
                          onClick={() =>
                            setMemberDraft((cur) =>
                              cur.includes(entry.bot.id)
                                ? cur.filter((id) => id !== entry.bot.id)
                                : [...cur, entry.bot.id],
                            )
                          }
                          className={`rounded-lg border px-2 py-0.5 text-[0.65rem] ${
                            picked
                              ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                              : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)]'
                          }`}
                        >
                          {entry.bot.name}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => void saveMembers()}
                      disabled={memberDraft.length === 0}
                      className="rounded-lg bg-[var(--color-accent)]/12 px-2 py-0.5 text-[0.65rem] font-medium text-[var(--color-accent)] disabled:opacity-40"
                    >
                      {t('common.save')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingMembers(false)}
                      className="rounded-lg border border-[var(--color-hairline)] px-2 py-0.5 text-[0.65rem] text-[var(--color-ink-muted)]"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-xs text-[var(--color-ink-faint)]">
                      {selectedRoom.members.map((m) => m.name).join(', ')}
                    </span>
                    <button
                      type="button"
                      onClick={startEditMembers}
                      title={t('rooms.editMembers')}
                      aria-label={t('rooms.editMembers')}
                      className="rounded-md p-1 text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
                    >
                      <UserPlus size={13} aria-hidden />
                    </button>
                  </>
                )}
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className="flex flex-col">
                    <span
                      className={`text-[0.65rem] font-medium ${
                        m.kind === 'user' ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      {m.kind === 'user' ? t('rooms.you') : (m.senderBotName ?? m.senderBotId ?? '?')}
                    </span>
                    <span className="text-sm">{m.text}</span>
                  </div>
                ))}
              </div>
              <footer className="flex items-center gap-2 border-t border-[var(--color-hairline)] p-2">
                <button
                  type="button"
                  onClick={() => void deliberate()}
                  disabled={deliberating}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-hairline)] px-3 text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-accent)] disabled:opacity-50"
                  title={t('rooms.deliberate')}
                >
                  <MessagesSquare size={12} aria-hidden />
                  {deliberating ? t('rooms.deliberating') : t('rooms.deliberate')}
                </button>
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void send();
                  }}
                  placeholder={t('rooms.messagePlaceholder')}
                  className="h-9 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 text-xs"
                  aria-label={t('rooms.messagePlaceholder')}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!text.trim() || sending}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)]/12 px-3 text-xs font-medium text-[var(--color-accent)] disabled:opacity-40"
                >
                  <Send size={12} aria-hidden />
                  {sending ? t('rooms.sending') : t('rooms.send')}
                </button>
              </footer>
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}