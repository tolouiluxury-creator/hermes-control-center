import { describe, expect, it } from 'vitest';
import {
  detectWorkspaceRoot,
  displayPath,
  joinChildPath,
  OutsideWorkspaceError,
  resolveInsideRoot,
} from './workspaceRoot.js';

/**
 * These are the tests that matter most in the project.
 *
 * Hermes' file API is not sandboxed on every install — the one this was built
 * against reports `locked_root: null` and lists `/etc` — so this module is the
 * only thing standing between the workspace page and the whole server.
 */

const posixRoot = detectWorkspaceRoot('/root/workspace');

describe('resolveInsideRoot', () => {
  it('treats an empty request as the root itself', () => {
    expect(resolveInsideRoot(posixRoot, undefined)).toBe('/root/workspace');
    expect(resolveInsideRoot(posixRoot, '')).toBe('/root/workspace');
  });

  it('joins a relative path onto the root', () => {
    expect(resolveInsideRoot(posixRoot, 'notes/today.md')).toBe('/root/workspace/notes/today.md');
  });

  it('accepts an absolute path that is already inside', () => {
    // The browser echoes back the absolute paths Hermes reports, so this is the
    // ordinary case, not an edge one.
    expect(resolveInsideRoot(posixRoot, '/root/workspace/notes')).toBe('/root/workspace/notes');
  });

  it('refuses climbing out with ..', () => {
    expect(() => resolveInsideRoot(posixRoot, '../../etc/shadow')).toThrow(OutsideWorkspaceError);
    expect(() => resolveInsideRoot(posixRoot, 'notes/../../../etc')).toThrow(OutsideWorkspaceError);
  });

  it('refuses an absolute path somewhere else', () => {
    expect(() => resolveInsideRoot(posixRoot, '/etc')).toThrow(OutsideWorkspaceError);
    expect(() => resolveInsideRoot(posixRoot, '/root/.hermes/.env')).toThrow(OutsideWorkspaceError);
  });

  /**
   * The one a plain `startsWith` gets wrong. A sibling directory whose name
   * merely begins with the root's would otherwise be fully reachable.
   */
  it('refuses a sibling whose name starts with the root', () => {
    expect(() => resolveInsideRoot(posixRoot, '/root/workspace-evil/secrets')).toThrow(
      OutsideWorkspaceError,
    );
  });

  it('normalises a trailing separator on the root', () => {
    const trailing = detectWorkspaceRoot('/root/workspace/');
    expect(trailing.root).toBe('/root/workspace');
    expect(() => resolveInsideRoot(trailing, '/root/workspace-evil')).toThrow(
      OutsideWorkspaceError,
    );
  });
});

describe('detectWorkspaceRoot', () => {
  it('reads a Windows root as Windows, even when this process is not', () => {
    // The paths belong to the Hermes host, which need not match this one.
    const root = detectWorkspaceRoot('C:\\Users\\me\\workspace');
    expect(root.windows).toBe(true);
    expect(resolveInsideRoot(root, 'notes')).toBe('C:\\Users\\me\\workspace\\notes');
    expect(() => resolveInsideRoot(root, 'C:\\Windows')).toThrow(OutsideWorkspaceError);
  });

  it('compares Windows paths case-insensitively', () => {
    const root = detectWorkspaceRoot('C:\\work');
    expect(resolveInsideRoot(root, 'c:\\WORK\\notes')).toBe('c:\\WORK\\notes');
  });

  it('reads a POSIX root as POSIX', () => {
    expect(detectWorkspaceRoot('/srv/data').windows).toBe(false);
  });
});

describe('joinChildPath', () => {
  it('joins a name onto a POSIX parent', () => {
    expect(joinChildPath('/home/me', 'projects')).toBe('/home/me/projects');
  });

  it('joins a name onto a Windows parent, detected from the parent itself', () => {
    expect(joinChildPath('C:\\Users\\me', 'workspace')).toBe('C:\\Users\\me\\workspace');
  });
});

describe('displayPath', () => {
  it('shows the root as / and everything else relative to it', () => {
    expect(displayPath(posixRoot, '/root/workspace')).toBe('/');
    expect(displayPath(posixRoot, '/root/workspace/notes/today.md')).toBe('notes/today.md');
  });
});
