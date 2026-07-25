import { createInterface } from 'node:readline';

/**
 * Reads a secret from the terminal without echoing it.
 *
 * Falls back to reading piped stdin when there is no TTY, which is what makes
 * `echo 'pw' | hermes-control-center --set-password` work in scripts and tests.
 */
export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return readPipedLine();

  process.stdout.write(prompt);

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };

    const onData = (chunk: Buffer): void => {
      for (const byte of chunk) {
        switch (byte) {
          case 0x03: // Ctrl+C
            cleanup();
            reject(new Error('Cancelled.'));
            return;
          case 0x04: // Ctrl+D
          case 0x0a: // \n
          case 0x0d: // \r
            cleanup();
            resolve(value);
            return;
          case 0x7f: // Backspace
          case 0x08:
            value = value.slice(0, -1);
            break;
          default:
            // Ignore other control characters; accept everything printable.
            if (byte >= 0x20) value += String.fromCharCode(byte);
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function readPipedLine(): Promise<string> {
  return new Promise<string>((resolve) => {
    const reader = createInterface({ input: process.stdin });
    let first: string | null = null;

    reader.on('line', (line) => {
      first ??= line;
    });
    // A byte-order mark is an encoding artefact, not part of the secret.
    // Windows PowerShell prepends one when piping into a native command, which
    // would otherwise store a password nobody can ever type again.
    reader.on('close', () => resolve(stripBom(first ?? '')));
  });
}

const BOM = 0xfeff;

export function stripBom(value: string): string {
  return value.charCodeAt(0) === BOM ? value.slice(1) : value;
}
