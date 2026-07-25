import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONFIG_TEMPLATE,
  PLACEHOLDER_API_KEY,
  initControlCenterConfig,
  loadControlCenterConfig,
} from './config.js';

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hermes-cc-test-'));
  env = { HERMES_CC_HOME: home };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const write = (content: string): void => writeFileSync(join(home, 'config.json'), content, 'utf8');

describe('loadControlCenterConfig', () => {
  it('reports a missing file without complaining', () => {
    const loaded = loadControlCenterConfig(env);
    expect(loaded.exists).toBe(false);
    expect(loaded.config).toEqual({});
    expect(loaded.notes).toEqual([]);
  });

  it('reads a valid file', () => {
    write(JSON.stringify({ apiKey: 'real-key', port: 8080 }));
    const loaded = loadControlCenterConfig(env);
    expect(loaded.config.apiKey).toBe('real-key');
    expect(loaded.config.port).toBe(8080);
    expect(loaded.notes).toEqual([]);
  });

  it('treats the template placeholder as no key at all', () => {
    write(JSON.stringify({ apiKey: PLACEHOLDER_API_KEY }));
    const loaded = loadControlCenterConfig(env);
    expect(loaded.config.apiKey).toBeNull();
    expect(loaded.notes.join(' ')).toContain('placeholder');
  });

  it('ignores malformed JSON but keeps running', () => {
    write('{ not json');
    const loaded = loadControlCenterConfig(env);
    expect(loaded.exists).toBe(true);
    expect(loaded.config).toEqual({});
    expect(loaded.notes).toHaveLength(1);
  });

  it('ignores a file with an invalid value', () => {
    write(JSON.stringify({ port: 70000, hermesApiUrl: 'not-a-url' }));
    const loaded = loadControlCenterConfig(env);
    expect(loaded.config).toEqual({});
    expect(loaded.notes[0]).toContain('invalid value');
  });
});

describe('initControlCenterConfig', () => {
  it('writes the template on first run', () => {
    const result = initControlCenterConfig(env);
    expect(result.created).toBe(true);
    expect(JSON.parse(readFileSync(result.path, 'utf8'))).toMatchObject({
      apiKey: CONFIG_TEMPLATE.apiKey,
    });
  });

  it('never overwrites an existing file', () => {
    write(JSON.stringify({ apiKey: 'do-not-lose-me' }));
    const result = initControlCenterConfig(env);
    expect(result.created).toBe(false);
    expect(loadControlCenterConfig(env).config.apiKey).toBe('do-not-lose-me');
  });
});
