import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { registerBotRoutes, type BotRoutesService } from './bots.js';

function setup() {
  const service: BotRoutesService = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'b-1' }),
    update: vi.fn().mockResolvedValue({ id: 'b-1' }),
    delete: vi.fn().mockResolvedValue({ id: 'b-1' }),
    setCanonicalChatSession: vi.fn().mockResolvedValue({ id: 'b-1' }),
    setHidden: vi.fn().mockResolvedValue({ id: 'b-1' }),
    setState: vi.fn().mockResolvedValue({ bot: { id: 'b-1' }, warnings: [] }),
    linkRoutine: vi.fn(),
    unlinkRoutine: vi.fn(),
  } as unknown as BotRoutesService;
  const app = Fastify();
  return { app, service };
}

describe('Bot routes', () => {
  it('validates creation and forwards a valid profile-backed Bot request', async () => {
    const { app, service } = setup();
    await registerBotRoutes(app, service);

    expect((await app.inject({ method: 'POST', url: '/api/bots', payload: {} })).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/bots',
          payload: { profileName: 'research', name: 'Researcher' },
        })
      ).statusCode,
    ).toBe(200);
    expect(service.create).toHaveBeenCalledWith({ profileName: 'research', name: 'Researcher' });
    await app.close();
  });

  it('accepts Bot creation without a manually supplied Hermes profile name', async () => {
    const { app, service } = setup();
    await registerBotRoutes(app, service);

    const response = await app.inject({
      method: 'POST',
      url: '/api/bots',
      payload: { name: 'Research & Design' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.create).toHaveBeenCalledWith({ name: 'Research & Design' });
    await app.close();
  });

  it('accepts an optional model/provider selection for a Bot', async () => {
    const { app, service } = setup();
    await registerBotRoutes(app, service);

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/bots',
          payload: {
            profileName: 'research',
            name: 'Researcher',
            provider: 'openai',
            model: 'gpt-5',
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(service.create).toHaveBeenCalledWith({
      profileName: 'research',
      name: 'Researcher',
      provider: 'openai',
      model: 'gpt-5',
    });
    await app.close();
  });

  it('returns capability-aware pause results and 404 for unknown Bots', async () => {
    const { app, service } = setup();
    await registerBotRoutes(app, service);

    expect((await app.inject({ method: 'GET', url: '/api/bots/missing' })).statusCode).toBe(404);
    const response = await app.inject({ method: 'POST', url: '/api/bots/b-1/pause' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ bot: { id: 'b-1' }, warnings: [] });
    expect(service.setState).toHaveBeenCalledWith('b-1', 'paused');
    await app.close();
  });

  it('deletes a Bot through the explicit permanent-delete route', async () => {
    const { app, service } = setup();
    await registerBotRoutes(app, service);

    const response = await app.inject({ method: 'DELETE', url: '/api/bots/b-1' });
    expect(response.statusCode).toBe(200);
    expect(service.delete).toHaveBeenCalledWith('b-1');
    await app.close();
  });

  it('returns conflict when permanent deletion targets the launch profile', async () => {
    const { app, service } = setup();
    service.delete.mockRejectedValue(
      new Error('The launch profile cannot be permanently deleted from Bot Center.'),
    );
    await registerBotRoutes(app, service);

    const response = await app.inject({ method: 'DELETE', url: '/api/bots/b-1' });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('binds a stored Hermes session to a Bot Chat', async () => {
    const { app, service } = setup();
    await registerBotRoutes(app, service);

    const response = await app.inject({
      method: 'POST',
      url: '/api/bots/b-1/chat-session',
      payload: { sessionId: 'session-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(service.setCanonicalChatSession).toHaveBeenCalledWith('b-1', 'session-1');
    await app.close();
  });
});
