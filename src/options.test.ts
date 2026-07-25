import { describe, expect, it } from 'vitest';
import { DEFAULT_HOST, DEFAULT_PORT, OptionsError, parseOptions } from './options.js';

const noEnv: NodeJS.ProcessEnv = {};

describe('parseOptions', () => {
  it('defaults to loopback, port 7777, serve mode and opening a browser', () => {
    const options = parseOptions([], noEnv);
    expect(options).toMatchObject({
      port: DEFAULT_PORT,
      host: DEFAULT_HOST,
      open: true,
      mode: 'serve',
      profile: null,
      apiKey: null,
    });
  });

  it('reads flags and strips trailing slashes from upstream URLs', () => {
    const options = parseOptions(
      ['--port', '8080', '--host', '0.0.0.0', '--hermes-api', 'http://10.0.0.5:8642/'],
      noEnv,
    );
    expect(options.port).toBe(8080);
    expect(options.host).toBe('0.0.0.0');
    expect(options.hermesApiUrl).toBe('http://10.0.0.5:8642');
  });

  it('lets flags win over environment variables', () => {
    const options = parseOptions(['--port', '9000'], { HERMES_CC_PORT: '8000' });
    expect(options.port).toBe(9000);
  });

  it('falls back to environment variables when no flag is given', () => {
    const options = parseOptions([], { HERMES_CC_PORT: '8000', HERMES_CC_API_KEY: 'secret' });
    expect(options.port).toBe(8000);
    expect(options.apiKey).toBe('secret');
  });

  it('honours --no-open over --open', () => {
    expect(parseOptions(['--no-open'], noEnv).open).toBe(false);
    expect(parseOptions(['--open', '--no-open'], noEnv).open).toBe(false);
  });

  it('selects doctor, help and version modes', () => {
    expect(parseOptions(['--doctor'], noEnv).mode).toBe('doctor');
    expect(parseOptions(['--help'], noEnv).mode).toBe('help');
    expect(parseOptions(['-v'], noEnv).mode).toBe('version');
  });

  it('rejects invalid ports, URLs, log levels and unknown flags', () => {
    expect(() => parseOptions(['--port', '99999'], noEnv)).toThrow(OptionsError);
    expect(() => parseOptions(['--port', 'abc'], noEnv)).toThrow(OptionsError);
    expect(() => parseOptions(['--hermes-api', 'ftp://x'], noEnv)).toThrow(OptionsError);
    expect(() => parseOptions(['--hermes-api', 'not a url'], noEnv)).toThrow(OptionsError);
    expect(() => parseOptions(['--log-level', 'loud'], noEnv)).toThrow(OptionsError);
    expect(() => parseOptions(['--nope'], noEnv)).toThrow(OptionsError);
  });
});
