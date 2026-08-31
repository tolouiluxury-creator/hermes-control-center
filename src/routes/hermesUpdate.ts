import type { FastifyInstance, FastifyReply } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { log } from '../log.js';

const execFileAsync = promisify(execFile);

/** Hermes-CLI-Pfad (siehe `which hermes`). */
const HERMES_BIN = '/usr/local/lib/hermes-agent/venv/bin/hermes';

export interface HermesUpdateState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  /** 'idle' | 'running' | 'uptodate' | 'installed' | 'failed' — für klare UI-Badges. */
  status: 'idle' | 'running' | 'uptodate' | 'installed' | 'failed';
  message: string;
  log: string;
}

let state: HermesUpdateState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  ok: null,
  status: 'idle',
  message: '',
  log: '',
};

export function getHermesUpdateState(): HermesUpdateState {
  return state;
}

/**
 * Führt `hermes update --yes` im Hintergrund aus. Der Updater aktualisiert den
 * Code, migriert die Config und synchronisiert Skills — der Gateway-Neustart
 * passiert vom Updater selbst gesteuert (drain-basiert); der Endpoint meldet
 * nur den Abschluss des Update-Vorgangs.
 */
export async function runHermesUpdate(reply: FastifyReply): Promise<void> {
  if (state.running) {
    return reply
      .code(409)
      .send({ error: 'update_running', message: 'An update is already running.' });
  }

  state = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ok: null,
    status: 'running',
    message: 'Hermes-Update läuft…',
    log: '',
  };
  reply.send({ ok: true, started: true });

  const append = (line: string) => {
    state.log += line + '\n';
    if (state.log.length > 80_000) state.log = state.log.slice(-80_000);
  };

  void (async () => {
    try {
      append('$ hermes update --yes');
      const { stdout, stderr } = await execFileAsync(HERMES_BIN, ['update', '--yes'], {
        timeout: 30 * 60_000,
        env: { ...process.env, HOME: process.env.HOME ?? '/root' },
        maxBuffer: 8 * 1024 * 1024,
      });
      if (stdout.trim()) append(stdout.trim());
      if (stderr.trim()) append(stderr.trim());

      // Wurde etwas geändert? Der Updater meldet "Update complete!" oder
      // "already up to date" — wir unterscheiden anhand der Ausgabe.
      const combined = `${stdout}\n${stderr}`.toLowerCase();
      if (combined.includes('up to date') || combined.includes('already up to date')) {
        state.status = 'uptodate';
        state.message = 'Bereits auf dem neuesten Stand. Keine Änderungen installiert.';
      } else if (combined.includes('update complete')) {
        state.status = 'installed';
        state.message = 'Update installiert. Gateway startet neu (kurze Unterbrechung).';
      } else {
        state.status = 'installed';
        state.message = 'Update abgeschlossen.';
      }
      state.ok = true;
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      if (e.stdout?.trim()) append(e.stdout.trim());
      if (e.stderr?.trim()) append(e.stderr.trim());
      append(`ERROR: ${e.message ?? String(error)}`);
      state.status = 'failed';
      state.message = 'Update fehlgeschlagen. Details siehe Log.';
      state.ok = false;
      log.warn(`Hermes update failed: ${String(error)}`);
    } finally {
      state.finishedAt = new Date().toISOString();
      state.running = false;
    }
  })();
}

export async function registerHermesUpdateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/hermes-update', async () => ({ state: getHermesUpdateState() }));
  app.post('/api/hermes-update', async (request, reply) => {
    await runHermesUpdate(reply);
  });
}
