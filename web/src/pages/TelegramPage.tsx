import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ExternalLink, MessagesSquare, Radio, Send, UserRound } from 'lucide-react';
import {
  getMessaging,
  getProfiles,
  getSessionsBySource,
  queryKeys,
  setPlatformEnabled,
  testPlatform,
} from '@/lib/api';
import type { MessagingPlatform, SessionSummary } from '@/lib/hermesTypes';
import { PageShell } from '@/components/PageShell';
import { SkeletonText } from '@/components/Skeleton';
import { ConfirmInline } from '@/components/ConfirmInline';
import { ChipMenu, type ChipMenuOption } from '@/components/ChipMenu';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/format';
import { useResumedChat } from '@/lib/useResumedChat';

/**
 * Everything about the Telegram bot in one place: how it is wired up, and what
 * has been said through it.
 *
 * The page is profile-scoped, and that is not decoration. A profile is a whole
 * separate installation, and on a real machine the bot runs under one profile
 * while the dashboard was launched under another — so the unscoped view can
 * report Telegram as "active" while every actual conversation, and the running
 * gateway, live somewhere else entirely. The chip defaults to the profile whose
 * gateway is up, because that is the one answering messages.
 *
 * There is no message box. Replies to Telegram are the gateway's job, and it
 * owns the delivery path; nothing here can put a message into somebody's
 * Telegram. Opening a conversation in the chat area continues it *in the
 * control center* instead — see `openInChat`.
 */
export function TelegramPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<string | null>(null);
  /** Null until the user picks; then it stays put across refetches. */
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);

  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 60_000,
  });

  // Default to the profile that actually runs a gateway. Only once — after that
  // the chip is the user's to move.
  const [profilePicked, setProfilePicked] = useState(false);
  useEffect(() => {
    if (profilePicked || !profiles.data) return;
    const running = profiles.data.profiles.find((entry) => entry.gatewayRunning);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfilePicked(true);
    if (running && running.name !== profiles.data.current) setProfile(running.name);
  }, [profiles.data, profilePicked]);

  // Scoped to the same profile as the conversation list below. Reading the two
  // from different profiles is what makes the connection look fine while the
  // bot answering the messages is somewhere else.
  const messaging = useQuery({
    queryKey: queryKeys.messagingFor(profile),
    queryFn: () => getMessaging(profile),
    staleTime: 30_000,
  });

  const sessions = useQuery({
    queryKey: queryKeys.sessionsBySource('telegram', profile),
    queryFn: () => getSessionsBySource('telegram', profile),
    staleTime: 30_000,
  });

  const chat = useResumedChat(openId, profile, (error) =>
    toast.push({ tone: 'error', title: t('chat.sendFailed'), description: error.message }),
  );
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // A conversation opens at its newest message, the way every chat does, and
  // keeps the newest in view as tokens arrive. Without this a 391-message
  // history opens at its oldest line and buries the reply box.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [chat.messages, chat.streaming]);

  // Opening a conversation is already the gesture that says "I want to write
  // here", so it should not also cost a click into the field.
  useEffect(() => {
    if (openId) inputRef.current?.focus();
  }, [openId]);

  const telegram = messaging.data?.platforms.find((entry) => entry.id === 'telegram') ?? null;

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setPlatformEnabled('telegram', enabled, profile),
    onSuccess: async (_result, enabled) => {
      setConfirmDisable(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.messagingFor(profile) });
      toast.push({
        tone: 'success',
        title: enabled ? t('telegram.enabled') : t('telegram.disabled'),
      });
    },
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('telegram.actionFailed'), description: error.message }),
  });

  const test = useMutation({
    mutationFn: () => testPlatform('telegram', profile),
    onSuccess: (result) =>
      toast.push({
        tone: result.ok ? 'success' : 'warning',
        title: t('telegram.tested'),
        description: result.message ?? result.state ?? undefined,
      }),
    onError: (error: Error) =>
      toast.push({ tone: 'error', title: t('toast.testFailed'), description: error.message }),
  });

  const profileOptions: ChipMenuOption[] = (profiles.data?.profiles ?? []).map((entry) => ({
    value: entry.name === profiles.data?.current ? '' : entry.name,
    label: entry.name,
    hint: entry.gatewayRunning ? t('telegram.gatewayUp') : null,
  }));

  const conversations = sessions.data?.sessions ?? [];

  /**
   * Continue a Telegram conversation in the chat area.
   *
   * The reply arrives here, not in Telegram: the dashboard's chat gateway has
   * no delivery path to any messaging platform (verified in the Hermes source).
   * The turn does land in the same stored conversation the bot reads, though,
   * so the next Telegram message will see it as history — which is the point of
   * continuing rather than starting fresh.
   */
  const openInChat = (session: SessionSummary) => {
    const params = new URLSearchParams({ session: session.id });
    if (profile) params.set('profile', profile);
    void navigate(`/chats?${params.toString()}`);
  };

  return (
    <PageShell
      title={t('nav.telegram')}
      description={t('page.telegram.desc')}
      actions={
        profileOptions.length > 1 ? (
          <ChipMenu
            icon={<UserRound size={12} />}
            label={profile ?? profiles.data?.current ?? '—'}
            title={t('chat.toolbar.profileTitle')}
            options={profileOptions}
            value={profile ?? ''}
            onChange={(value) => {
              setProfile(value === '' ? null : value);
              setOpenId(null);
            }}
          />
        ) : undefined
      }
      wide
    >
      {messaging.isPending ? (
        <SkeletonText lines={6} />
      ) : messaging.error ? (
        <p className="card p-6 text-sm text-[var(--color-danger)]" role="alert">
          {messaging.error.message}
        </p>
      ) : !telegram ? (
        <p className="card p-8 text-center text-sm text-[var(--color-ink-muted)]">
          {t('telegram.notAvailable')}
        </p>
      ) : (
        <>
          <ConnectionCard
            platform={telegram}
            pending={toggle.isPending || test.isPending}
            confirmDisable={confirmDisable}
            onEnable={() => toggle.mutate(true)}
            onAskDisable={() => setConfirmDisable(true)}
            onConfirmDisable={() => toggle.mutate(false)}
            onCancelDisable={() => setConfirmDisable(false)}
            onTest={() => test.mutate()}
          />

          <section className="mt-4 grid gap-4 lg:h-[calc(100vh-22rem)] lg:min-h-[30rem] lg:grid-cols-[18rem_1fr]">
            <div className="card flex min-h-0 flex-col overflow-y-auto p-3">
              <p className="mb-2 text-xs font-medium">{t('telegram.conversations')}</p>
              {sessions.isPending ? (
                <SkeletonText lines={4} />
              ) : conversations.length === 0 ? (
                <p className="text-xs text-[var(--color-ink-muted)]">{t('telegram.noChats')}</p>
              ) : (
                <ul className="space-y-1">
                  {conversations.map((session) => (
                    <li key={session.id}>
                      <button
                        type="button"
                        onClick={() => setOpenId(session.id)}
                        className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                          session.id === openId
                            ? 'bg-[var(--color-accent)]/10 text-[var(--color-ink)]'
                            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]'
                        }`}
                      >
                        <p className="truncate text-xs font-medium">
                          {session.title ?? session.chatId ?? t('telegram.unknownChat')}
                        </p>
                        {session.conversationTitle && (
                          <p className="mt-0.5 truncate text-[0.7rem] text-[var(--color-ink-muted)]">
                            {session.conversationTitle}
                          </p>
                        )}
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                          {session.chatType && <span>{session.chatType}</span>}
                          {session.messages !== null && (
                            <span>
                              · {t('chat.messages')} {session.messages}
                            </span>
                          )}
                          {session.lastActive && (
                            <span>· {formatRelativeTime(session.lastActive, lang)}</span>
                          )}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Bounded at every width, not just on a wide screen: an unbounded
                transcript grows the page instead of scrolling itself, and
                pushes the reply box below the fold — which is exactly what a
                391-message history did. */}
            <div className="card flex h-[70dvh] flex-col p-4 lg:h-auto lg:min-h-0">
              {openId === null ? (
                <div className="grid flex-1 place-items-center text-center">
                  <div>
                    <span
                      className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-raised)] text-[var(--color-ink-faint)]"
                      aria-hidden
                    >
                      <MessagesSquare size={22} />
                    </span>
                    <p className="mt-3 text-sm font-medium">{t('telegram.pickChat')}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-2 border-b border-[var(--color-hairline)] pb-2.5">
                    <span className="truncate text-sm font-medium">
                      {conversations.find((session) => session.id === openId)?.title ??
                        t('telegram.unknownChat')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const session = conversations.find((entry) => entry.id === openId);
                        if (session) openInChat(session);
                      }}
                      className="ms-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
                    >
                      <Send size={12} aria-hidden />
                      {t('telegram.continueHere')}
                    </button>
                  </div>

                  <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                    {chat.messages.map((message, index) => (
                      <div
                        key={index}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                            message.role === 'user'
                              ? 'bg-[var(--color-accent)]/15'
                              : 'bg-[var(--color-raised)]'
                          }`}
                        >
                          {message.text}
                        </div>
                      </div>
                    ))}
                  </div>

                  <form
                    className="mt-3 border-t border-[var(--color-hairline)] pt-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = draft;
                      setDraft('');
                      void chat.send(text);
                    }}
                  >
                    <div className="flex items-end gap-2">
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            const text = draft;
                            setDraft('');
                            void chat.send(text);
                          }
                        }}
                        ref={inputRef}
                        rows={2}
                        placeholder={t('telegram.replyPlaceholder')}
                        aria-label={t('telegram.replyLabel')}
                        className="min-h-0 flex-1 resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2 text-sm outline-none focus-visible:border-[var(--color-accent)]"
                      />
                      <button
                        type="submit"
                        disabled={chat.streaming || draft.trim() === ''}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2 text-sm text-[var(--color-accent)] disabled:opacity-40"
                      >
                        <Send size={13} aria-hidden />
                        {chat.streaming ? t('common.running') : t('telegram.reply')}
                      </button>
                    </div>
                    {/* The one thing a message box on a Telegram page must not
                        leave unsaid: this does not reach Telegram. */}
                    <p className="mt-2 text-[0.7rem] text-[var(--color-warn)]">
                      {t('telegram.replyStaysHere')}
                    </p>
                  </form>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}

/**
 * The connection, spelled out field by field.
 *
 * A single "active" badge is what the integrations page shows, and on this
 * install it disagrees with reality — so the four things Hermes actually
 * reports are shown separately: whether the platform is switched on, whether
 * its credentials are present, what state it reports, and whether a gateway is
 * running to act on any of it.
 */
function ConnectionCard({
  platform,
  pending,
  confirmDisable,
  onEnable,
  onAskDisable,
  onConfirmDisable,
  onCancelDisable,
  onTest,
}: {
  platform: MessagingPlatform;
  pending: boolean;
  confirmDisable: boolean;
  onEnable: () => void;
  onAskDisable: () => void;
  onConfirmDisable: () => void;
  onCancelDisable: () => void;
  onTest: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Radio size={15} className="text-[var(--color-ink-faint)]" aria-hidden />
        <span className="text-sm font-medium">{t('telegram.connection')}</span>
        <span className="ms-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onTest}
            disabled={pending}
            className="rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
          >
            {t('common.test')}
          </button>
          <button
            type="button"
            onClick={platform.enabled ? onAskDisable : onEnable}
            disabled={pending}
            className="rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-40"
          >
            {platform.enabled ? t('common.disable') : t('common.enable')}
          </button>
          {platform.docsUrl && (
            <a
              href={platform.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-hairline)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              <ExternalLink size={11} aria-hidden />
              {t('integrations.docs')}
            </a>
          )}
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('telegram.switchedOn')} value={platform.enabled} />
        <Field label={t('telegram.credentials')} value={platform.configured} />
        {/* The one that decides whether any of the others matter: switched on
            without a gateway is a bot that answers nothing. */}
        <Field
          label={t('telegram.gateway')}
          value={platform.gatewayRunning}
          trueLabel={t('telegram.gatewayYes')}
          falseLabel={t('telegram.gatewayNo')}
        />
        <Field label={t('telegram.reportedState')} text={platform.state ?? '—'} />
        <Field label={t('telegram.homeChannel')} text={platform.homeChannel ?? '—'} />
      </dl>

      {platform.enabled && !platform.gatewayRunning && (
        <p className="mt-2 text-xs text-[var(--color-warn)]">{t('telegram.onWithoutGateway')}</p>
      )}

      {platform.errorMessage && (
        <p className="mt-2 text-xs text-[var(--color-danger)]">{platform.errorMessage}</p>
      )}

      {confirmDisable && (
        <ConfirmInline
          tone="warn"
          message={t('telegram.disableConfirm')}
          confirmLabel={t('common.disable')}
          pending={pending}
          onConfirm={onConfirmDisable}
          onCancel={onCancelDisable}
        />
      )}

      {platform.envVars.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium">{t('telegram.settings')}</p>
          <ul className="mt-1.5 space-y-1.5">
            {platform.envVars.map((variable) => (
              <li key={variable.key} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <span className="font-mono">{variable.key}</span>
                {variable.required && (
                  <span className="text-[0.65rem] text-[var(--color-ink-faint)]">
                    {t('telegram.required')}
                  </span>
                )}
                <span
                  className="text-[0.7rem]"
                  style={{
                    color: variable.isSet ? 'var(--color-ok)' : 'var(--color-ink-faint)',
                  }}
                >
                  {variable.isSet ? t('telegram.isSet') : t('telegram.notSet')}
                </span>
                {variable.description && (
                  <span className="w-full text-[0.7rem] text-[var(--color-ink-muted)]">
                    {variable.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* Values live in the profile's .env and are edited there; this page
              reports whether they are present, never what they are. */}
          <p className="mt-2 text-[0.7rem] text-[var(--color-ink-faint)]">
            {t('telegram.envNote')}
          </p>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  text,
  trueLabel,
  falseLabel,
}: {
  label: string;
  value?: boolean;
  text?: string;
  /** Wording for a boolean that is not about being switched on. */
  trueLabel?: string;
  falseLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <div>
      <dt className="text-[0.7rem] text-[var(--color-ink-faint)]">{label}</dt>
      <dd
        className="mt-0.5 text-sm"
        style={
          value === undefined
            ? undefined
            : { color: value ? 'var(--color-ok)' : 'var(--color-ink-faint)' }
        }
      >
        {value === undefined
          ? text
          : value
            ? (trueLabel ?? t('common.enabled'))
            : (falseLabel ?? t('common.disabled'))}
      </dd>
    </div>
  );
}
