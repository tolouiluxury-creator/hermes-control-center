import { posix as posixPath, win32 as win32Path } from 'node:path';

/**
 * Confining the workspace area to one directory.
 *
 * This exists because Hermes does not do it. Its managed-file endpoints carry a
 * `locked_root`, but it can be — and on a real install is — null, in which case
 * `GET /api/files?path=/etc` answers 200 and `DELETE /api/files` reaches
 * anything the agent's user can reach. Building a browser straight onto that
 * would put the whole server behind a web page, which is exactly the trade the
 * terminal area was designed to avoid.
 *
 * So every path this control center sends upstream is resolved and checked here
 * first. Server-side: a browser-side check protects nobody, since the API is
 * reachable without the browser.
 *
 * Paths are the *Hermes host's*, which may be POSIX while this process runs on
 * Windows — so resolution never uses `node:path` defaults. The flavour is
 * chosen from the root itself.
 */

export interface WorkspaceRoot {
  /** Absolute path on the Hermes host. */
  root: string;
  /** True when the root looks like a Windows path (`C:\…`). */
  windows: boolean;
}

/** A Windows root looks like `C:\…` or `\\server\share`. Everything else is POSIX. */
export function detectWorkspaceRoot(root: string): WorkspaceRoot {
  const trimmed = root.trim();
  const windows = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\');
  return { root: normalize(trimmed, windows), windows };
}

function normalize(value: string, windows: boolean): string {
  const engine = windows ? win32Path : posixPath;
  const resolved = engine.normalize(value);
  // A trailing separator would make the prefix comparison below inconsistent
  // between "/a/b" and "/a/b/". The root itself is never the empty string.
  const stripped = resolved.replace(/[\\/]+$/, '');
  return stripped === '' ? resolved : stripped;
}

/** Joins a plain name onto a parent path, in whichever flavour the parent is. */
export function joinChildPath(parent: string, name: string): string {
  const { windows } = detectWorkspaceRoot(parent);
  const engine = windows ? win32Path : posixPath;
  return engine.join(parent, name);
}

export class OutsideWorkspaceError extends Error {
  constructor(readonly attempted: string) {
    super('Path is outside the workspace root.');
    this.name = 'OutsideWorkspaceError';
  }
}

/**
 * Resolve a requested path against the root, or refuse.
 *
 * `requested` may be absolute (the browser echoes back paths Hermes reported)
 * or relative to the root. Either way the result must sit inside the root:
 * `..` that climbs out, an absolute path elsewhere, and a path that merely
 * *starts* with the root's characters (`/root/workspace-evil`) are all refused.
 */
export function resolveInsideRoot(config: WorkspaceRoot, requested?: string | null): string {
  const engine = config.windows ? win32Path : posixPath;
  const raw = (requested ?? '').trim();
  if (raw === '') return config.root;

  const candidate = engine.isAbsolute(raw)
    ? normalize(raw, config.windows)
    : normalize(engine.join(config.root, raw), config.windows);

  if (!isInside(config, candidate, engine)) throw new OutsideWorkspaceError(raw);
  return candidate;
}

function isInside(
  config: WorkspaceRoot,
  candidate: string,
  engine: typeof posixPath | typeof win32Path,
): boolean {
  const compare = (value: string) => (config.windows ? value.toLowerCase() : value);
  const root = compare(config.root);
  const target = compare(candidate);
  if (target === root) return true;
  // The separator matters: without it "/root/workspace-evil" would pass a plain
  // startsWith against "/root/workspace".
  return target.startsWith(root + engine.sep) || (engine === posixPath && root === '/');
}

/** The path shown to the user: relative to the root, so the root itself reads as "/". */
export function displayPath(config: WorkspaceRoot, absolute: string): string {
  const engine = config.windows ? win32Path : posixPath;
  const relative = engine.relative(config.root, absolute);
  return relative === '' ? '/' : relative.split(engine.sep).join('/');
}
