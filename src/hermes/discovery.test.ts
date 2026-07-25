import { describe, expect, it } from 'vitest';
import { discoverHermes, toPublicConnection } from './discovery.js';
import { parseOptions } from '../options.js';
import type { LoadedConfig } from '../config.js';

const CONFIG_PATH = '/home/u/.hermes-cc/config.json';

function loaded(config: LoadedConfig['config'], notes: string[] = []): LoadedConfig {
  return { path: CONFIG_PATH, exists: true, config, notes };
}

const noConfig: LoadedConfig = { path: CONFIG_PATH, exists: false, config: {}, notes: [] };

/**
 * A Hermes home that does not exist is the normal case in these tests: they
 * cover precedence, not filesystem reading. `HERMES_HOME` points somewhere
 * absent so no developer's real config can leak into the assertions.
 */
const env: NodeJS.ProcessEnv = { HERMES_HOME: '/nonexistent/hermes' };

describe('discoverHermes', () => {
  it('falls back to documented defaults', () => {
    const connection = discoverHermes(parseOptions([], env), env, noConfig);
    expect(connection.apiServer.url).toBe('http://127.0.0.1:8642');
    expect(connection.apiServer.source).toBe('default');
    expect(connection.dashboard.url).toBe('http://127.0.0.1:9119');
    expect(connection.apiServer.key).toBeNull();
  });

  it('takes URLs and key from the control center config file', () => {
    const connection = discoverHermes(
      parseOptions([], env),
      env,
      loaded({
        hermesApiUrl: 'http://127.0.0.1:18642/',
        hermesDashboardUrl: 'http://127.0.0.1:19119',
        apiKey: 'from-file',
        profile: 'alice',
      }),
    );

    expect(connection.apiServer.url).toBe('http://127.0.0.1:18642');
    expect(connection.apiServer.source).toBe('cc-config');
    expect(connection.dashboard.url).toBe('http://127.0.0.1:19119');
    expect(connection.apiServer.key).toBe('from-file');
    expect(connection.apiServer.keySource).toBe('cc-config');
    expect(connection.profile).toBe('alice');
  });

  it('lets command line flags win over the config file', () => {
    const options = parseOptions(
      ['--hermes-api', 'http://10.0.0.9:8642', '--api-key', 'from-flag'],
      env,
    );
    const connection = discoverHermes(
      options,
      env,
      loaded({ hermesApiUrl: 'http://127.0.0.1:18642', apiKey: 'from-file' }),
    );

    expect(connection.apiServer.url).toBe('http://10.0.0.9:8642');
    expect(connection.apiServer.source).toBe('flag');
    expect(connection.apiServer.key).toBe('from-flag');
    expect(connection.apiServer.keySource).toBe('flag');
  });

  it('warns about a missing Hermes home only when nothing is configured locally', () => {
    const bare = discoverHermes(parseOptions([], env), env, noConfig);
    expect(bare.warnings.some((warning) => warning.includes('Hermes home not found'))).toBe(true);

    // A remote Hermes has no local ~/.hermes, and that is not a problem.
    const remote = discoverHermes(
      parseOptions([], env),
      env,
      loaded({ apiKey: 'k', hermesApiUrl: 'http://127.0.0.1:8642' }),
    );
    expect(remote.warnings.some((warning) => warning.includes('Hermes home not found'))).toBe(
      false,
    );
  });

  it('warns about a missing key and points at the config file', () => {
    const connection = discoverHermes(parseOptions([], env), env, noConfig);
    const warning = connection.warnings.find((entry) => entry.includes('No API_SERVER_KEY'));
    expect(warning).toContain(CONFIG_PATH);
  });

  it('surfaces config file notes as warnings instead of throwing', () => {
    const connection = discoverHermes(
      parseOptions([], env),
      env,
      loaded({}, ['Ignoring config.json: invalid value at apiKey']),
    );
    expect(connection.warnings).toContain('Ignoring config.json: invalid value at apiKey');
  });

  it('marks a config-supplied connection as remote', () => {
    expect(discoverHermes(parseOptions([], env), env, noConfig).configuredRemotely).toBe(false);
    expect(
      discoverHermes(parseOptions([], env), env, loaded({ apiKey: 'k' })).configuredRemotely,
    ).toBe(true);
  });
});

describe('toPublicConnection', () => {
  it('never exposes the key itself', () => {
    const connection = discoverHermes(
      parseOptions([], env),
      env,
      loaded({ apiKey: 'super-secret' }),
    );
    const publicView = toPublicConnection(connection);

    expect(publicView.apiServer.hasKey).toBe(true);
    expect(publicView.apiServer.keySource).toBe('cc-config');
    expect(JSON.stringify(publicView)).not.toContain('super-secret');
  });
});
