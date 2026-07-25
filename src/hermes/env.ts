import { readFileSync } from 'node:fs';

/**
 * Minimal .env reader for Hermes' own config file. Deliberately dependency-free
 * and forgiving: we only need to *read* a handful of keys, and a parse hiccup
 * must never stop the control center from starting.
 */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separator = withoutExport.indexOf('=');
    if (separator <= 0) continue;

    const key = withoutExport.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = withoutExport.slice(separator + 1).trim();

    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    } else {
      // Unquoted values may carry a trailing comment.
      const comment = value.indexOf(' #');
      if (comment !== -1) value = value.slice(0, comment).trimEnd();
    }

    result[key] = value;
  }

  return result;
}

/** Reads and parses a .env file. Returns an empty object when unreadable. */
export function readDotEnv(path: string): Record<string, string> {
  try {
    return parseDotEnv(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** Interprets Hermes-style booleans (`true`, `1`, `yes`, `on`). */
export function asBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return null;
}

/** Interprets a port value, ignoring anything out of range. */
export function asPort(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}
