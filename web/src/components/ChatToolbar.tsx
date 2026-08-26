import { useQuery } from '@tanstack/react-query';
import { Cpu, FolderClosed, Gauge, UserRound } from 'lucide-react';
import { getModelOptions, getProfiles, listWorkspace, queryKeys } from '@/lib/api';
import { formatCompact } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { ChipMenu, type ChipMenuOption } from './ChipMenu';

export interface TokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}

export interface ModelPick {
  provider: string;
  model: string;
}

interface ChatToolbarProps {
  /** The pick for the next conversation, or null to inherit the profile default. */
  modelPick: ModelPick | null;
  onModelPick: (pick: ModelPick | null) => void;
  /** Null means the profile the running dashboard was launched with. */
  profile: string | null;
  onProfile: (profile: string | null) => void;
  /** Hide the profile switcher (bot chats are pinned to the bot's profile). */
  profileSelectable?: boolean;
  /** The model the open conversation runs on, read back from its stored row. */
  openConversationModel?: string | null;
  conversationOpen: boolean;
  /**
   * Repoint the open conversation. Separate from {@link onModelPick} because it
   * reaches the agent immediately, where the other only prepares the next chat.
   */
  onLiveModelPick: (pick: ModelPick) => void;
  /** Hermes refuses to swap a model mid-turn, so the chip waits for the answer. */
  streaming: boolean;
  switching: boolean;
  /**
   * Where the agent starts working. `session.create` takes it once and keeps it,
   * and `config.set` has no key for it — so unlike the model this cannot be
   * changed mid-conversation, only chosen for the next one.
   */
  cwd: string | null;
  onCwd: (cwd: string | null) => void;
  /** Read back from the open conversation's stored row; null before it has one. */
  tokens?: TokenUsage | null;
}

export function ChatToolbar({
  modelPick,
  onModelPick,
  profile,
  onProfile,
  profileSelectable = true,
  openConversationModel,
  conversationOpen,
  onLiveModelPick,
  streaming,
  switching,
  cwd,
  onCwd,
  tokens,
}: ChatToolbarProps) {
  const { t, lang } = useI18n();

  const models = useQuery({
    queryKey: queryKeys.models,
    queryFn: getModelOptions,
    staleTime: 60_000,
  });
  const profiles = useQuery({
    queryKey: queryKeys.profiles,
    queryFn: getProfiles,
    staleTime: 60_000,
  });

  /*
   * Only the workspace root's own folders are offered — one level, not a tree.
   * The server refuses anything outside the root anyway, and a chip menu is the
   * wrong place to go hunting through a filesystem.
   */
  const workspace = useQuery({
    queryKey: queryKeys.workspaceList(''),
    queryFn: () => listWorkspace(undefined),
    staleTime: 60_000,
    retry: false,
  });

  const inheritedModel = models.data?.currentModel ?? null;

  /**
   * A pick is a provider *and* a model — the same model name can appear under
   * two providers — so the menu is keyed by position rather than by name. That
   * also spares the value string an escaping scheme it would otherwise need.
   *
   * Index 0 is "inherit the profile default", which only makes sense before a
   * conversation exists; an open one is always on some concrete model.
   */
  const picks: (ModelPick | null)[] = [
    null,
    ...(models.data?.providers ?? []).flatMap((provider) =>
      provider.models.map((model) => ({ provider: provider.slug, model })),
    ),
  ];

  const concreteOptions: ChipMenuOption[] = (models.data?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      value: String(picks.findIndex((p) => p?.provider === provider.slug && p.model === model)),
      label: model,
      hint: provider.name,
      // An unauthenticated provider is listed so the choice is visible, but
      // picking it would only buy a failed turn.
      disabled: provider.authenticated === false,
    })),
  );

  const modelOptions: ChipMenuOption[] = conversationOpen
    ? concreteOptions
    : [
        {
          value: '0',
          label: t('chat.toolbar.inherit'),
          hint: inheritedModel ?? t('chat.toolbar.inheritHint'),
        },
        ...concreteOptions,
      ];

  // With a conversation open the chip reflects what that conversation runs on,
  // not a staged pick — so the checkmark has to be found by model name.
  const selectedValue = conversationOpen
    ? (concreteOptions.find((option) => option.label === openConversationModel)?.value ?? '')
    : String(
        modelPick
          ? picks.findIndex(
              (p) => p?.provider === modelPick.provider && p.model === modelPick.model,
            )
          : 0,
      );

  // The launch profile is where a conversation lands when no profile is sent, so
  // it is offered as the unscoped choice rather than under its name.
  const launchProfile = profiles.data?.current ?? null;
  const profileOptions: ChipMenuOption[] = (profiles.data?.profiles ?? []).map((entry) => ({
    value: entry.name === launchProfile ? '' : entry.name,
    label: entry.name,
    hint:
      entry.name === launchProfile
        ? t('chat.toolbar.profileRunning')
        : entry.name === profiles.data?.active
          ? t('chat.toolbar.profileSticky')
          : (entry.model ?? null),
  }));

  const modelLabel = conversationOpen
    ? (openConversationModel ?? t('chat.toolbar.modelUnknown'))
    : (modelPick?.model ?? inheritedModel ?? t('chat.toolbar.inherit'));

  const modelBusy = conversationOpen && (streaming || switching);

  const cwdOptions: ChipMenuOption[] = [
    { value: '', label: t('chat.toolbar.cwdRoot'), hint: workspace.data?.path ?? '' },
    ...(workspace.data?.entries ?? [])
      .filter((entry) => entry.isDirectory)
      .map((entry) => ({ value: entry.path, label: entry.name })),
  ];

  const cwdLabel =
    cwd === null
      ? t('chat.toolbar.cwdRoot')
      : // The folder name alone; the full path is the menu's hint.
        (cwd.split('/').pop() ?? cwd);

  // Null means the stored row hasn't been found yet (a brand-new conversation,
  // still outside the model-lookup window) — nothing to show, not zero usage.
  const totalTokens =
    tokens && (tokens.inputTokens !== null || tokens.outputTokens !== null)
      ? (tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0)
      : null;

  return (
    <div className="ms-auto flex shrink-0 items-center gap-1.5">
      <ChipMenu
        icon={<Cpu size={12} />}
        label={modelLabel}
        title={conversationOpen ? t('chat.toolbar.modelLive') : t('chat.toolbar.modelTitle')}
        options={modelOptions}
        value={selectedValue}
        onChange={(value) => {
          const pick = picks[Number(value)] ?? null;
          if (!conversationOpen) onModelPick(pick);
          else if (pick) onLiveModelPick(pick);
        }}
        disabled={modelBusy || modelOptions.length === 0}
        disabledHint={
          streaming
            ? t('chat.toolbar.modelBusy')
            : switching
              ? t('chat.toolbar.modelSwitching')
              : t('chat.toolbar.modelUnavailable')
        }
      />
      {/*
       * Read-only: there is nothing to pick, only to report. Reuses ChipMenu's
       * chrome (icon + pill + hover tooltip) rather than a one-off element, so
       * it reads as part of the same toolbar instead of a bolted-on stat.
       * Hidden until the open conversation's stored row has usage to show.
       */}
      {conversationOpen && totalTokens !== null && (
        <ChipMenu
          icon={<Gauge size={12} />}
          label={formatCompact(totalTokens, lang)}
          title={t('chat.toolbar.tokensTitle')}
          options={[]}
          value=""
          onChange={() => {}}
          disabled
          disabledHint={t('chat.toolbar.tokensBreakdown', {
            input: formatCompact(tokens?.inputTokens ?? 0, lang),
            output: formatCompact(tokens?.outputTokens ?? 0, lang),
            cached: formatCompact(tokens?.cacheReadTokens ?? 0, lang),
          })}
        />
      )}
      {/*
       * Hidden when no workspace root is configured: the area is closed then, and
       * an empty chip would only raise a question the page cannot answer here.
       */}
      {workspace.data && (
        <ChipMenu
          icon={<FolderClosed size={12} />}
          label={cwdLabel}
          title={conversationOpen ? t('chat.toolbar.cwdLive') : t('chat.toolbar.cwdTitle')}
          options={cwdOptions}
          value={cwd ?? ''}
          onChange={(value) => onCwd(value === '' ? null : value)}
          disabled={conversationOpen}
          disabledHint={t('chat.toolbar.cwdFixed')}
        />
      )}
      {profileSelectable !== false && (
        <ChipMenu
          icon={<UserRound size={12} />}
          label={profile ?? launchProfile ?? t('chat.toolbar.profileTitle')}
          title={t('chat.toolbar.profileTitle')}
          options={profileOptions}
          value={profile ?? ''}
          onChange={(value) => onProfile(value === '' ? null : value)}
          disabled={profileOptions.length <= 1}
          disabledHint={t('chat.toolbar.profileSingle')}
        />
      )}
    </div>
  );
}
