import type { FastifyInstance, FastifyReply } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../log.js';

const execFileAsync = promisify(execFile);

/** Der Server-Autoroot (dort liegt das Git-Repo). */
const REPO_DIR = resolve(import.meta.dirname ?? '.', '../..');

/** systemd-Dienstname — sofern vorhanden, wird danach neu gestartet. */
const SYSTEMD_SERVICE = 'hermes-control-center.service';
const GIT_REMOTE = 'origin';
const GIT_BRANCH = 'main';

/** Versionen, die die UI vor dem Update braucht. */
export interface UpdateState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  /** 'idle' | 'running' | 'uptodate' | 'installed' | 'failed' — für klare UI-Badges. */
  status: 'idle' | 'running' | 'uptodate' | 'installed' | 'failed';
  message: string;
  log: string;
}

let state: UpdateState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  ok: null,
  status: 'idle',
  message: '',
  log: '',
};

export function getSelfUpdateState(): UpdateState {
  return state;
}

/**
 * Führt das Update in einem Hintergrundprozess aus: git pull, npm ci, build.
 * Der systemd-Dienst wird via `systemctl restart` danach neu gestartet; der
 * Restart muss mit Verzögerung passieren, weil die Antwort erst raus muss.
 */
export async function runSelfUpdate(reply: FastifyReply): Promise<void> {
  if (state.running) {
    return reply.code(409).send({ error: 'update_running', message: 'An update is already running.' });
  }

  state = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    status: 'running',
    message: 'Update läuft…',
    log: '',
  };
  reply.send({ ok: true, started: true });

  const append = (line: string) => {
    state.log += line + '\n';
    if (state.log.length > 50_000) state.log = state.log.slice(-50_000);
  };

  const run = async (cmd: string, args: string[], timeoutMs = 300_000): Promise<void> => {
    append(`$ ${cmd} ${args.join(' ')}`);
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: REPO_DIR,
        timeout: timeoutMs,
        env: { ...process.env, HOME: process.env.HOME ?? '/root' },
        maxBuffer: 4 * 1024 * 1024,
      });
      if (stdout.trim()) append(stdout.trim());
      if (stderr.trim()) append(stderr.trim());
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      if (e.stdout?.trim()) append(e.stdout.trim());
      if (e.stderr?.trim()) append(e.stderr.trim());
      append(`ERROR: ${e.message ?? String(error)}`);
      throw error;
    }
  };

  void (async () => {
    try {
      await run('git', ['fetch', GIT_REMOTE, GIT_BRANCH]);
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR });
      const current = stdout.trim();
      const { stdout: remoteOut } = await execFileAsync('git', ['rev-parse', `${GIT_REMOTE}/${GIT_BRANCH}`], {
        cwd: REPO_DIR,
      });
      const remote = remoteOut.trim();
      if (current === remote && !state.log.includes('ERROR')) {
        append('Already up to date. No changes to install.');
        state.ok = true;
        state.finishedAt = new Date().toISOString();
        state.running = false;
        state.status = 'uptodate';
        state.message = 'Bereits auf dem neuesten Stand. Keine Änderungen installiert.';
        return;
      }
      await run('git', ['pull', '--ff-only', GIT_REMOTE, GIT_BRANCH]);
      if (existsSync(resolve(REPO_DIR, 'package-lock.json'))) {
        await run('npm', ['ci']);
      } else {
        await run('npm', ['install']);
      }
      await run('npm', ['run', 'build']);
      append('Update installed. Restarting service…');
      state.ok = true;
      state.finishedAt = new Date().toISOString();
      state.running = false;
      state.status = 'installed';
      state.message = 'Update installiert. Dienst wird neu gestartet…';
      // Neustart mit Verzögerung, damit der HTTP-Response zuerst raus ist.
      setTimeout(() => {
        execFile('systemctl', ['restart', SYSTEMD_SERVICE], { timeout: 30_000 }, (error) => {
          if (error) log.warn(`Self-update restart failed: ${error.message}`);
        });
      }, 1_500);
    } catch (error) {
      append(`UPDATE FAILED: ${error instanceof Error ? error.message : String(error)}`);
      state.ok = false;
      state.finishedAt = new Date().toISOString();
      state.running = false;
      state.status = 'failed';
      state.message = 'Update fehlgeschlagen. Details siehe Log.';
      log.warn(`Self-update failed: ${String(error)}`);
    }
  })();
}

export async function registerSelfUpdateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/self-update', async () => ({ state: getSelfUpdateState() }));
  app.post('/api/self-update', async (request, reply) => {
    await runSelfUpdate(reply);
  });
}