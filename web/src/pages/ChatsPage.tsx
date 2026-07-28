import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare, Plus, Send } from 'lucide-react';
import {
  createChatSession,
  getChatHistory,
  getChatSessions,
  resumeChatSession,
  sendChatPrompt,
  type ChatMessage,
  type ChatSessionSummary,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';

interface GatewayEventData {
  type: string;
  sessionId: string | null;
  payload: { text?: string } | null;
}

export function ChatsPage() {
  const toast = useToast();
  const { t } = useI18n();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [listPending, setListPending] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState('');

  const sessionRef = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as tokens arrive.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, streaming]);

  const loadSessions = useCallback(async () => {
    try {
      const { sessions: list } = await getChatSessions();
      setSessions(list);
    } catch {
      // The list is a convenience; a failure here should not block chatting.
    } finally {
      setListPending(false);
    }
  }, []);

  // Only sets state after the await, so it is safe to call from an effect.
  const openNew = useCallback(async () => {
    try {
      const { sessionId: id } = await createChatSession();
      sessionRef.current = id;
      setSessionId(id);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : t('chat.connectFailed'));
    } finally {
      setConnecting(false);
    }
  }, [t]);

  const startNew = useCallback(() => {
    sessionRef.current = null;
    setSessionId(null);
    setConnecting(true);
    setConnectionError(null);
    setMessages([]);
    void openNew();
  }, [openNew]);

  /** Reopen a previous conversation: bring it live, then load its history. */
  const openExisting = useCallback(
    async (id: string) => {
      sessionRef.current = id;
      setSessionId(id);
      setConnecting(true);
      setConnectionError(null);
      setMessages([]);
      try {
        await resumeChatSession(id);
        const { messages: history } = await getChatHistory(id);
        // Guard against a race where the user clicked another session meanwhile.
        if (sessionRef.current === id) setMessages(history);
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : t('chat.openFailed'));
      } finally {
        setConnecting(false);
      }
    },
    [t],
  );

  // One SSE stream for the page; events are filtered by the active session.
  useEffect(() => {
    // These only touch state after an await, so they are not synchronous
    // set-state-in-effect despite how the rule reads them.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openNew();
    void loadSessions();

    const source = new EventSource('/api/chat/events');

    const append = (text: string) =>
      setMessages((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant') {
          next[next.length - 1] = { ...last, text: last.text + text };
        } else {
          next.push({ role: 'assistant', text });
        }
        return next;
      });

    const forSession = (raw: string): GatewayEventData | null => {
      try {
        const data = JSON.parse(raw) as GatewayEventData;
        if (data.sessionId && data.sessionId !== sessionRef.current) return null;
        return data;
      } catch {
        return null;
      }
    };

    const onDelta = (event: MessageEvent) => {
      const data = forSession(event.data);
      if (data?.payload?.text) append(data.payload.text);
    };

    const onComplete = (event: MessageEvent) => {
      const data = forSession(event.data);
      if (!data) return;
      setStreaming(false);
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last && last.role === 'assistant' && last.text === '' && data.payload?.text) {
          const next = [...current];
          next[next.length - 1] = { ...last, text: data.payload.text };
          return next;
        }
        return current;
      });
      void loadSessions();
    };

    source.addEventListener('message.delta', onDelta);
    source.addEventListener('message.complete', onComplete);
    source.addEventListener('message.interim', onDelta);
    source.onerror = () => {
      // EventSource reconnects on its own; the bootstrap reports a hard failure.
    };

    return () => source.close();
  }, [openNew, loadSessions]);

  const send = async () => {
    const text = input.trim();
    if (text === '' || streaming || !sessionRef.current) return;
    setInput('');
    setMessages((current) => [...current, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setStreaming(true);
    try {
      await sendChatPrompt(sessionRef.current, text);
    } catch (error) {
      setStreaming(false);
      setMessages((current) => current.slice(0, -1));
      toast.push({
        tone: 'error',
        title: t('chat.sendFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <PageShell title={t('nav.chats')} description={t('page.chats.desc')} wide>
      <div className="flex h-[calc(100vh-11rem)] gap-4">
        {/* Session list */}
        <aside className="hidden w-64 shrink-0 flex-col sm:flex">
          <button
            type="button"
            onClick={startNew}
            disabled={connecting}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
          >
            <Plus size={14} aria-hidden />
            {t('chat.newConversation')}
          </button>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {listPending ? (
              <SkeletonText lines={6} />
            ) : sessions.length === 0 ? (
              <p className="px-1 text-xs text-[var(--color-ink-faint)]">
                {t('chat.noConversations')}
              </p>
            ) : (
              <ul className="space-y-1">
                {sessions.map((session) => {
                  const active = session.id === sessionId;
                  const label = session.title || session.preview || t('chat.conversation');
                  return (
                    <li key={session.id}>
                      <button
                        type="button"
                        onClick={() => void openExisting(session.id)}
                        className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                          active
                            ? 'bg-[var(--color-accent)]/10 text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]'
                        }`}
                      >
                        <p className="truncate text-xs font-medium">{label}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                          {session.messageCount > 0 && (
                            <span>
                              {session.messageCount} {t('chat.messages')}
                            </span>
                          )}
                          {session.startedAt && (
                            <span>· {formatRelativeTime(session.startedAt)}</span>
                          )}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          {connectionError ? (
            <div className="card p-6">
              <p className="text-sm text-[var(--color-danger)]" role="alert">
                {connectionError}
              </p>
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                {t('chat.overDashboard')}
              </p>
              <button
                type="button"
                onClick={startNew}
                className="mt-3 rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              <div
                ref={threadRef}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-base)] p-4"
              >
                {messages.length === 0 && !connecting ? (
                  <div className="grid h-full place-items-center text-center">
                    <div>
                      <span
                        className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
                        aria-hidden
                      >
                        <MessagesSquare size={22} />
                      </span>
                      <p className="mt-3 text-sm font-medium">{t('chat.emptyTitle')}</p>
                      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                        {t('chat.emptyHint')}
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                          message.role === 'user'
                            ? 'bg-[var(--color-accent)]/15 text-[var(--color-ink)]'
                            : 'bg-[var(--color-raised)] text-[var(--color-ink)]'
                        }`}
                      >
                        {message.text || (
                          <span className="inline-flex gap-1 text-[var(--color-ink-faint)]">
                            <span className="animate-pulse">●</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form
                className="mt-3 flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={connecting ? t('chat.connecting') : t('chat.placeholder')}
                  disabled={connecting || streaming || !sessionId}
                  className="min-h-[2.75rem] flex-1 resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2.5 text-sm outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={connecting || streaming || input.trim() === '' || !sessionId}
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
                >
                  <Send size={15} aria-hidden />
                  {t('chat.send')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </PageShell>
  );
}
