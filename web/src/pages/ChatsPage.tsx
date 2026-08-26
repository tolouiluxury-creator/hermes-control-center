import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'react-router';
import {
  CheckSquare,
  CircleStop,
  ListPlus,
  MessagesSquare,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import {
  ApiError,
  attachChatFile,
  createChatSession,
  deleteChatSessions,
  getBots,
  getChatHistory,
  getChatSessions,
  interruptChatSession,
  queryKeys,
  resumeChatSession,
  sendBotDM,
  sendChatPrompt,
  setSessionPinned,
  switchChatModel,
  type BotDetails,
  type ChatMessage,
  type ChatSessionSummary,
} from '@/lib/api';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ChatMarkdown } from '@/components/ChatMarkdown';
import { ChatToolbar, type ModelPick } from '@/components/ChatToolbar';
import { ChatSidebar, type ChatSidebarHandle } from '@/components/ChatSidebar';
import { ConfirmInline } from '@/components/ConfirmInline';
import { type TodosPanelHandle } from '@/components/TodosPanel';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatRelativeTime, formatTime } from '@/lib/format';
import { groupByRecency } from '@/lib/chatGroups';
import { buildOutgoingText } from '@/lib/chatOutgoing';
import { isImageFileName, parseAttachmentRefs } from '@/lib/chatAttachmentRefs';
import { TypingDots } from '@/components/TypingDots';
import {
  AttachmentChip,
  SentAttachment,
  type PendingAttachment,
} from '@/components/AttachmentChip';

interface GatewayEventData {
  type: string;
  sessionId: string | null;
  payload: { text?: string } | null;
}

const MAX_ATTACHMENT_MB = 10;

/** ChatsPage lets BotChatsPage hand it a bot context: a fixed profile, a
 * canonical session and a rosters of bots for the @mention picker. */
export interface ChatsPageProps {
  /** Page header when embedded (BotChatsPage); defaults to the nav label. */
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  /** Lock the chat to one profile (bot chats are scoped to the bot's own). */
  profileOverride?: string;
  profileSelectable?: boolean;
  /** The bot this transcript belongs to; enables the DM fan-out on @mention. */
  botId?: string;
  initialSessionId?: string | null;
  /** Bot↔Bot DM replies the parent page wants surfaced in this transcript. */
  injectedMessages?: { sender: string; text: string }[];
  /** Roster for the @mention picker; defaults to all bots. */
  botRoster?: { bots: BotDetails[]; selectedId: string; onSelect: (id: string) => void };
}

export function ChatsPage({
  title,
  description,
  actions,
  profileOverride,
  profileSelectable = true,
  botId,
  initialSessionId,
  injectedMessages,
  botRoster,
}: ChatsPageProps) {
  const toast = useToast();
  const { t, lang } = useI18n();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [listSearch, setListSearch] = useState('');
  const [listPending, setListPending] = useState(true);
  /**
   * The row this conversation is: what the list highlights, what the transcript
   * and a delete are asked for. See {@link ChatSessionIds} — the gateway wants a
   * different id, held in `liveRef`.
   */
  const [sessionId, setSessionId] = useState<string | null>(() => initialSessionId ?? null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nearBottom, setNearBottom] = useState(true);
  // Mirrors nearBottom for the auto-follow effect below, so a bare
  // nearBottom change (manual scroll, jump-button click) doesn't retrigger it.
  const nearBottomRef = useRef(nearBottom);
  useEffect(() => {
    nearBottomRef.current = nearBottom;
  }, [nearBottom]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  /**
   * Image data URLs for attachments sent this session, keyed by their ref
   * line — the only source for a thumbnail, since the bytes never touch the
   * server's chat history. Reopened conversations show the plain file chip.
   */
  const [attachmentPreviews, setAttachmentPreviews] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  /** Selection mode for the conversation list: pick several, then delete them. */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** A single row awaiting its own delete confirmation, outside selection mode. */
  const [confirmOne, setConfirmOne] = useState<string | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  /**
   * Toolbar state. The model is an override for the *next* conversation; the
   * profile scopes the whole surface, because each profile keeps its own
   * conversation database.
   */
  const [modelPick, setModelPick] = useState<ModelPick | null>(null);
  /** Working directory for the next conversation; null means the workspace root. */
  const [cwd, setCwd] = useState<string | null>(null);
  /**
   * `?profile=` and `?session=` let another page hand a conversation over —
   * the Telegram area continues a bot conversation here. Read once at mount so
   * a later profile switch is not fought by the URL.
   */
  const [searchParams] = useSearchParams();
  // A bot chat locks the profile; the URL query only applies when free-standing.
  const [profile, setProfile] = useState<string | null>(() =>
    profileOverride ?? searchParams.get('profile'),
  );
  /**
   * The model a conversation started here was created with.
   *
   * Hermes writes the stored row on the first prompt, so for a few seconds
   * after sending there is nothing to read back. Remembering the pick keeps the
   * chip from saying "unknown" about a model the user just chose; the stored
   * value takes over as soon as it exists.
   */
  const [startedWithModel, setStartedWithModel] = useState<string | null>(null);
  const [switchingModel, setSwitchingModel] = useState(false);
  /** Hermes asked before switching to an expensive model; its wording is shown verbatim. */
  const [confirmModel, setConfirmModel] = useState<{
    pick: ModelPick;
    message: string | null;
  } | null>(null);

  const sessionRef = useRef<string | null>(null);
  /**
   * The gateway's handle for the attached session: prompts, streamed events and
   * model switches all speak this, and reopening a conversation mints a new one.
   * Held in a ref because the event listener is installed once and must always
   * compare against the conversation that is on screen now.
   */
  const liveRef = useRef<string | null>(null);
  const [liveId, setLiveId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const todosPanelRef = useRef<TodosPanelHandle>(null);
  const chatSidebarRef = useRef<ChatSidebarHandle>(null);

  // Only follow new content when the user was already at the bottom — reading
  // older history should not get yanked to the newest message.
  useEffect(() => {
    if (nearBottomRef.current) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, streaming]);

  const handleThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  // A conversation that just became ready should be typeable without a click —
  // opening one is already the gesture that says "I want to write here".
  useEffect(() => {
    if (!connecting) inputRef.current?.focus();
  }, [connecting, sessionId]);

  const loadSessions = useCallback(async (): Promise<ChatSessionSummary[]> => {
    try {
      const { sessions: list } = await getChatSessions(profile);
      setSessions(list);
      return list;
    } catch {
      // The list is a convenience; a failure here should not block chatting.
      return [];
    } finally {
      setListPending(false);
    }
  }, [profile]);

  // The event stream is opened once, but it has to reach the *current* loader —
  // a profile switch changes which conversations a reload should show.
  const loadSessionsRef = useRef(loadSessions);
  useEffect(() => {
    loadSessionsRef.current = loadSessions;
  }, [loadSessions]);

  /**
   * Clear the thread and wait.
   *
   * Deliberately does not talk to the agent: opening this page used to create a
   * session every single time, so a handful of visits left a trail of empty
   * conversations behind. The session is now created on the first message
   * instead — see `send` — which means looking at the chat costs nothing.
   */
  const startNew = useCallback(() => {
    sessionRef.current = null;
    liveRef.current = null;
    setSessionId(null);
    setLiveId(null);
    setConnectionError(null);
    setMessages([]);
    setStartedWithModel(null);
    setNearBottom(true);
    // Leaving mid-stream orphans the old completion event: forSession() correctly
    // drops it (its sessionId no longer matches liveRef), but nothing else would
    // ever clear this flag, permanently disabling the send button on every
    // conversation opened afterwards.
    setStreaming(false);
    // A pending "confirm expensive model" prompt belongs to the conversation
    // that's being left; confirming it here would apply to the new one instead.
    setConfirmModel(null);
    inputRef.current?.focus();
  }, []);

  /** Reopen a previous conversation: bring it live, then load its history. */
  const openExisting = useCallback(
    async (id: string) => {
      // Already open. Re-resuming would mint a fresh live id and orphan an
      // in-flight generation: its events keep arriving tagged with the old
      // one, forSession() correctly stops matching them against the new
      // liveRef, and the conversation looks frozen forever — including its
      // eventual message.complete, so the send button never comes back
      // either. A stuck/errored open already has its own retry path
      // (startNew, next to the error message), so this is safe to skip.
      if (sessionRef.current === id) return;
      sessionRef.current = id;
      liveRef.current = null;
      setSessionId(id);
      setLiveId(null);
      setConnecting(true);
      setConnectionError(null);
      setMessages([]);
      setStartedWithModel(null);
      setNearBottom(true);
      // Same reasoning as startNew(): switching away from a still-streaming
      // conversation must not leave the send button disabled forever.
      setStreaming(false);
      setConfirmModel(null);
      try {
        // Reopening attaches a fresh live session to the same row. Keeping its
        // id is what makes sending — and the streamed answer — work at all.
        const { liveId: attached } = await resumeChatSession(id, profile);
        const { messages: history } = await getChatHistory(id, profile);
        // Guard against a race where the user clicked another session meanwhile.
        if (sessionRef.current === id) {
          liveRef.current = attached;
          setLiveId(attached);
          setMessages(history);
        }
      } catch (error) {
        setConnectionError(error instanceof Error ? error.message : t('chat.openFailed'));
      } finally {
        setConnecting(false);
      }
    },
    [profile, t],
  );

  /**
   * Switching profile switches conversation databases, so the open thread must
   * go with it: its id means nothing in the other profile's store, and leaving
   * it on screen would show a conversation the list no longer contains.
   */
  const switchProfile = (next: string | null) => {
    if (next === profile) return;
    setProfile(next);
    setListPending(true);
    setSessions([]);
    leaveSelection();
    startNew();
  };
  // A bot chat pins the profile — the picker has no business switching it.
  const effectiveProfile = profileOverride ?? profile;
  const profileLocked = profileOverride !== undefined;

  const openSession = sessions.find((session) => session.id === sessionId) ?? null;

  /**
   * Repoint the open conversation at another model.
   *
   * Sent with `--session` server-side, so it changes this conversation and
   * never the agent's configured default. Hermes may answer that the model is
   * expensive and wants confirming — that comes back as a state, not an error,
   * and is put in front of the user before anything switches.
   */
  const applyLiveModel = async (pick: ModelPick, confirm = false) => {
    const live = liveRef.current;
    if (!live) return;
    setSwitchingModel(true);
    try {
      const result = await switchChatModel(live, pick.model, pick.provider, confirm);
      if (result.confirmRequired) {
        setConfirmModel({ pick, message: result.confirmMessage });
        return;
      }
      setConfirmModel(null);
      // The stored row is what the chip reads, so show the new model at once
      // rather than waiting for the next list refresh.
      setStartedWithModel(result.model);
      setSessions((current) =>
        current.map((session) =>
          session.id === sessionRef.current ? { ...session, model: result.model } : session,
        ),
      );
      toast.push({
        tone: result.warning ? 'warning' : 'success',
        title: t('chat.toolbar.switched', { model: result.model }),
        description: result.warning ?? undefined,
      });
    } catch (error) {
      setConfirmModel(null);
      toast.push({
        tone: 'error',
        title: t('chat.toolbar.switchFailed'),
        description:
          error instanceof ApiError && error.code === 'session_not_live'
            ? t('chat.toolbar.notLive')
            : error instanceof Error
              ? error.message
              : undefined,
      });
    } finally {
      setSwitchingModel(false);
    }
  };

  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Pin or unpin one conversation.
   *
   * Hermes calls this a durable keep flag: a pinned conversation is also exempt
   * from its auto-archive sweep, so this is more than ordering.
   */
  const togglePin = async (session: ChatSessionSummary) => {
    setPinning(session.id);
    try {
      await setSessionPinned(session.id, !session.pinned, profile);
      await loadSessions();
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('chat.pinFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setPinning(null);
    }
  };

  /** Delete exactly one, without entering selection mode first. */
  const removeOne = async (id: string) => {
    setDeleting(true);
    try {
      const result = await deleteChatSessions([id], profile);
      const hitActive = sessionRef.current === id;
      setConfirmOne(null);
      await loadSessions();
      if (hitActive) startNew();
      toast.push({ tone: 'success', title: t('chat.deleted', { count: result.deleted ?? 1 }) });
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('toast.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const leaveSelection = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmDelete(false);
  };

  const removeSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);
    try {
      const result = await deleteChatSessions(ids, profile);
      // Deleting the conversation on screen would leave a thread pointing at
      // something that no longer exists, so start a fresh one instead.
      const hitActive = sessionRef.current !== null && ids.includes(sessionRef.current);
      leaveSelection();
      await loadSessions();
      if (hitActive) startNew();
      toast.push({
        tone: 'success',
        title: t('chat.deleted', { count: result.deleted ?? ids.length }),
      });
    } catch (error) {
      toast.push({
        tone: 'error',
        title: t('toast.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  /**
   * A conversation handed over from another page (`?session=`), opened once.
   *
   * Guarded by a ref rather than by the dependency list: `openExisting` is
   * rebuilt whenever the profile changes, and without the guard a later profile
   * switch would drag the handed-over conversation back onto the screen.
   */
  const handoverDone = useRef(false);
  useEffect(() => {
    const handover = searchParams.get('session');
    if (handoverDone.current || !handover) return;
    handoverDone.current = true;
    void openExisting(handover);
  }, [searchParams, openExisting]);

  // Only the list is fetched here. Nothing is created until the first message,
  // so arriving on this page leaves no trace on the agent. It re-runs on a
  // profile switch, because that is a different conversation database.
  useEffect(() => {
    // State is only touched after the await, so this is not the synchronous
    // set-state-in-effect the rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void (async () => {
      const list = await loadSessions();
      // No handover landed and nothing is open yet: land on the most recent
      // conversation instead of an empty "start a conversation" canvas, so a
      // bot's chat area is never a dead end. `sessionId` (state, not the ref)
      // tells us whether a conversation actually became active.
      if (list.length > 0 && sessionId === null) {
        void openExisting(list[0]!.id);
      }
    })();
  }, [loadSessions, openExisting, sessionId]);

  // One SSE stream for the page; events are filtered by the active session.
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

    const forSession = (raw: string): GatewayEventData | null => {
      try {
        const data = JSON.parse(raw) as GatewayEventData;
        // Events carry the live id, never the stored one — comparing against the
        // row id would drop every token of a reopened conversation.
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
      void loadSessionsRef.current();
    };

    source.addEventListener('message.delta', onDelta);
    source.addEventListener('message.complete', onComplete);
    source.addEventListener('message.interim', onDelta);
    source.onerror = () => {
      // EventSource reconnects on its own; the bootstrap reports a hard failure.
    };

    return () => source.close();
  }, []);

  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const oversized = list.filter((file) => file.size > MAX_ATTACHMENT_MB * 1024 * 1024);
    for (const file of oversized) {
      toast.push({
        tone: 'error',
        title: t('chat.attachTooLarge', { name: file.name, maxMb: MAX_ATTACHMENT_MB }),
      });
    }
    const valid = list.filter((file) => !oversized.includes(file));
    const staged: PendingAttachment[] = valid.map((file) => ({ file, dataUrl: null }));
    setAttachments((current) => [...current, ...staged]);
    for (const item of staged) {
      try {
        const dataUrl = await readAsDataUrl(item.file);
        setAttachments((current) =>
          current.map((entry) => (entry.file === item.file ? { ...entry, dataUrl } : entry)),
        );
      } catch {
        setAttachments((current) => current.filter((entry) => entry.file !== item.file));
        toast.push({ tone: 'error', title: t('chat.attachReadFailed', { name: item.file.name }) });
      }
    }
  };

  const send = async () => {
    const text = input.trim();
    const pending = attachments.filter((entry) => entry.dataUrl !== null);
    if ((text === '' && pending.length === 0) || streaming) return;
    // Enter-to-send bypasses the submit button's disabled state entirely, so
    // the still-reading guard has to live here too, not just on the button.
    if (attachments.some((a) => a.dataUrl === null)) return;
    setInput('');
    // Sending must not cost the caret. Clicking the button moves focus there,
    // so it is handed back explicitly rather than left where the click put it.
    inputRef.current?.focus();
    setStreaming(true);
    let pushed = false;
    try {
      // The conversation starts here, not when the page opened — that is what
      // keeps unused sessions from piling up on the agent.
      let live = liveRef.current;
      if (!live) {
        // The toolbar's picks only ever reach Hermes here. Both are per-session
        // overrides on session.create, so starting a chat with another model
        // leaves the agent's configured default untouched.
        const ids = await createChatSession({
          model: modelPick?.model,
          provider: modelPick?.provider,
          profile,
          cwd: cwd ?? undefined,
        });
        if (!ids.liveId) throw new Error(t('chat.sendFailed'));
        live = ids.liveId;
        liveRef.current = live;
        setLiveId(live);
        sessionRef.current = ids.storedId ?? null;
        setSessionId(ids.storedId ?? null);
        setStartedWithModel(modelPick?.model ?? null);
      }
      const refs: string[] = [];
      for (const item of pending) {
        // dataUrl is non-null here (filtered above), narrowed for TypeScript.
        const { refText } = await attachChatFile(live, item.dataUrl as string, item.file.name);
        refs.push(refText);
      }
      const outgoing = buildOutgoingText(refs, text);
      setAttachments((current) => current.filter((entry) => !pending.includes(entry)));
      setAttachmentPreviews((current) => {
        const next = { ...current };
        pending.forEach((item, i) => {
          const ref = refs[i];
          if (ref && item.dataUrl && isImageFileName(item.file.name)) next[ref] = item.dataUrl;
        });
        return next;
      });
      // Echoed only now, with the attachment refs folded in — echoing the raw
      // typed text earlier meant an image sent without a caption showed an
      // empty bubble (falsy text fell through to the assistant's TypingDots).
      setMessages((current) => [
        ...current,
        { role: 'user', text: outgoing },
        { role: 'assistant', text: '' },
      ]);
      pushed = true;
      await sendChatPrompt(live, outgoing);
      // Bot-to-bot fan-out for any @Name in the message (runs parallel; its
      // replies surface as assistant bubbles via dmReplies). Never blocks the
      // chat's own turn.
      const outgoingText = outgoing;
      if (botId && outgoingText) void fanOutMentions(outgoingText);
    } catch (error) {
      setStreaming(false);
      if (pushed) setMessages((current) => current.slice(0, -1));
      toast.push({
        tone: 'error',
        title: t('chat.sendFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  /**
   * Stop a running turn.
   *
   * Unsticks the UI immediately and unconditionally — the interrupt call is
   * best-effort. Even if it fails or the reply never arrives, the turn is
   * already off screen, and forSession() will drop any of its late events
   * against whatever liveRef points to next.
   */
  const cancelStreaming = () => {
    const live = liveRef.current;
    setStreaming(false);
    setMessages((current) => {
      const last = current[current.length - 1];
      return last && last.role === 'assistant' && last.text === '' ? current.slice(0, -1) : current;
    });
    if (live) {
      void interruptChatSession(live).catch(() => {
        // Nothing left to reconcile here — see the comment above.
      });
    }
  };

  // Bot↔Bot DM replies the parent page wants surfaced in this transcript.
  useEffect(() => {
    if (!injectedMessages?.length) return;
    setMessages((current) => [
      ...current,
      ...injectedMessages.map((m) => ({
        role: 'assistant' as const,
        text: `[DM von ${m.sender}]: ${m.text}`,
      })),
    ]);
  }, [injectedMessages]);

  // ─── @mention picker: `@Name` in the composer targets another bot ──────────
  const mentionRoster = useQuery({
    queryKey: queryKeys.bots(true),
    queryFn: () => getBots(true),
    staleTime: 15_000,
    enabled: botRoster === undefined,
  });
  const rosterBots = (botRoster?.bots ?? mentionRoster.data?.bots ?? [])
    .filter((entry) => entry.bot.id !== botId)
    .map((entry) => entry.bot);
  const [mentionPicker, setMentionPicker] = useState<{
    query: string;
    matches: { id: string; name: string }[];
    caret: number;
  } | null>(null);
  const mentionRef = useRef<HTMLDivElement | null>(null);
  const [dmReplies, setDmReplies] = useState<{ sender: string; text: string }[]>([]);
  const [dmSending, setDmSending] = useState(false);

  // Own @mention fan-out replies surface the same way.
  useEffect(() => {
    if (!dmReplies.length) return;
    setMessages((current) => [
      ...current,
      ...dmReplies.map((m) => ({
        role: 'assistant' as const,
        text: `[DM von ${m.sender}]: ${m.text}`,
      })),
    ]);
  }, [dmReplies]);

  const updateMentionPicker = (value: string, caret: number) => {
    // Find the "@" start of the token the caret sits in (word boundary).
    const before = value.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at >= 0 && !/[\w@]/.test(before[at - 1] ?? '') && !before.slice(at + 1).includes(' ')) {
      const query = before.slice(at + 1).toLowerCase();
      const matches = rosterBots
        .filter((b) => b.name.toLowerCase().includes(query))
        .slice(0, 6)
        .map((b) => ({ id: b.id, name: b.name }));
      if (matches.length > 0) {
        setMentionPicker({ query, matches, caret: at });
        return;
      }
    }
    setMentionPicker(null);
  };
  const applyMention = (name: string) => {
    if (!mentionPicker) return;
    const value = input;
    // `caret` is the position of the "@" itself (set in updateMentionPicker).
    // Keep everything before it, replace the "@…" token with "@Name ", and
    // drop any partial query typed after the "@".
    const at = mentionPicker.caret;
    const rest = value.slice(at + 1).replace(/^\S*/, '');
    const next = `${value.slice(0, at)}@${name} ${rest.replace(/^\s+/, '')}`;
    setInput(next);
    setMentionPicker(null);
    inputRef.current?.focus();
  };
  const extractMentions = (text: string): string[] => {
    const names = new Set<string>();
    for (const match of text.matchAll(/@([A-Za-z0-9_.-]+)/g)) {
      const candidate = match[1] ?? '';
      const found = rosterBots.find((b) => b.name.toLowerCase() === candidate.toLowerCase());
      if (found) names.add(found.name);
    }
    return [...names];
  };
  // The picker closes on an outside click; the composer's tab/enter keys use
  // the chosen mention instead of their usual meaning while it is open.
  useEffect(() => {
    if (!mentionPicker) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!mentionRef.current?.contains(event.target as Node)) setMentionPicker(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMentionPicker(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mentionPicker]);

  // Commit-on-send: any @Name in the outgoing text becomes a DM fan-out that
  // runs in parallel to the normal prompt; its replies land in the transcript.
  const fanOutMentions = async (text: string) => {
    const names = extractMentions(text);
    if (names.length === 0 || !botId) return;
    const targets = rosterBots.filter((b) => names.includes(b.name)).map((b) => b.id);
    if (targets.length === 0 || dmSending) return;
    setDmSending(true);
    try {
      const res = await sendBotDM(botId, targets, text);
      const replies = res.results.filter((r) => r.ok && r.reply).map((r) => ({
        sender: r.botName ?? '?',
        text: r.reply ?? '',
      }));
      setDmReplies((current) => [...current, ...replies]);
    } catch {
      // A failed fan-out must not break the chat itself — the toast from the
      // page-level catch covers it, and the prompt still went through.
    } finally {
      setDmSending(false);
    }
  };

  const sendToTodos = (text: string) => {
    // The panel only mounts its ToDos tab content once open. flushSync forces
    // React to commit that state change before this function continues, so
    // the ref below is guaranteed to exist — no rAF-timing guesswork needed.
    flushSync(() => {
      chatSidebarRef.current?.openTodosTab();
    });
    todosPanelRef.current?.prefillAndFocus(text);
  };

  const visibleSessions =
    listSearch.trim() === ''
      ? sessions
      : sessions.filter((session) => {
          const haystack = `${session.title ?? ''} ${session.preview ?? ''}`.toLowerCase();
          return haystack.includes(listSearch.trim().toLowerCase());
        });
  const groups = groupByRecency(visibleSessions);
  const selectedHasTelegram = sessions.some(
    (session) => selected.has(session.id) && session.source === 'telegram',
  );

  const allSelected =
    visibleSessions.length > 0 && visibleSessions.every((session) => selected.has(session.id));
  const toggleAll = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const session of visibleSessions) {
        if (allSelected) {
          next.delete(session.id);
        } else {
          next.add(session.id);
        }
      }
      return next;
    });

  return (
    <PageShell
      title={title ?? t('nav.chats')}
      description={description ?? t('page.chats.desc')}
      actions={actions}
      wide
    >
      <div className="flex h-[calc(100vh-11rem)] gap-4">
        {/* Session list */}
        <aside className="hidden w-64 shrink-0 flex-col sm:flex">
          <button
            type="button"
            onClick={startNew}
            disabled={connecting}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
          >
            <Plus size={14} aria-hidden />
            {t('chat.newConversation')}
          </button>

          {sessions.length > 0 && (
            <div className="relative mt-2">
              <Search
                size={12}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--color-ink-faint)]"
                aria-hidden
              />
              <input
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder={t('chat.searchConversations')}
                aria-label={t('chat.searchConversations')}
                className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] py-1.5 pr-2 pl-7 text-xs outline-none focus-visible:border-[var(--color-accent)]"
              />
            </div>
          )}

          {sessions.length > 0 && (
            <div className="mt-2 flex items-center gap-2 text-[0.7rem]">
              {selecting ? (
                <>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                  >
                    {allSelected ? t('chat.selectNone') : t('chat.selectAll')}
                  </button>
                  <span className="text-[var(--color-ink-faint)]">
                    {t('chat.selectedCount', { count: selected.size })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={selected.size === 0 || deleting}
                    className="ml-auto inline-flex items-center gap-1 text-[var(--color-danger)] transition-opacity hover:opacity-80 disabled:opacity-40"
                  >
                    <Trash2 size={12} aria-hidden />
                    {t('common.delete')}
                  </button>
                  <button
                    type="button"
                    onClick={leaveSelection}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                  >
                    {t('common.cancel')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setSelecting(true)}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                  >
                    {t('chat.select')}
                  </button>
                </>
              )}
            </div>
          )}

          {confirmDelete && (
            <ConfirmInline
              tone="danger"
              message={
                <>
                  {t('chat.deleteConfirm', { count: selected.size })}
                  {selectedHasTelegram && (
                    <>
                      {' '}
                      <strong className="text-[var(--color-warn)]">
                        {t('chat.deleteTelegramNote')}
                      </strong>
                    </>
                  )}
                </>
              }
              confirmLabel={t('common.delete')}
              pending={deleting}
              onConfirm={() => void removeSelected()}
              onCancel={() => setConfirmDelete(false)}
            />
          )}

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {listPending ? (
              <SkeletonText lines={6} />
            ) : sessions.length === 0 ? (
              <p className="px-1 text-xs text-[var(--color-ink-faint)]">
                {t('chat.noConversations')}
              </p>
            ) : (
              <div className="space-y-3">
                {groups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 px-1 text-[0.65rem] font-medium tracking-wide text-[var(--color-ink-faint)] uppercase">
                      {t(group.label)}
                    </p>
                    <ul className="space-y-1">
                      {group.sessions.map((session, index) => {
                        const active = session.id === sessionId;
                        const label = session.title || session.preview || t('chat.conversation');
                        const picked = selected.has(session.id);
                        // Divider between the auto-pinned Telegram conversations and
                        // whatever the user pinned by hand, both inside the same
                        // "Pinned" group — see chatGroups.ts pinnedTelegramCount.
                        const showDividerBefore =
                          !!group.pinnedTelegramCount &&
                          index === group.pinnedTelegramCount &&
                          index < group.sessions.length;
                        return (
                          <Fragment key={session.id}>
                            {showDividerBefore && (
                              <li
                                aria-hidden
                                className="my-1.5 border-t border-[var(--color-hairline)]"
                              />
                            )}
                            <li>
                              {/* `group` so the row's own hover reveals its buttons. */}
                              <div className="group flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    selecting
                                      ? toggleSelected(session.id)
                                      : void openExisting(session.id)
                                  }
                                  aria-pressed={selecting ? picked : undefined}
                                  // `min-w-0 flex-1`, not `w-full`: a flex item defaults
                                  // to min-width:auto and so refuses to shrink below its
                                  // content. With a long preview the button claimed the
                                  // whole row and pushed the pin and trash out of sight.
                                  className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                    active && !selecting
                                      ? 'border-s-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 ps-2 text-[var(--color-ink)]'
                                      : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]'
                                  }`}
                                >
                                  {selecting &&
                                    (picked ? (
                                      <CheckSquare
                                        size={13}
                                        className="mt-0.5 shrink-0 text-[var(--color-accent)]"
                                        aria-hidden
                                      />
                                    ) : (
                                      <Square
                                        size={13}
                                        className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]"
                                        aria-hidden
                                      />
                                    ))}
                                  <span className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-medium">{label}</p>
                                    <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                                      {session.source === 'telegram' && (
                                        <span className="inline-flex items-center gap-1 font-medium text-[var(--color-ok)]">
                                          <Send size={9} aria-hidden />
                                          {t('chat.telegramBadge')}
                                        </span>
                                      )}
                                      {session.messageCount > 0 && (
                                        <span>
                                          {session.source === 'telegram' && '· '}
                                          {session.messageCount} {t('chat.messages')}
                                        </span>
                                      )}
                                      {session.startedAt && (
                                        <span>· {formatRelativeTime(session.startedAt, lang)}</span>
                                      )}
                                    </p>
                                  </span>
                                </button>

                                {/* Pin and delete stay reachable without entering
                                  selection mode, which is what the list needed most.
                                  Side by side and vertically centred: stacked, they
                                  stretched every row and read as status rather than
                                  as buttons. They stay faint until the row is hovered
                                  so the list itself keeps the eye. */}
                                {!selecting && (
                                  <span className="flex shrink-0 items-center gap-0.5 self-center">
                                    {session.source === 'telegram' ? (
                                      // Telegram conversations are pinned by source, not by
                                      // the `pinned` flag — nothing to toggle, so the button
                                      // is a disabled, always-visible "why it's pinned" marker.
                                      <span
                                        title={t('chat.telegramAlwaysPinned')}
                                        aria-label={t('chat.telegramAlwaysPinned')}
                                        className="cursor-default rounded-md p-1 text-[var(--color-accent)]"
                                      >
                                        <Pin size={12} aria-hidden fill="currentColor" />
                                      </span>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => void togglePin(session)}
                                        disabled={pinning === session.id}
                                        title={session.pinned ? t('chat.unpin') : t('chat.pin')}
                                        aria-label={
                                          session.pinned ? t('chat.unpin') : t('chat.pin')
                                        }
                                        aria-pressed={session.pinned}
                                        className={`rounded-md p-1 transition-colors disabled:opacity-40 ${
                                          session.pinned
                                            ? // A pinned row keeps its marker visible; the
                                              // filled pin says "pinned", the tooltip says undo.
                                              'text-[var(--color-accent)]'
                                            : 'text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-ink)]'
                                        }`}
                                      >
                                        <Pin
                                          size={12}
                                          aria-hidden
                                          fill={session.pinned ? 'currentColor' : 'none'}
                                        />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setConfirmOne(session.id)}
                                      title={t('common.delete')}
                                      aria-label={`${t('common.delete')} ${label}`}
                                      className="rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-colors group-hover:opacity-100 hover:text-[var(--color-danger)] focus-visible:opacity-100"
                                    >
                                      <Trash2 size={12} aria-hidden />
                                    </button>
                                  </span>
                                )}
                              </div>

                              {confirmOne === session.id && (
                                <ConfirmInline
                                  tone="danger"
                                  message={
                                    <>
                                      {t('chat.deleteOneConfirm', { name: label })}
                                      {session.source === 'telegram' && (
                                        <>
                                          {' '}
                                          <strong className="text-[var(--color-warn)]">
                                            {t('chat.deleteTelegramNote')}
                                          </strong>
                                        </>
                                      )}
                                    </>
                                  }
                                  confirmLabel={t('common.delete')}
                                  pending={deleting}
                                  onConfirm={() => void removeOne(session.id)}
                                  onCancel={() => setConfirmOne(null)}
                                />
                              )}
                            </li>
                          </Fragment>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {groups.length === 0 && listSearch.trim() !== '' && (
                  <p className="px-1 text-xs text-[var(--color-ink-faint)]">
                    {t('chat.noSearchResults')}
                  </p>
                )}
              </div>
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
              {/* Chat header: what you are in, and what it runs on. */}
              <div className="mb-3 flex items-center gap-2.5 border-b border-[var(--color-hairline)] pb-2.5">
                <img
                  src="/logo.png"
                  alt=""
                  width={22}
                  height={22}
                  className="size-[1.375rem] shrink-0"
                  aria-hidden
                />
                <span className="truncate text-sm font-medium">
                  {openSession?.title || t('chat.newConversation')}
                </span>
                {openSession?.source === 'telegram' && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-ok)]/15 px-2 py-0.5 text-[0.65rem] font-medium text-[var(--color-ok)]">
                    <Send size={10} aria-hidden />
                    {t('chat.telegramBadge')}
                  </span>
                )}
                {streaming && (
                  <span
                    className="shrink-0 animate-pulse text-xs text-[var(--color-ink-faint)]"
                    role="status"
                  >
                    {t('chat.thinking')}
                  </span>
                )}
                <ChatToolbar
                  modelPick={modelPick}
                  onModelPick={setModelPick}
                  profile={effectiveProfile}
                  onProfile={switchProfile}
                  profileSelectable={profileSelectable && !profileLocked}
                  openConversationModel={startedWithModel ?? openSession?.model ?? null}
                  conversationOpen={liveId !== null}
                  onLiveModelPick={(pick) => void applyLiveModel(pick)}
                  streaming={streaming}
                  switching={switchingModel}
                  tokens={openSession?.tokens ?? null}
                  cwd={cwd}
                  onCwd={setCwd}
                />
              </div>

              {confirmModel && (
                <ConfirmInline
                  tone="warn"
                  message={
                    confirmModel.message ??
                    t('chat.toolbar.switchConfirm', { model: confirmModel.pick.model })
                  }
                  confirmLabel={t('chat.toolbar.switchAnyway')}
                  pending={switchingModel}
                  onConfirm={() => void applyLiveModel(confirmModel.pick, true)}
                  onCancel={() => setConfirmModel(null)}
                />
              )}

              <div
                ref={threadRef}
                onScroll={handleThreadScroll}
                className="relative min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-base)] p-4"
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
                  messages.map((message, index) => {
                    const isUser = message.role === 'user';
                    const time = formatTime(message.timestamp);
                    const { refs: attachmentRefs, body } = parseAttachmentRefs(message.text);
                    return (
                      <div
                        key={index}
                        // Entrance only for freshly rendered bubbles; the global
                        // reduced-motion block collapses the animation to a
                        // single frame, so this costs nothing there.
                        className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                        style={{ animation: 'message-in var(--duration-slow) var(--ease-ui) both' }}
                      >
                        <div className="flex max-w-[80%] items-end gap-1.5">
                          {!isUser && message.text && (
                            <button
                              type="button"
                              onClick={() => sendToTodos(message.text)}
                              title={t('chat.addToTodos')}
                              aria-label={t('chat.addToTodos')}
                              className="hidden mb-1 shrink-0 rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-accent)] lg:inline-flex"
                            >
                              <ListPlus size={12} aria-hidden />
                            </button>
                          )}
                          <div
                            className={`rounded-2xl px-3.5 py-2 text-sm ${
                              isUser
                                ? 'bubble-user rounded-br-md whitespace-pre-wrap text-[var(--color-ink)]'
                                : 'bubble-agent rounded-bl-md text-[var(--color-ink)]'
                            }`}
                          >
                            {attachmentRefs.length > 0 && (
                              <div className="mb-1.5 flex flex-wrap gap-1.5">
                                {attachmentRefs.map((ref) => (
                                  <SentAttachment
                                    key={ref.raw}
                                    name={ref.name}
                                    previewUrl={attachmentPreviews[ref.raw]}
                                  />
                                ))}
                              </div>
                            )}
                            {body || attachmentRefs.length > 0 ? (
                              isUser ? (
                                body
                              ) : (
                                <ChatMarkdown text={body} />
                              )
                            ) : (
                              <TypingDots />
                            )}
                          </div>
                          {isUser && message.text && (
                            <button
                              type="button"
                              onClick={() => sendToTodos(message.text)}
                              title={t('chat.addToTodos')}
                              aria-label={t('chat.addToTodos')}
                              className="hidden mb-1 shrink-0 rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-accent)] lg:inline-flex"
                            >
                              <ListPlus size={12} aria-hidden />
                            </button>
                          )}
                        </div>
                        {time && (
                          <span className="mt-1 px-1 text-[0.65rem] text-[var(--color-ink-faint)]">
                            {time}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
                {!nearBottom && messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      threadRef.current?.scrollTo({
                        top: threadRef.current.scrollHeight,
                        behavior: 'smooth',
                      });
                      setNearBottom(true);
                    }}
                    className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] hover:text-[var(--color-ink)]"
                  >
                    ↓ {t('chat.newMessageJump')}
                  </button>
                )}
              </div>

              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attachments.map((attachment, index) => (
                    <AttachmentChip
                      key={`${attachment.file.name}-${index}`}
                      attachment={attachment}
                      onRemove={() =>
                        setAttachments((current) => current.filter((_, i) => i !== index))
                      }
                    />
                  ))}
                </div>
              )}

              <form
                className="relative mt-3 flex items-end gap-2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files && event.target.files.length > 0) {
                      void addFiles(event.target.files);
                    }
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={connecting}
                  title={t('chat.attachFile')}
                  aria-label={t('chat.attachFile')}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-hairline)] px-3 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  <Paperclip size={15} aria-hidden />
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => {
                    const value = event.target.value;
                    setInput(value);
                    updateMentionPicker(value, event.target.selectionStart ?? value.length);
                  }}
                  onKeyDown={(event) => {
                    // While the picker is open, Tab and Enter choose the active
                    // mention; Escape already closes it via the window listener.
                    if (mentionPicker && event.key === 'Tab') {
                      event.preventDefault();
                      const [first] = mentionPicker.matches;
                      if (first) applyMention(first.name);
                    } else if (mentionPicker && event.key === 'Enter' && !event.shiftKey) {
                      const [first] = mentionPicker.matches;
                      if (first) {
                        event.preventDefault();
                        applyMention(first.name);
                        return;
                      }
                    }
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={connecting ? t('chat.connecting') : t('chat.placeholder')}
                  // Deliberately still writable while the answer streams: a disabled
                  // field drops the caret, and the next thought should not have to
                  // wait for the agent. Only sending waits — see the button.
                  disabled={connecting}
                  className="min-h-[2.75rem] flex-1 resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2.5 text-sm shadow-[var(--shadow-card)] transition-colors outline-none placeholder:text-[var(--color-ink-faint)] hover:border-[var(--color-hairline-strong)] focus-visible:border-[var(--color-accent)] disabled:opacity-60"
                />
                {mentionPicker && mentionPicker.matches.length > 0 && (
                  <div
                    ref={mentionRef}
                    role="listbox"
                    aria-label={t('chat.mentionLabel')}
                    className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-[var(--color-raised)] shadow-[var(--shadow-card)]"
                  >
                    {mentionPicker.matches.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => applyMention(m.name)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-ink)] transition-colors hover:bg-[var(--color-accent)]/10"
                      >
                        <span className="text-sm leading-none" aria-hidden>
                          {rosterBots.find((b) => b.id === m.id)?.avatarKey ?? '🤖'}
                        </span>
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
                {streaming ? (
                  // Some turns run several tool calls and model requests back
                  // to back and can legitimately take minutes — this is the
                  // way out rather than waiting it out (or, previously, the
                  // only recourse being a server restart).
                  <button
                    type="button"
                    onClick={cancelStreaming}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/20"
                  >
                    <CircleStop size={15} aria-hidden />
                    {t('common.cancel')}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      connecting ||
                      (input.trim() === '' && attachments.every((a) => a.dataUrl === null)) ||
                      attachments.some((a) => a.dataUrl === null)
                    }
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 hover:border-[var(--color-accent)]/60 disabled:opacity-40"
                  >
                    <Send size={15} aria-hidden />
                    {t('chat.send')}
                  </button>
                )}
              </form>
            </>
          )}
        </div>

        <ChatSidebar ref={chatSidebarRef} sessionId={sessionId} todosPanelRef={todosPanelRef} />
      </div>
    </PageShell>
  );
}
