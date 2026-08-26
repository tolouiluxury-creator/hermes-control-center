import type { ActionResult, DashboardClient } from './dashboard.js';
import type { MessagingOverview, ProfileOverview } from './inventory.js';
import type { BotPatch, BotRecord, BotRoutineInput, BotsRepo, BotState } from '../store/bots.js';
import { profileNameFromBotName } from './profileName.js';

export interface BotCreateInput {
  profileName?: string;
  name: string;
  description?: string;
  avatarKey?: string | null;
  accent?: string | null;
  cloneFrom?: string;
  cloneAll?: boolean;
  noSkills?: boolean;
  model?: string;
  provider?: string;
}

export interface BotUpdateInput extends BotPatch {
  model?: string;
  provider?: string;
}

export interface BotDetails {
  bot: BotRecord;
  profile: ProfileOverview['profiles'][number] | null;
  messaging: MessagingOverview | null;
  routines: ReturnType<BotsRepo['routines']>;
}

export interface BotOperationResult {
  bot: BotRecord;
  warnings: string[];
}

export interface BotServiceDependencies {
  bots: BotsRepo;
  dashboard: Pick<
    DashboardClient,
    | 'profiles'
    | 'messagingPlatforms'
    | 'createProfile'
    | 'deleteProfile'
    | 'setProfileModel'
    | 'setProfileDescription'
    | 'setPlatformEnabled'
  >;
  launchProfile?: string | null;
  /** Optional run-history hook (Runs page). Injected by context. */
  recordActivity?: (
    label: string,
    output: string,
    options?: { status?: 'completed' | 'failed'; workflowId?: string },
  ) => unknown;
}

function successful(result: ActionResult): void {
  if (result.ok === false) throw new Error('Hermes rejected the Bot operation.');
}

export class BotService {
  constructor(private readonly dependencies: BotServiceDependencies) {}

  recordActivity(
    label: string,
    output: string,
    options?: { status?: 'completed' | 'failed'; workflowId?: string },
  ): unknown {
    return this.dependencies.recordActivity?.(label, output, options);
  }

  async list(includeHidden = false): Promise<BotDetails[]> {
    const profileOverview = await this.dependencies.dashboard.profiles();
    const profiles = new Map(profileOverview.profiles.map((profile) => [profile.name, profile]));
    return Promise.all(
      this.dependencies.bots
        .list({ includeHidden })
        .map((bot) => this.details(bot, profiles.get(bot.profileName) ?? null)),
    );
  }

  async get(id: string): Promise<BotDetails | null> {
    const bot = this.dependencies.bots.get(id);
    if (!bot) return null;
    const profileOverview = await this.dependencies.dashboard.profiles();
    return this.details(
      bot,
      profileOverview.profiles.find((profile) => profile.name === bot.profileName) ?? null,
    );
  }

  async create(input: BotCreateInput, now = Date.now()): Promise<BotRecord> {
    const profileName = input.profileName?.trim() || profileNameFromBotName(input.name);
    if (this.dependencies.bots.getByProfile(profileName)) {
      throw new Error(`A Bot already uses profile "${profileName}".`);
    }
    const model = input.model?.trim() || '';
    const provider = input.provider?.trim() || '';
    if ((model && !provider) || (!model && provider)) {
      throw new Error('Model and provider must be selected together.');
    }
    const profileResult = await this.dependencies.dashboard.createProfile({
      name: profileName,
      cloneFrom: input.cloneFrom,
      cloneAll: input.cloneAll,
      noSkills: input.noSkills,
      description: input.description,
    });
    successful(profileResult);
    try {
      if (model && provider) {
        successful(await this.dependencies.dashboard.setProfileModel(profileName, provider, model));
      }
      return this.dependencies.bots.create({ ...input, profileName }, now);
    } catch (error) {
      // Do not leave an orphan profile behind when our own metadata write fails.
      await this.dependencies.dashboard.deleteProfile(profileName).catch(() => undefined);
      throw error;
    }
  }

  async update(id: string, patch: BotUpdateInput): Promise<BotRecord | null> {
    const current = this.dependencies.bots.get(id);
    if (!current) return null;
    const model = patch.model?.trim() || '';
    const provider = patch.provider?.trim() || '';
    if ((model && !provider) || (!model && provider)) {
      throw new Error('Model and provider must be selected together.');
    }
    if (model && provider) {
      successful(
        await this.dependencies.dashboard.setProfileModel(current.profileName, provider, model),
      );
    }
    if (patch.description !== undefined) {
      successful(
        await this.dependencies.dashboard.setProfileDescription(
          current.profileName,
          patch.description,
        ),
      );
    }
    return this.dependencies.bots.update(id, patch);
  }

  async delete(id: string): Promise<BotRecord | null> {
    const current = this.dependencies.bots.get(id);
    if (!current) return null;
    if (
      this.dependencies.launchProfile &&
      current.profileName === this.dependencies.launchProfile
    ) {
      throw new Error('The launch profile cannot be permanently deleted from Bot Center.');
    }
    successful(await this.dependencies.dashboard.deleteProfile(current.profileName));
    this.dependencies.bots.delete(id);
    return current;
  }

  async setHidden(id: string, hidden: boolean): Promise<BotRecord | null> {
    return this.dependencies.bots.setHidden(id, hidden);
  }

  setCanonicalChatSession(id: string, sessionId: string): BotRecord | null {
    return this.dependencies.bots.setCanonicalChatSession(id, sessionId);
  }

  async setState(id: string, state: BotState): Promise<BotOperationResult> {
    const current = this.dependencies.bots.get(id);
    if (!current) throw new Error('Bot not found.');
    const warnings: string[] = [];
    if (state === 'paused') {
      const messaging = await this.dependencies.dashboard.messagingPlatforms(current.profileName);
      for (const platform of messaging.platforms.filter((platform) => platform.enabled)) {
        try {
          successful(
            await this.dependencies.dashboard.setPlatformEnabled(
              platform.id,
              false,
              current.profileName,
            ),
          );
          this.dependencies.bots.rememberPausedChannel(current.id, platform.id);
        } catch (error) {
          warnings.push(
            `${platform.name}: ${error instanceof Error ? error.message : 'pause failed'}`,
          );
        }
      }
      const bot = this.dependencies.bots.setState(id, 'paused') as BotRecord;
      return { bot, warnings };
    }

    for (const channel of this.dependencies.bots.pausedChannels(id)) {
      try {
        successful(
          await this.dependencies.dashboard.setPlatformEnabled(
            channel.platformId,
            true,
            current.profileName,
          ),
        );
        this.dependencies.bots.forgetPausedChannel(id, channel.platformId);
      } catch (error) {
        warnings.push(
          `${channel.platformId}: ${error instanceof Error ? error.message : 'resume failed'}`,
        );
      }
    }
    const bot =
      warnings.length === 0
        ? (this.dependencies.bots.setState(id, 'active') as BotRecord)
        : (this.dependencies.bots.setState(id, 'paused') as BotRecord);
    return { bot, warnings };
  }

  linkRoutine(id: string, routine: BotRoutineInput): void {
    this.dependencies.bots.linkRoutine(id, routine);
  }

  setRoutineEnabled(id: string, routine: BotRoutineInput, enabled: boolean): void {
    this.dependencies.bots.setRoutineEnabled(id, routine, enabled);
  }

  unlinkRoutine(id: string, routine: BotRoutineInput): void {
    this.dependencies.bots.unlinkRoutine(id, routine);
  }

  private async details(
    bot: BotRecord,
    profile: ProfileOverview['profiles'][number] | null,
  ): Promise<BotDetails> {
    let messaging: MessagingOverview | null = null;
    try {
      messaging = await this.dependencies.dashboard.messagingPlatforms(bot.profileName);
    } catch {
      // A profile can exist while an older Hermes build lacks messaging APIs.
    }
    return { bot, profile, messaging, routines: this.dependencies.bots.routines(bot.id) };
  }
}
