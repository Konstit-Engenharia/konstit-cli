import { writeSync } from 'node:fs';
import { format } from 'node:util';
import type { OutputColor } from './color.js';
import type { OutputChannel } from './output.js';
import { styleText } from './style.js';

/** A synchronous sink whose return value is ignored. Promise-returning sinks are incompatible. */
// biome-ignore lint/suspicious/noConfusingVoidType: The union rejects async callbacks while accepting void callbacks and byte counts.
export type SyncOutputWriter = (chunk: string) => void | number;

/** Synchronous destinations for `HandlerContext.output`. */
export interface ConsoleWriters {
  /** Receives complete lines written by log, debug, and info. Defaults to standard output. */
  readonly stdout?: SyncOutputWriter;
  /** Receives complete lines written by warn and error. Defaults to standard error. */
  readonly stderr?: SyncOutputWriter;
}

/** Console destinations and filename formatting settings for one execution. */
export interface ConsoleOptions {
  /** Synchronous sinks for `HandlerContext.output` methods. */
  readonly output?: ConsoleWriters;
  /** Overrides LS_COLORS. False disables filename styling. Defaults to the environment. */
  readonly lsColors?: string | false;
}

/** Synchronous line-oriented output. Each call formats its arguments, appends a newline, and can throw a write error. */
export interface HandlerConsole {
  /** Writes an unstyled line to standard output. */
  log(...data: unknown[]): void;
  /** Writes an unstyled debug line to standard output. */
  debug(...data: unknown[]): void;
  /** Writes an unstyled informational line to standard output. */
  info(...data: unknown[]): void;
  /** Writes an unstyled warning line to standard error. */
  warn(...data: unknown[]): void;
  /** Writes an error line to standard error, using red when styling is enabled. */
  error(...data: unknown[]): void;
}

function writeConsole(channel: OutputChannel, text: string, writer: SyncOutputWriter | undefined): void {
  if (writer !== undefined) {
    writer(text);
    return;
  }
  const bytes = Buffer.from(text);
  const descriptor = channel === 'stdout' ? 1 : 2;
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written === 0) {
      throw new Error(`Console ${channel} write made no progress`);
    }
    offset += written;
  }
}

export function createConsole(
  writers: ConsoleWriters = {},
  stderrColor: OutputColor,
): HandlerConsole {
  const stdout = writers.stdout;
  const stderr = writers.stderr;
  const log = (...data: unknown[]): void => writeConsole('stdout', `${format(...data)}\n`, stdout);
  return Object.freeze({
    log,
    debug: log,
    info: log,
    warn: (...data: unknown[]) => writeConsole('stderr', `${format(...data)}\n`, stderr),
    error: (...data: unknown[]) => {
      const text = styleText(format(...data), { color: '#dc2626' }, stderrColor);
      writeConsole('stderr', `${text}\n`, stderr);
    },
  });
}
