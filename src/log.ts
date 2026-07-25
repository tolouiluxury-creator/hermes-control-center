import pc from 'picocolors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = ORDER.info;

export function setLogLevel(level: LogLevel): void {
  threshold = ORDER[level];
}

function emit(level: LogLevel, tag: string, message: string): void {
  if (ORDER[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${tag} ${message}\n`);
}

export const log = {
  debug: (message: string): void => emit('debug', pc.dim('   ·'), pc.dim(message)),
  info: (message: string): void => emit('info', pc.cyan('  ›'), message),
  ok: (message: string): void => emit('info', pc.green('  ✓'), message),
  warn: (message: string): void => emit('warn', pc.yellow('  !'), pc.yellow(message)),
  error: (message: string): void => emit('error', pc.red('  ✗'), pc.red(message)),
  plain: (message = ''): void => emit('info', '', message),
  heading: (message: string): void => emit('info', '', pc.bold(message)),
};

/** Turns any thrown value into a readable single-line message. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    const causeText =
      cause instanceof Error
        ? ` (${cause.message})`
        : typeof cause === 'string'
          ? ` (${cause})`
          : '';
    return `${error.message}${causeText}`;
  }
  return String(error);
}
