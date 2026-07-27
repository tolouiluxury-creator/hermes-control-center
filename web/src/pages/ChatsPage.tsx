import { useCallback, useEffect, useRef, useState } from 'react';
import { MessagesSquare, Plus, Send } from 'lucide-react';
import { createChatSession, sendChatPrompt, type ChatMessage } from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { useToast } from '@/components/Toast';

interface GatewayEventData {
  type: string;
  sessionId: string | null;
  payload: { text?: string } | null;
}

export function ChatsPage() {
  const toast = useToast();
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

  // Only sets state after the await, so it is safe to call from an effect.
  const openSession = useCallback(async () => {
    try {
      const { sessionId: id } = await createChatSession();
      sessionRef.current = id;
      setSessionId(id);
      setConnectionError(null);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Verbindung fehlgeschlagen');
    } finally {
      setConnecting(false);
    }
  }, []);

  const startNew = useCallback(() => {
    sessionRef.current = null;
    setSessionId(null);
    setConnecting(true);
    setConnectionError(null);
    setMessages([]);
    void openSession();
  }, [openSession]);

  // One SSE stream for the page; events are filtered by the active session.
  useEffect(() => {
    // openSession only touches state after an await, so this is not a
    // synchronous set-state-in-effect despite how the rule reads it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openSession();

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
      // If nothing streamed (some models only emit a final message), take it now.
      setMessages((current) => {
        const last = current[current.length - 1];
        if (last && last.role === 'assistant' && last.text === '' && data.payload?.text) {
          const next = [...current];
          next[next.length - 1] = { ...last, text: data.payload.text };
          return next;
        }
        return current;
      });
    };

    source.addEventListener('message.delta', onDelta);
    source.addEventListener('message.complete', onComplete);
    source.addEventListener('message.interim', onDelta);
    source.onerror = () => {
      // The browser reconnects EventSource on its own; surface nothing unless it
      // never opened, which the session bootstrap already reports.
    };

    return () => source.close();
  }, [openSession]);

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
      setMessages((current) => current.slice(0, -1)); // drop the empty assistant bubble
      toast.push({
        tone: 'error',
        title: 'Senden fehlgeschlagen',
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <PageShell
      title="Chats"
      description="Unterhalte dich direkt mit deinem Agenten — über das laufende Dashboard, ohne zusätzliche Server."
      actions={
        <button
          type="button"
          onClick={startNew}
          disabled={connecting}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
        >
          <Plus size={14} aria-hidden />
          Neue Unterhaltung
        </button>
      }
    >
      {connectionError ? (
        <div className="card p-6">
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {connectionError}
          </p>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Der Chat läuft über das Hermes-Dashboard. Prüfe, dass das Dashboard erreichbar ist.
          </p>
          <button
            type="button"
            onClick={startNew}
            className="mt-3 rounded-lg border border-[var(--color-hairline)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            Erneut versuchen
          </button>
        </div>
      ) : (
        <div className="flex h-[calc(100vh-12rem)] flex-col">
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
                  <p className="mt-3 text-sm font-medium">Neue Unterhaltung</p>
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    Schreib unten eine Nachricht, um loszulegen.
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
              placeholder={connecting ? 'Verbinde …' : 'Nachricht an den Agenten … (Enter sendet)'}
              disabled={connecting || streaming || !sessionId}
              className="min-h-[2.75rem] flex-1 resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2.5 text-sm outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={connecting || streaming || input.trim() === '' || !sessionId}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
            >
              <Send size={15} aria-hidden />
              Senden
            </button>
          </form>
        </div>
      )}
    </PageShell>
  );
}
