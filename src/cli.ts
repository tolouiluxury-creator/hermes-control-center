#!/usr/bin/env node
import pc from 'picocolors';
import { HELP_TEXT, OptionsError, parseOptions, type CliOptions } from './options.js';
import { buildServer } from './server.js';
import { createContext } from './context.js';
import {
  initControlCenterConfig,
  loadControlCenterConfig,
  updateControlCenterConfig,
} from './config.js';
import { hashPassword, validatePasswordStrength } from './auth/password.js';
import { generateSessionSecret } from './auth/session.js';
import { assertBindIsSafe } from './auth/service.js';
import { readSecret } from './util/prompt.js';
import { Poller, defaultPollTasks } from './poller.js';
import { runDoctor } from './doctor.js';
import { findFreePort } from './util/port.js';
import { describeError, log, setLogLevel } from './log.js';
import { pkg } from './util/pkg.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function printBanner(url: string, options: CliOptions): void {
  log.plain();
  log.plain(`  ${pc.bold(pc.cyan('Hermes Control Center'))} ${pc.dim(`v${pkg.version}`)}`);
  log.plain();
  log.plain(`  ${pc.dim('Local')}    ${pc.green(url)}`);
  if (options.profile) log.plain(`  ${pc.dim('Profile')}  ${options.profile}`);
  log.plain(`  ${pc.dim('Stop')}     Ctrl+C`);
  log.plain();
}

async function setPassword(): Promise<number> {
  const password = await readSecret('  New password: ');
  const problem = validatePasswordStrength(password);
  if (problem) {
    log.error(problem);
    return 2;
  }

  // Only ask twice interactively; a piped password cannot be mistyped twice.
  if (process.stdin.isTTY) {
    const again = await readSecret('  Repeat password: ');
    if (again !== password) {
      log.error('The two passwords do not match. Nothing was changed.');
      return 2;
    }
  }

  const existing = loadControlCenterConfig().config.auth;
  const path = updateControlCenterConfig({
    auth: {
      passwordHash: hashPassword(password),
      // Keep the existing secret so a password change does not log out other
      // devices unexpectedly; generate one on first setup.
      sessionSecret: existing?.sessionSecret ?? generateSessionSecret(),
    },
  });

  log.plain();
  log.ok(`Password set. Stored as a scrypt hash in ${path}`);
  log.plain(`     ${pc.dim('The control center will now ask for it before showing any data.')}`);
  log.plain();
  return 0;
}

async function serve(options: CliOptions): Promise<number> {
  const ctx = createContext(options);

  // A control center that can restart the gateway and write env vars must never
  // be reachable from outside without a password.
  assertBindIsSafe(options.host, ctx.auth.required, ctx.connection.configPath);

  if (!LOOPBACK_HOSTS.has(options.host)) {
    log.warn(
      `Listening on ${options.host}: reachable beyond this machine. ` +
        'Password protection is active; prefer an authenticating reverse proxy in front as well.',
    );
  }
  if (!ctx.auth.required) {
    log.info(
      'No password set — fine on localhost. Run --set-password before exposing this to a network.',
    );
  }

  const port = await findFreePort(options.port, options.host);
  if (port !== options.port) {
    log.info(`Port ${options.port} is in use, using ${port} instead.`);
  }

  const poller = new Poller(ctx, defaultPollTasks());

  const app = await buildServer(ctx);
  await app.listen({ port, host: options.host });
  poller.start();

  const displayHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host;
  const url = `http://${displayHost.includes(':') ? `[${displayHost}]` : displayHost}:${port}`;
  printBanner(url, options);

  if (options.open) {
    try {
      const { default: open } = await import('open');
      await open(url);
    } catch (error) {
      log.debug(`Could not open a browser: ${describeError(error)}`);
    }
  }

  const shutdown = async (signal: string): Promise<void> => {
    log.plain();
    log.info(`Received ${signal}, shutting down.`);
    try {
      poller.stop();
      await app.close();
      ctx.close();
    } catch (error) {
      log.error(`Shutdown failed: ${describeError(error)}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return 0;
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseOptions(process.argv.slice(2));
  } catch (error) {
    if (error instanceof OptionsError) {
      log.error(error.message);
      log.plain(`Run ${pc.cyan('hermes-control-center --help')} for usage.`);
      process.exit(2);
    }
    throw error;
  }

  setLogLevel(options.logLevel);

  switch (options.mode) {
    case 'help':
      process.stdout.write(HELP_TEXT);
      return;
    case 'version':
      process.stdout.write(`${pkg.version}\n`);
      return;
    case 'init-config': {
      const { path, created } = initControlCenterConfig();
      log.plain();
      if (created) {
        log.ok(`Created ${path}`);
        log.plain(
          `     ${pc.dim('Put your API_SERVER_KEY in there as "apiKey", then run --doctor.')}`,
        );
      } else {
        log.info(`${path} already exists — leaving it untouched.`);
      }
      log.plain();
      return;
    }
    case 'set-password':
      process.exitCode = await setPassword();
      return;
    case 'doctor':
      process.exitCode = await runDoctor(options);
      return;
    case 'serve':
      process.exitCode = await serve(options);
      return;
  }
}

main().catch((error: unknown) => {
  log.error(describeError(error));
  process.exit(1);
});
