import { writeSync } from 'node:fs';
import { styleText } from '../style.js';
import type { OutputColor } from './color.js';
import type { OutputChannel } from './output.js';

/** A synchronous sink whose return value is ignored. Promise-returning sinks are incompatible. */
// biome-ignore lint/suspicious/noConfusingVoidType: The union rejects async callbacks while accepting void callbacks and byte counts.
export type SyncOutputWriter = (chunk: string) => void | number;

/** Synchronous destinations for handler console output. */
export interface ConsoleWriters {
  readonly stdout?: SyncOutputWriter;
  readonly stderr?: SyncOutputWriter;
}

/** Console destinations and filename formatting settings for one execution. */
export interface ConsoleOptions {
  /** Synchronous sinks used exclusively by handler console methods. */
  readonly console?: ConsoleWriters;
  /** Overrides LS_COLORS. False disables filename styling. Defaults to the environment. */
  readonly lsColors?: string | false;
}

/** Synchronous line-oriented output. Each call appends a newline and can throw a write error. */
export interface HandlerConsole {
  log(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
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
  colors: Readonly<Record<OutputChannel, OutputColor>>,
): HandlerConsole {
  const stdout = writers.stdout;
  const stderr = writers.stderr;
  const line = (message: string, channel: OutputChannel, color: string): void => {
    const text = styleText(message, { color }, colors[channel]);
    writeConsole(channel, `${text}\n`, channel === 'stdout' ? stdout : stderr);
  };
  return Object.freeze({
    log: (message: string) => writeConsole('stdout', `${message}\n`, stdout),
    info: (message: string) => line(message, 'stdout', '#0891b2'),
    success: (message: string) => line(message, 'stdout', '#16a34a'),
    warn: (message: string) => line(message, 'stderr', '#d97706'),
    error: (message: string) => line(message, 'stderr', '#dc2626'),
  });
}
