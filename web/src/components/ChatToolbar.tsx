import { useQuery } from '@tanstack/react-query';
import { Cpu, UserRound } from 'lucide-react';
import { getModelOptions, getProfiles, queryKeys } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { ChipMenu, type ChipMenuOption } from './ChipMenu';

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
  /**
   * The model an already-open conversation runs on. Hermes fixes this at
   * creation — no call re-points a live conversation at another model — so while
   * one is open the chip reports instead of offering.
   */
  openConversationModel?: string | null;
  conversationOpen: boolean;
}

export function ChatToolbar({
  modelPick,
  onModelPick,
  profile,
  onProfile,
  openConversationModel,
  conversationOpen,
}: ChatToolbarProps) {
  const { t } = useI18n();

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

  const inheritedModel = models.data?.currentModel ?? null;

  /**
   * A pick is a provider *and* a model — the same model name can appear under
   * two providers — so the menu is keyed by position rather than by name. That
   * also spares the value string an escaping scheme it would otherwise need.
   */
  const picks: (ModelPick | null)[] = [
    null,
    ...(models.data?.providers ?? []).flatMap((provider) =>
      provider.models.map((model) => ({ provider: provider.slug, model })),
    ),
  ];

  const modelOptions: ChipMenuOption[] = [
    {
      value: '0',
      label: t('chat.toolbar.inherit'),
      hint: inheritedModel ?? t('chat.toolbar.inheritHint'),
    },
    ...(models.data?.providers ?? []).flatMap((provider) =>
      provider.models.map((model) => ({
        value: String(picks.findIndex((p) => p?.provider === provider.slug && p.model === model)),
        label: model,
        hint: provider.name,
        // An unauthenticated provider is listed so the choice is visible, but
        // picking it would only buy a failed turn.
        disabled: provider.authenticated === false,
      })),
    ),
  ];

  const selectedIndex = modelPick
    ? picks.findIndex((p) => p?.provider === modelPick.provider && p.model === modelPick.model)
    : 0;

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

  return (
    <div className="ms-auto flex shrink-0 items-center gap-1.5">
      <ChipMenu
        icon={<Cpu size={12} />}
        label={modelLabel}
        title={t('chat.toolbar.modelTitle')}
        options={modelOptions}
        value={String(selectedIndex < 0 ? 0 : selectedIndex)}
        onChange={(value) => onModelPick(picks[Number(value)] ?? null)}
        disabled={conversationOpen || modelOptions.length <= 1}
        disabledHint={
          conversationOpen ? t('chat.toolbar.modelLocked') : t('chat.toolbar.modelUnavailable')
        }
      />
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
    </div>
  );
}
