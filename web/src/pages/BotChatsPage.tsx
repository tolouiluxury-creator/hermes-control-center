import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { Bot, Plus, Send, Settings2 } from 'lucide-react';
import { getBots, queryKeys, sendBotDM } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { useI18n } from '@/lib/i18n';
import { useToast } from '@/components/Toast';
import { ChatsPage } from './ChatsPage';
import { useState } from 'react';

export function BotChatsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const bots = useQuery({
    queryKey: queryKeys.bots(false),
    queryFn: () => getBots(false),
    staleTime: 15_000,
  });
  const selectedId = searchParams.get('bot') ?? bots.data?.bots[0]?.bot.id ?? null;
  const selected = bots.data?.bots.find((entry) => entry.bot.id === selectedId) ?? null;
  const [dmTargets, setDmTargets] = useState<string[]>([]);
  const [dmText, setDmText] = useState('');
  const [dmSending, setDmSending] = useState(false);
  const [dmResults, setDmResults] = useState<{
    sentAt: number;
    results: { botName?: string; ok: boolean; reply?: string; error?: string }[];
  } | null>(null);
  const [dmStartedAt, setDmStartedAt] = useState<number | null>(null);
  const [dmElapsed, setDmElapsed] = useState(0);

  const toggleDmTarget = (botId: string) =>
    setDmTargets((current) =>
      current.includes(botId) ? current.filter((id) => id !== botId) : [...current, botId],
    );

  const sendDm = async () => {
    if (!selected || dmTargets.length === 0 || dmText.trim() === '' || dmSending) return;
    setDmSending(true);
    setDmResults(null);
    setDmStartedAt(Date.now());
    setDmElapsed(0);
    // Tick the elapsed-seconds label while the handoffs run.
    const ticker = window.setInterval(() => {
      setDmElapsed(Math.round((Date.now() - (dmStartedAt ?? Date.now())) / 1000));
    }, 1000);
    try {
      const res = await sendBotDM(selected.bot.id, dmTargets, dmText.trim());
      setDmText('');
      setDmResults({ sentAt: Date.now(), results: res.results });
      const okCount = res.results.filter((r) => r.ok).length;
      toast.push({
        tone: okCount > 0 ? 'success' : 'error',
        title: okCount > 0 ? t('bots.dmSent') : t('bots.dmFailed'),
        description:
          okCount > 0
            ? `${okCount}/${res.results.length} ${t('bots.dmDelivered')}`
            : t('bots.dmFailed'),
      });
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('bots.dmFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      window.clearInterval(ticker);
      setDmStartedAt(null);
      setDmSending(false);
    }
  };

  const dmStrip =
    selected && bots.data ? (
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-hairline)] bg-[var(--color-raised)] p-2">
        <span className="px-1 text-xs font-medium text-[var(--color-ink-muted)]">
          {t('bots.dmTo')}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {bots.data.bots
            .filter((entry) => entry.bot.id !== selected.bot.id)
            .map((entry) => {
              const picked = dmTargets.includes(entry.bot.id);
              return (
                <button
                  key={entry.bot.id}
                  type="button"
                  onClick={() => toggleDmTarget(entry.bot.id)}
                  aria-pressed={picked}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
                    picked
                      ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                      : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]'
                  }`}
                >
                  <span className="text-sm leading-none" aria-hidden>
                    {entry.bot.avatarKey || '🤖'}
                  </span>
                  {entry.bot.name}
                </button>
              );
            })}
        </div>
        <input
          value={dmText}
          onChange={(event) => setDmText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void sendDm();
          }}
          placeholder={t('bots.dmPlaceholder')}
          className="h-9 min-w-48 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 text-xs"
          aria-label={t('bots.dmPlaceholder')}
        />
        <button
          type="button"
          onClick={() => void sendDm()}
          disabled={dmTargets.length === 0 || dmText.trim() === '' || dmSending}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--color-accent)]/12 px-3 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
        >
          <Send size={12} aria-hidden />
          {dmSending ? t('bots.dmSending') : t('bots.dmSend')}
        </button>
        {dmSending && (
          <div className="flex w-full items-center gap-2 border-t border-[var(--color-hairline)] pt-2 text-xs text-[var(--color-ink-muted)]">
            <span
              className="size-3 shrink-0 animate-spin rounded-full border-2 border-[var(--color-accent)]/30 border-t-[var(--color-accent)]"
              aria-hidden
            />
            {t('bots.dmSending')} … {dmElapsed}s
          </div>
        )}
        {dmResults && (
          <div className="w-full space-y-1.5 border-t border-[var(--color-hairline)] pt-2">
            <p className="text-[0.65rem] uppercase tracking-wide text-[var(--color-ink-faint)]">
              {new Date(dmResults.sentAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            {dmResults.results.map((r, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`mt-0.5 shrink-0 font-medium ${r.ok ? 'text-[var(--color-ok)]' : 'text-[var(--color-danger)]'}`}
                >
                  {r.ok ? '✅' : '❌'} {r.botName ?? '?'}:
                </span>
                <span className="min-w-0 flex-1 text-[var(--color-ink-muted)]">
                  {r.ok ? (r.reply ?? '') : (r.error ?? '')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null;

  const newBotAction = (
    <button
      type="button"
      onClick={() => navigate('/bots?create=1')}
      className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)]"
    >
      <Plus size={14} aria-hidden />
      {t('bots.new')}
    </button>
  );

  if (bots.isPending) {
    return (
      <PageShell
        title={t('bots.chatCenterTitle')}
        description={t('bots.chatCenterDesc')}
        actions={newBotAction}
        wide
      >
        <SkeletonText lines={8} />
      </PageShell>
    );
  }

  if (bots.error) {
    return (
      <PageShell
        title={t('bots.chatCenterTitle')}
        description={t('bots.chatCenterDesc')}
        actions={newBotAction}
        wide
      >
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {bots.error.message}
        </p>
      </PageShell>
    );
  }

  if (!selected) {
    return (
      <PageShell
        title={t('bots.chatCenterTitle')}
        description={t('bots.chatCenterDesc')}
        actions={newBotAction}
        wide
      >
        <div className="card grid min-h-56 place-items-center p-8 text-center">
          <Bot className="text-[var(--color-accent)]" size={26} aria-hidden />
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t('bots.empty')}</p>
          <button
            type="button"
            onClick={() => navigate('/bots')}
            className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-2 text-xs text-[var(--color-ink-muted)]"
          >
            <Settings2 size={13} aria-hidden />
            {t('bots.manage')}
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <ChatsPage
      key={selected.bot.id}
      title={`${t('bots.chatCenterTitle')} · ${selected.bot.name}`}
      description={t('bots.chatCenterDesc')}
      actions={
        <>
          {dmStrip}
          {newBotAction}
        </>
      }
      profileOverride={selected.bot.profileName}
      profileSelectable={false}
      botId={selected.bot.id}
      initialSessionId={selected.bot.canonicalChatSessionId}
      initialModel={selected.profile}
      injectedMessages={
        dmResults?.results
          .filter((r) => r.ok && r.reply)
          .map((r) => ({ sender: r.botName ?? '?', text: r.reply ?? '' })) ?? undefined
      }
      botRoster={{
        bots: bots.data.bots,
        selectedId: selected.bot.id,
        onSelect: (id) => navigate(`/bots/chats?bot=${encodeURIComponent(id)}`),
      }}
    />
  );
}
