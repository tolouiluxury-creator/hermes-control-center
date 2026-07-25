import { createServer } from 'node:net';

/** True when nothing else is listening on host:port. */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/**
 * Returns the first free port at or after `preferred`. Keeps the control center
 * usable when 7777 is already taken instead of crashing with EADDRINUSE.
 */
export async function findFreePort(
  preferred: number,
  host: string,
  attempts = 20,
): Promise<number> {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = preferred + offset;
    if (candidate > 65535) break;
    if (await isPortFree(candidate, host)) return candidate;
  }
  throw new Error(
    `No free port found between ${preferred} and ${preferred + attempts - 1} on ${host}.`,
  );
}
