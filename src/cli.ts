#!/usr/bin/env node
import pc from 'picocolors';
import { HELP_TEXT, OptionsError, parseOptions, type CliOptions } from './options.js';
import { buildServer } from './server.js';
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

async function serve(options: CliOptions): Promise<number> {
  if (!LOOPBACK_HOSTS.has(options.host)) {
    log.warn(
      `Binding to ${options.host} exposes the control center beyond this machine. ` +
        'Only do this on a trusted network or behind a reverse proxy with authentication.',
    );
  }

  const port = await findFreePort(options.port, options.host);
  if (port !== options.port) {
    log.info(`Port ${options.port} is in use, using ${port} instead.`);
  }

  const app = await buildServer({ ...options, port });
  await app.listen({ port, host: options.host });

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
      await app.close();
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
