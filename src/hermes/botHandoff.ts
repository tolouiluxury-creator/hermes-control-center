import { exec as execCb } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(execCb);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Hand a message to a bot's own chat via the CLI, the same mechanism the
 * Hermes desktop bot mode uses (`hermes -p <target> chat --in <dir> -q …`).
 * The target bot answers in its own profile chat; the sender's identity is
 * embedded in the message. Returns the extracted boxed reply, or a short
 * fallback if the CLI did not print a box.
 */
export async function botHandoff(
  targetProfile: string,
  prompt: string,
  timeoutMs = 120_000,
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const inboxDir = mkdtempSync(join(tmpdir(), 'cc-handoff-'));
  try {
    const queryFile = join(inboxDir, 'msg.txt');
    writeFileSync(queryFile, prompt, 'utf8');
    const { stdout } = await execAsync(
      `hermes -p ${shellQuote(targetProfile)} chat --in ${shellQuote(inboxDir)} -q "$(cat ${shellQuote(queryFile)})"`,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
    );
    const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
    const boxStart = lines.findIndex((line) => line.includes('╭'));
    const boxEnd = lines.findIndex((line) => line.includes('╰'));
    let reply =
      boxStart >= 0 && boxEnd > boxStart
        ? lines.slice(boxStart + 1, boxEnd).join(' ').replace(/\s+/g, ' ').trim()
        : '';
    if (!reply) {
      // No boxed answer: drop session/resume metadata lines and keep the last
      // line of actual content (the CLI's plain-mode answer tail).
      const content = lines.filter(
        (line) => !/^(Session:|Title:|.*Resume|.*>|.*chat\b)/i.test(line) && !line.startsWith('╭') && !line.startsWith('╰'),
      );
      reply = content.length > 0 ? content.slice(-3).join(' ') : lines.slice(-4).join(' ');
    }
    return { ok: true, reply };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Handoff failed.' };
  } finally {
    rmSync(inboxDir, { recursive: true, force: true });
  }
}