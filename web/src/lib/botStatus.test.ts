import { describe, expect, it } from 'vitest';
import { botStatus, type BotStatusInput } from './botStatus';

const runningTelegram = {
  enabled: true,
  configured: true,
  gatewayRunning: true,
  requiredMissing: 0,
};

const incompleteDiscord = {
  enabled: false,
  configured: false,
  gatewayRunning: false,
  requiredMissing: 1,
};

const stoppedTelegram = {
  enabled: true,
  configured: true,
  gatewayRunning: false,
  requiredMissing: 0,
};

const incompleteTelegram = {
  enabled: false,
  configured: false,
  gatewayRunning: false,
  requiredMissing: 1,
};

describe('botStatus', () => {
  const input = (
    state: BotStatusInput['state'],
    platforms: BotStatusInput['platforms'],
  ): BotStatusInput => ({
    state,
    platforms,
  });

  it('keeps a Bot online when another unused platform is incomplete', () => {
    expect(botStatus(input('active', [runningTelegram, incompleteDiscord]))).toBe('online');
  });

  it('reports setup when no platform is runnable and setup is incomplete', () => {
    expect(botStatus(input('active', [incompleteTelegram]))).toBe('setup');
  });

  it('reports offline when configured platforms are stopped', () => {
    expect(botStatus(input('active', [stoppedTelegram]))).toBe('offline');
  });

  it('keeps an explicitly paused Bot paused', () => {
    expect(botStatus(input('paused', [runningTelegram]))).toBe('paused');
  });
});
