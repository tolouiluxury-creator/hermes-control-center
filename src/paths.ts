import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where Hermes Agent keeps its state. Mirrors Hermes' own resolution order:
 * HERMES_HOME wins, otherwise the platform default.
 */
export function hermesHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HERMES_HOME?.trim();
  if (explicit) return explicit;

  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) return join(localAppData, 'hermes');
  }

  return join(homedir(), '.hermes');
}

/** Directory of a named Hermes profile (multi-user setups). */
export function hermesProfileHome(profile: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(hermesHome(env), 'profiles', profile);
}

/**
 * Our own state directory. Deliberately separate from ~/.hermes so we never
 * mix control-center data into the agent's own files.
 */
export function controlCenterHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.HERMES_CC_HOME?.trim();
  if (explicit) return explicit;
  return join(homedir(), '.hermes-cc');
}

export function controlCenterConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(controlCenterHome(env), 'config.json');
}

export function controlCenterDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(controlCenterHome(env), 'cc.db');
}
