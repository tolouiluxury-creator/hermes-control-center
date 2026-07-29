import { useCallback, useEffect, useRef, useState } from 'react';
import { UserRound } from 'lucide-react';
import { createChatSession, getProfiles, queryKeys, sendChatPrompt } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { PageShell } from '@/components/PageShell';
import { ChipMenu, type ChipMenuOption } from '@/components/ChipMenu';
import { useI18n } from '@/lib/i18n';

/**
 * The agent in a terminal skin.
 *
 * Deliberately NOT a shell. Hermes does expose a real PTY at `/api/pty`, and it
 * stays unused on purpose: putting a root shell behind a browser page is a
 * different product with a different threat model. What this is instead is the
 * same conversation the chat page has, rendered as a scrolling log with a
 * prompt — for people who would rather type than click.
 *
 * Because that distinction is invisible from the look alone, the page says it
 * out loud in the header. Somebody who types `rm -rf` here is talking to an
 * agent, not to bash, and has a right to know that before they press enter.
 */

/** One rendered line. `local` is this page talking, never the agent. */
interface Line {
  kind: 'in' | 'out' | 'local' | 'error';
  text: string;
}

interface GatewayEventData {
  type: string;
  sessionId: string | null;
  payload: { text?: string } | null;
}

export function TerminalPage() {
  const { t } = useI18n();
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  /** Recalled with the up and down arrows, newest last, like a shell. */
  const [past, setPast] = useState<string[]>([]);
  const [recall, setRecall] = useState<number | null>(null);

  const liveRef = useRef<string | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 60_000,
  });

  useEffect(() => {
    viewRef.current?.scrollTo({ top: viewRef.current.scrollHeight });
  }, [lines]);

  const append = useCallback((line: Line) => setLines((current) => [...current, line]), []);

  /** Streamed tokens extend the last agent line instead of starting a new one. */
  const extend = useCallback(
    (text: string) =>
      setLines((current) => {
        const next = [...current];
        const last = next[next.length - 1];
        if (last?.kind === 'out') next[next.length - 1] = { ...last, text: last.text + text };
        else next.push({ kind: 'out', text });
        return next;
      }),
    [],
  );

  // One event stream for the page, filtered to the live session — the same
  // contract the chat page uses, including that events carry the live id.
  useEffect(() => {
    const source = new EventSource('/api/chat/events');

    const forSession = (raw: string): GatewayEventData | null => {
      try {
        const data = JSON.parse(raw) as GatewayEventData;
        if (data.sessionId && data.sessionId !== liveRef.current) return null;
        return data;
      } catch {
        return null;
      }
    };

    const onDelta = (event: MessageEvent) => {
      const data = forSession(event.data);
      if (data?.payload?.text) extend(data.payload.text);
    };

    const onComplete = (event: MessageEvent) => {
      if (!forSession(event.data)) return;
      setBusy(false);
    };

    source.addEventListener('message.delta', onDelta);
    source.addEventListener('message.interim', onDelta);
    source.addEventListener('message.complete', onComplete);

    return () => source.close();
  }, [extend]);

  const reset = useCallback(() => {
    liveRef.current = null;
    setLines([]);
    setBusy(false);
    inputRef.current?.focus();
  }, []);

  const run = async () => {
    const text = input.trim();
    if (text === '' || busy) return;
    setInput('');
    setRecall(null);
    setPast((current) => [...current, text]);
    inputRef.current?.focus();

    // Two commands belong to this page, not to the agent. Everything else is a
    // message — there is nothing here that executes anything on the server.
    if (text === '/clear') {
      setLines([]);
      return;
    }
    if (text === '/new') {
      reset();
      append({ kind: 'local', text: t('terminal.newSession') });
      return;
    }

    append({ kind: 'in', text });
    setBusy(true);
    try {
      let live = liveRef.current;
      if (!live) {
        const ids = await createChatSession({ profile });
        if (!ids.liveId) throw new Error(t('chat.sendFailed'));
        live = ids.liveId;
        liveRef.current = live;
      }
      await sendChatPrompt(live, text);
    } catch (error) {
      setBusy(false);
      append({
        kind: 'error',
        text: error instanceof Error ? error.message : t('chat.sendFailed'),
      });
    }
  };

  /** Up and down walk the history, as a terminal does. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void run();
      return;
    }
    if (event.key === 'ArrowUp' && past.length > 0) {
      event.preventDefault();
      const next = recall === null ? past.length - 1 : Math.max(0, recall - 1);
      setRecall(next);
      setInput(past[next] ?? '');
      return;
    }
    if (event.key === 'ArrowDown' && recall !== null) {
      event.preventDefault();
      const next = recall + 1;
      if (next >= past.length) {
        setRecall(null);
        setInput('');
      } else {
        setRecall(next);
        setInput(past[next] ?? '');
      }
    }
  };

  const launchProfile = profiles.data?.current ?? null;
  const profileOptions: ChipMenuOption[] = (profiles.data?.profiles ?? []).map((entry) => ({
    value: entry.name === launchProfile ? '' : entry.name,
    label: entry.name,
    hint: entry.gatewayRunning ? t('telegram.gatewayUp') : null,
  }));

  return (
    <PageShell
      title={t('nav.terminal')}
      description={t('page.terminal.desc')}
      actions={
        profileOptions.length > 1 ? (
          <ChipMenu
            icon={<UserRound size={12} />}
            label={profile ?? launchProfile ?? '—'}
            title={t('chat.toolbar.profileTitle')}
            options={profileOptions}
            value={profile ?? ''}
            onChange={(value) => {
              setProfile(value === '' ? null : value);
              // A new profile is a different agent home; the session id here
              // would mean nothing to it.
              reset();
            }}
          />
        ) : undefined
      }
      wide
    >
      <div className="rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-base)] p-4 font-mono text-xs">
        <div
          ref={viewRef}
          className="h-[calc(100vh-19rem)] overflow-y-auto"
          role="log"
          aria-live="polite"
        >
          {lines.length === 0 && (
            <p className="text-[var(--color-ink-faint)]">{t('terminal.hint')}</p>
          )}
          {lines.map((line, index) => (
            <p
              key={index}
              className="whitespace-pre-wrap"
              style={{
                color:
                  line.kind === 'in'
                    ? 'var(--color-accent)'
                    : line.kind === 'error'
                      ? 'var(--color-danger)'
                      : line.kind === 'local'
                        ? 'var(--color-ink-faint)'
                        : 'var(--color-ink)',
              }}
            >
              {line.kind === 'in' ? `> ${line.text}` : line.text}
            </p>
          ))}
          {busy && <p className="animate-pulse text-[var(--color-ink-faint)]">…</p>}
        </div>

        <form
          className="mt-2 flex items-start gap-2 border-t border-[var(--color-hairline)] pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <span className="mt-1.5 shrink-0 text-[var(--color-accent)]" aria-hidden>
            &gt;
          </span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('terminal.inputLabel')}
            placeholder={t('terminal.placeholder')}
            // Writable while the agent answers, same as the chat: a disabled
            // field drops the caret and the next thought should not have to wait.
            className="min-h-[1.75rem] flex-1 resize-y bg-transparent font-mono text-xs outline-none"
          />
        </form>
      </div>

      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t('terminal.notShell')}</p>
    </PageShell>
  );
}
