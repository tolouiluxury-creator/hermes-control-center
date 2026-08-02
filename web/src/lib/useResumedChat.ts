import { useCallback, useEffect, useRef, useState } from 'react';
import { getChatHistory, resumeChatSession, sendChatPrompt, type ChatMessage } from '@/lib/api';

/**
 * Carry on an existing conversation, wherever it was started.
 *
 * Written as a hook rather than copied into a second page: the id handling here
 * is the part that goes wrong silently. A stored conversation has two ids — the
 * row id it is listed under, and the ephemeral live id `session.resume` hands
 * back — and every gateway event carries the live one. Comparing an event
 * against the row id drops every token of a reopened conversation without an
 * error anywhere.
 *
 * `ChatsPage` still has its own copy of this logic. It also creates new
 * conversations, picks models and workspaces, and is fully user-tested; folding
 * it in belongs in its own change rather than riding along with this one.
 */
export interface ResumedChat {
  messages: ChatMessage[];
  streaming: boolean;
  /** Null until the first send resumes the conversation on the agent. */
  liveId: string | null;
  send: (text: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useResumedChat(
  sessionId: string | null,
  profile: string | null,
  onError: (error: Error) => void,
): ResumedChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const liveRef = useRef<string | null>(null);
  // Held in a ref so a caller that passes a fresh closure every render does not
  // tear down the event stream underneath an answer that is still arriving.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const reload = useCallback(async () => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    try {
      const history = await getChatHistory(sessionId, profile);
      setMessages(history.messages);
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error : new Error(String(error)));
    }
  }, [sessionId, profile]);

  // A different conversation is a different agent: drop the live id with it, or
  // the next send would land in the previous one.
  useEffect(() => {
    liveRef.current = null;
    /* eslint-disable react-hooks/set-state-in-effect --
       Switching conversation has to clear the live id and any half-finished
       stream; both belong to the agent we are leaving behind. */
    setLiveId(null);
    setStreaming(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    void reload();
  }, [reload]);

  useEffect(() => {
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

    const forSession = (raw: string): { payload?: { text?: string } } | null => {
      try {
        const data = JSON.parse(raw) as { sessionId?: string; payload?: { text?: string } };
        if (data.sessionId && data.sessionId !== liveRef.current) return null;
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
    };

    source.addEventListener('message.delta', onDelta);
    source.addEventListener('message.complete', onComplete);
    source.addEventListener('message.interim', onDelta);
    source.onerror = () => {
      // EventSource reconnects on its own.
    };
    return () => source.close();
  }, []);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const body = text.trim();
      if (body === '' || streaming || !sessionId) return;
      setMessages((current) => [
        ...current,
        { role: 'user', text: body },
        { role: 'assistant', text: '' },
      ]);
      setStreaming(true);
      try {
        let live = liveRef.current;
        if (!live) {
          // Resuming is what builds an agent on this conversation, and it only
          // happens when something is actually sent — opening the transcript
          // costs the agent nothing.
          const ids = await resumeChatSession(sessionId, profile);
          if (!ids.liveId) throw new Error('session not found');
          live = ids.liveId;
          liveRef.current = live;
          setLiveId(live);
        }
        await sendChatPrompt(live, body);
      } catch (error) {
        setStreaming(false);
        setMessages((current) => current.slice(0, -1));
        onErrorRef.current(error instanceof Error ? error : new Error(String(error)));
      }
    },
    [sessionId, profile, streaming],
  );

  return { messages, streaming, liveId, send, reload };
}
