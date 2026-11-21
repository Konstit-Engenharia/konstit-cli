import type { RunOptions } from '../command.js';
import type {
  OutputChannel,
  OutputWriter,
} from './output.js';
import type { ColorMode } from './parse.js';

export type AnsiColorFormat = 'ansi-16' | 'ansi-256' | 'ansi-16m';

export interface OutputColor {
  readonly enabled: boolean;
  readonly format: AnsiColorFormat;
}

/** Resolves color for the actual destination, including independently captured streams. */
export function resolveOutputColor(
  channel: OutputChannel,
  mode: ColorMode | undefined,
  color: boolean | undefined,
  writer: OutputWriter | undefined,
): OutputColor {
  if (Bun.env.NO_COLOR !== undefined || mode === 'never') {
    return { enabled: false, format: 'ansi-16' };
  }
  const requested = mode === 'always' ? true : color;
  if (requested !== undefined) {
    return { enabled: requested, format: 'ansi-16m' };
  }
  const stream = process[channel];
  const enabled = writer === undefined && stream.isTTY === true && Bun.env.TERM !== 'dumb';
  const depth = enabled ? stream.getColorDepth?.() ?? 4 : 4;
  return {
    enabled,
    format: depth >= 24 ? 'ansi-16m' : depth >= 8 ? 'ansi-256' : 'ansi-16',
  };
}

/** The parsed color flag uses stdout capability independently of output capture. */
export function handlerColorEnabled(options: RunOptions = {}): boolean {
  return resolveOutputColor('stdout', undefined, options.color, undefined).enabled;
}
