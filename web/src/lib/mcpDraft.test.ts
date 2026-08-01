import { describe, expect, it } from 'vitest';
import { mcpCreatePayload, mcpUpdatePayload, parseEnv, splitArgs, type McpDraft } from './mcpDraft';

const draft = (patch: Partial<McpDraft>): McpDraft => ({
  isNew: true,
  name: 'context7',
  transport: 'stdio',
  url: '',
  command: '',
  args: '',
  env: '',
  bearerToken: '',
  ...patch,
});

describe('mcpCreatePayload', () => {
  it('never sends args or env with a URL — Hermes rejects that combination', () => {
    const payload = mcpCreatePayload(
      draft({
        transport: 'http',
        url: 'https://example.com/mcp',
        // Left over from filling in the stdio fields before switching.
        command: 'npx',
        args: '-y @upstash/context7-mcp',
        env: 'API_KEY=secret',
      }),
    );
    expect(payload).toEqual({ name: 'context7', url: 'https://example.com/mcp' });
  });

  it('never sends a URL with a command', () => {
    const payload = mcpCreatePayload(
      draft({ command: 'npx', args: '-y @upstash/context7-mcp', url: 'https://example.com/mcp' }),
    );
    expect(payload.url).toBeUndefined();
    expect(payload).toEqual({
      name: 'context7',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      env: {},
    });
  });

  it('sends a bearer token as header auth, and omits both when the field is empty', () => {
    const withToken = mcpCreatePayload(
      draft({ transport: 'http', url: 'https://example.com/mcp', bearerToken: '  tok_123  ' }),
    );
    expect(withToken).toMatchObject({ auth: 'header', bearerToken: 'tok_123' });

    const without = mcpCreatePayload(draft({ transport: 'http', url: 'https://example.com/mcp' }));
    expect(without).not.toHaveProperty('auth');
    expect(without).not.toHaveProperty('bearerToken');
  });
});

describe('mcpUpdatePayload', () => {
  it('touches only the transport the server already has', () => {
    expect(
      mcpUpdatePayload(draft({ isNew: false, transport: 'http', url: ' https://x/mcp ' })),
    ).toEqual({ url: 'https://x/mcp' });
    expect(mcpUpdatePayload(draft({ isNew: false, command: 'npx', args: '-y pkg' }))).toEqual({
      command: 'npx',
      args: ['-y', 'pkg'],
    });
  });

  it('omits env entirely when nothing was typed, so the real values survive the merge', () => {
    expect(mcpUpdatePayload(draft({ isNew: false, command: 'npx' }))).not.toHaveProperty('env');
    expect(mcpUpdatePayload(draft({ isNew: false, command: 'npx', env: 'A=1' })).env).toEqual({
      A: '1',
    });
  });
});

describe('splitArgs', () => {
  it('honours quotes and nothing else', () => {
    expect(splitArgs('-y "two words" \'and more\'')).toEqual(['-y', 'two words', 'and more']);
    expect(splitArgs('   ')).toEqual([]);
  });
});

describe('parseEnv', () => {
  it('keeps the first equals sign as the separator', () => {
    expect(parseEnv('URL=https://x/?a=b')).toEqual({ URL: 'https://x/?a=b' });
  });

  it('skips blank lines and lines without a key', () => {
    expect(parseEnv('\n=novalue\nA=1\n')).toEqual({ A: '1' });
  });
});
