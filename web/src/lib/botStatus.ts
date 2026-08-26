export type BotStatus = 'paused' | 'online' | 'setup' | 'offline';

export interface BotStatusPlatform {
  enabled: boolean;
  configured: boolean;
  gatewayRunning: boolean;
  requiredMissing: number;
}

export interface BotStatusInput {
  state: 'active' | 'paused';
  platforms: BotStatusPlatform[];
}

export function botStatus({ state, platforms }: BotStatusInput): BotStatus {
  if (state === 'paused') return 'paused';

  if (
    platforms.some((platform) => platform.enabled && platform.configured && platform.gatewayRunning)
  ) {
    return 'online';
  }

  if (platforms.length === 0 || platforms.some((platform) => platform.requiredMissing > 0)) {
    return 'setup';
  }

  return 'offline';
}
