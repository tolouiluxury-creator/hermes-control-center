import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageInfo {
  name: string;
  version: string;
}

const FALLBACK: PackageInfo = { name: 'hermes-control-center', version: '0.0.0-dev' };

/**
 * Walks up from this module to find our own package.json. Works both from `src/`
 * (tsx dev run) and from `dist/` (published package) without hardcoding depth.
 */
function readOwnPackage(): PackageInfo {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<PackageInfo>;
        if (parsed.name === FALLBACK.name && typeof parsed.version === 'string') {
          return { name: parsed.name, version: parsed.version };
        }
      } catch {
        // Unreadable or malformed package.json: keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return FALLBACK;
}

export const pkg: PackageInfo = readOwnPackage();

/** Absolute path to the built SPA, or null when it has not been built yet. */
export function resolveWebRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'dist', 'web', 'index.html');
    if (existsSync(candidate)) return dirname(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
