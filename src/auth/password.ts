import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's standard library — no dependency, and
 * memory-hard, which is what matters against offline cracking if the config file
 * ever leaks.
 *
 * Stored format: scrypt$N$r$p$<salt-b64>$<hash-b64>
 * The parameters travel with the hash so they can be raised later without
 * invalidating existing passwords.
 */

const SCHEME = 'scrypt';
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/** ~60-90 ms on a modern CPU: slow enough to matter, fast enough for a login. */
const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1 } as const;

/** scryptSync needs headroom above 128 * N * r bytes (32 MiB at these values). */
const MAX_MEM = 128 * 1024 * 1024;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    ...params,
    maxmem: MAX_MEM,
  });

  return [
    SCHEME,
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification. Returns false for anything malformed rather than
 * throwing, so a corrupted config cannot be told apart from a wrong password.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, rawN, rawR, rawP, saltB64, hashB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (scheme !== SCHEME) return false;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Refuse absurd parameters: a hostile config file must not turn a login into
  // a memory bomb.
  if (N < 1024 || N > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(hashB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const CODE_UNIT_DEL = 0x7f;
const CODE_UNIT_LAST_CONTROL = 0x1f;
const CODE_UNIT_BOM = 0xfeff;

/**
 * True for characters a user could never type back in: C0 control codes, DEL,
 * and the byte-order mark. Written as an explicit scan rather than a regex so
 * the source contains no invisible characters of its own.
 */
export function hasUntypeableCharacter(password: string): boolean {
  for (let index = 0; index < password.length; index += 1) {
    const code = password.charCodeAt(index);
    if (code <= CODE_UNIT_LAST_CONTROL || code === CODE_UNIT_DEL || code === CODE_UNIT_BOM) {
      return true;
    }
  }
  return false;
}

/**
 * Rejects passwords that would make the login gate pointless — and, just as
 * importantly, passwords that cannot be typed back in.
 *
 * Control characters and byte-order marks only ever arrive from an encoding
 * accident: piping through a shell that prepends a BOM (Windows PowerShell does
 * this), or a stray carriage return from a CRLF file. Accepting one would lock
 * the user out of their own control center with no way to tell why.
 */
export function validatePasswordStrength(password: string): string | null {
  if (hasUntypeableCharacter(password)) {
    return (
      'Password contains a control character or byte-order mark. That is almost always an ' +
      'encoding artefact from the shell rather than something you typed — nothing was changed.'
    );
  }
  if (password.length < 8) return 'Password must be at least 8 characters long.';
  if (password.length > 1024) return 'Password must be at most 1024 characters long.';
  if (password.trim() === '') return 'Password must not be blank.';

  return null;
}
