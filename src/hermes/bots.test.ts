import { describe, expect, it, vi } from 'vitest';
import { Store } from '../store/db.js';
import { BotsRepo } from '../store/bots.js';
import { BotService } from './bots.js';

function setup() {
  const store = Store.open(':memory:');
  const bots = new BotsRepo(store);
  const dashboard = {
    profiles: vi.fn().mockResolvedValue({
      profiles: [
        {
          name: 'research',
          model: 'hermes-free',
          provider: 'nous',
          description: 'Facts',
          skillCount: 4,
          gatewayRunning: true,
          path: null,
          isDefault: false,
        },
      ],
      active: 'research',
      current: 'research',
    }),
    messagingPlatforms: vi.fn().mockResolvedValue({
      platforms: [
        {
          id: 'telegram',
          name: 'Telegram',
          enabled: true,
          configured: true,
          gatewayRunning: true,
          description: null,
          docsUrl: null,
          state: 'running',
          errorMessage: null,
          homeChannel: null,
          requiredTotal: 1,
          requiredMissing: 0,
          envVars: [],
        },
      ],
      configuredCount: 1,
      enabledCount: 1,
    }),
    createProfile: vi.fn().mockResolvedValue({ ok: true }),
    deleteProfile: vi.fn().mockResolvedValue({ ok: true }),
    setProfileModel: vi.fn().mockResolvedValue({ ok: true }),
    setProfileDescription: vi.fn().mockResolvedValue({ ok: true }),
    setPlatformEnabled: vi.fn().mockResolvedValue({ ok: true }),
  };
  const service = new BotService({ bots, dashboard, launchProfile: 'main' });
  return { store, bots, dashboard, service };
}

describe('BotService', () => {
  it('creates Hermes profile first and then persists the Bot identity', async () => {
    const { store, bots, dashboard, service } = setup();
    const bot = await service.create({
      profileName: 'research',
      name: 'Researcher',
      description: 'Facts',
    });

    expect(dashboard.createProfile).toHaveBeenCalledWith({
      name: 'research',
      description: 'Facts',
    });
    expect(bot).toMatchObject({ profileName: 'research', name: 'Researcher' });
    expect(bots.getByProfile('research')).not.toBeNull();
    store.close();
  });

  it('derives the Hermes profile name from the Bot name when omitted', async () => {
    const { store, bots, dashboard, service } = setup();
    const bot = await service.create({ name: 'Research & Design' });

    expect(dashboard.createProfile).toHaveBeenCalledWith({
      name: 'research-design',
    });
    expect(bot.profileName).toBe('research-design');
    expect(bots.getByProfile('research-design')).not.toBeNull();
    store.close();
  });

  it('pauses enabled channels and resumes only channels changed by the pause', async () => {
    const { store, dashboard, service } = setup();
    const bot = await service.create({ profileName: 'research', name: 'Researcher' });

    await service.setState(bot.id, 'paused');
    expect(dashboard.setPlatformEnabled).toHaveBeenCalledWith('telegram', false, 'research');
    expect((await service.get(bot.id))?.bot.state).toBe('paused');

    await service.setState(bot.id, 'active');
    expect(dashboard.setPlatformEnabled).toHaveBeenLastCalledWith('telegram', true, 'research');
    expect((await service.get(bot.id))?.bot.state).toBe('active');
    store.close();
  });

  it('applies the selected model to the new Hermes profile before saving the Bot', async () => {
    const { store, dashboard, service } = setup();
    const bot = await service.create({
      profileName: 'research',
      name: 'Researcher',
      provider: 'openai',
      model: 'gpt-5',
    });

    expect(dashboard.setProfileModel).toHaveBeenCalledWith('research', 'openai', 'gpt-5');
    expect(bot.profileName).toBe('research');
    store.close();
  });

  it('rolls back the Hermes profile when the selected model cannot be applied', async () => {
    const { store, bots, dashboard, service } = setup();
    dashboard.setProfileModel.mockResolvedValue({ ok: false });

    await expect(
      service.create({
        profileName: 'research',
        name: 'Researcher',
        provider: 'openai',
        model: 'gpt-5',
      }),
    ).rejects.toThrow('Hermes rejected the Bot operation.');
    expect(dashboard.deleteProfile).toHaveBeenCalledWith('research');
    expect(bots.getByProfile('research')).toBeNull();
    store.close();
  });

  it('deletes Hermes profile before local metadata and protects the launch profile', async () => {
    const { store, bots, dashboard, service } = setup();
    const bot = await service.create({ profileName: 'research', name: 'Researcher' });
    const launchBot = await service.create({ profileName: 'main', name: 'Main' });

    await service.delete(bot.id);
    expect(dashboard.deleteProfile).toHaveBeenCalledWith('research');
    expect(bots.get(bot.id)).toBeNull();
    await expect(service.delete(launchBot.id)).rejects.toThrow('launch profile');
    expect(bots.get(launchBot.id)).not.toBeNull();
    store.close();
  });

  it('keeps local metadata when Hermes rejects permanent deletion', async () => {
    const { store, bots, dashboard, service } = setup();
    const bot = await service.create({ profileName: 'research', name: 'Researcher' });
    dashboard.deleteProfile.mockResolvedValue({ ok: false });

    await expect(service.delete(bot.id)).rejects.toThrow('Hermes rejected the Bot operation.');
    expect(bots.get(bot.id)).not.toBeNull();
    store.close();
  });
});
