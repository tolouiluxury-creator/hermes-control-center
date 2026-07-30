import { resolve, sep } from 'node:path';

export type SpaResolution =
  { kind: 'file'; relative: string; immutable: boolean } | { kind: 'spa' };

/**
 * Decides whether a request maps to a real file in the built bundle or to a
 * client-side route. Pure and injectable so the rules — containment, index
 * fallback, cache eligibility — are unit-testable without a server.
 *
 * Unknown paths deliberately return the SPA rather than a 404: that is what
 * makes deep links like /workspace work on a hard reload.
 */
export function resolveSpaRequest(
  webRoot: string,
  url: string,
  isFile: (absolutePath: string) => boolean,
): SpaResolution {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? '/';

  let pathname: string;
  try {
    pathname = decodeURIComponent(withoutQuery);
  } catch {
    // Malformed percent-encoding: treat as a route, never as a path.
    return { kind: 'spa' };
  }

  // A NUL byte can truncate paths in lower layers.
  if (pathname.includes('\0')) return { kind: 'spa' };

  const relative = pathname.replace(/^\/+/, '');
  if (relative === '') return { kind: 'spa' };

  const root = resolve(webRoot);
  const absolute = resolve(root, relative);
  const insideRoot = absolute === root || absolute.startsWith(`${root}${sep}`);
  if (!insideRoot) return { kind: 'spa' };

  if (!isFile(absolute)) return { kind: 'spa' };

  return {
    kind: 'file',
    relative,
    // Vite emits content-hashed names under assets/, so they can be pinned
    // forever. Everything else (index.html, icons, manifest) must revalidate.
    immutable: relative.startsWith('assets/'),
  };
}
