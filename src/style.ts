/* oxlint-disable no-control-regex -- Terminal formatting validates control characters in escape sequences. */
import { constants } from 'node:fs';
import {
  lstat,
  stat,
} from 'node:fs/promises';
import { wrapAnsi } from './ansi.js';
import type {
  AnsiColorFormat,
  OutputColor,
} from './command/color.js';
import type { OutputChannel } from './command/output.js';
import {
  fileSequence,
  parseLsColors,
  type LsColors,
} from './ls-colors.js';

/** CSS colors and text attributes rendered for one output stream. */
export interface StyleOptions {
  /** The output stream whose color settings apply. Defaults to stdout. */
  readonly stream?: 'stdout' | 'stderr';
  /** The foreground CSS color. */
  readonly color?: string;
  /** The background CSS color. */
  readonly background?: string;
  /** Renders the text in bold. */
  readonly bold?: boolean;
  /** Renders the text at reduced intensity. */
  readonly dim?: boolean;
  /** Renders the text in italics. */
  readonly italic?: boolean;
  /** Underlines the text. */
  readonly underline?: boolean;
  /** Swaps the foreground and background colors. */
  readonly inverse?: boolean;
}

/** Display options for a terminal hyperlink. */
export interface LinkStyleOptions {
  /** The output stream whose styling settings apply. Defaults to stdout. */
  readonly stream?: 'stdout' | 'stderr';
  /** The visible text. Defaults to the URL. */
  readonly label?: string;
}

/** The numeric filesystem metadata used by LS_COLORS classification. */
export interface FileStat {
  /** The file type and permission bits from stat or lstat. */
  readonly mode: number;
  /** The hard link count, used to distinguish files with multiple links. */
  readonly nlink?: number;
}

/** Options for choosing how a path is displayed and styled. */
export interface PathStyleOptions {
  /** The output stream whose color settings apply. Defaults to stdout. */
  readonly stream?: 'stdout' | 'stderr';
  /** Displayed text. Matching always uses the original path's basename. */
  readonly label?: string;
}

/** Path styling options for callers that supply filesystem metadata. */
export interface FileStyleOptions extends PathStyleOptions {
  /** lstat metadata, null for a missing path, or omitted for suffix-only matching. */
  readonly stats?: FileStat | null;
  /** stat metadata for a symlink target, null for a broken link, or omitted when unknown. */
  readonly targetStats?: FileStat | null;
}

/** Formatting bound to the current runner's color policies and LS_COLORS snapshot. */
export interface Style {
  /** Applies CSS colors and text attributes when styling is enabled for the selected stream. */
  (text: string, options: StyleOptions): string;
  /** Formats an absolute URL as a terminal hyperlink. Returns the visible text when styling is disabled. */
  link(url: string | URL, options?: LinkStyleOptions): string;
  /** Formats a filename using supplied metadata without filesystem access. */
  file(path: string, options?: FileStyleOptions): string;
  /** Inspects a path asynchronously when filename styling is enabled. */
  path(path: string, options?: PathStyleOptions): Promise<string>;
}

function cssColor(input: string, format: AnsiColorFormat, background: boolean): string {
  const sequence = typeof input === 'string' ? Bun.color(input, format) : null;
  if (sequence === null) {
    throw new TypeError(`Invalid CSS color: ${JSON.stringify(input)}`);
  }
  if (background) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Bun returns an ANSI foreground SGR sequence.
    return sequence.replace(/^\x1b\[(\d+)/, (_match, code: string) => `\x1b[${Number(code) + 10}`);
  }
  return sequence;
}

export function styleText(text: string, options: StyleOptions, output: OutputColor): string {
  let opening = '';
  if (options.color !== undefined) {
    opening += cssColor(options.color, output.format, false);
  }
  if (options.background !== undefined) {
    opening += cssColor(options.background, output.format, true);
  }
  if (options.bold) {
    opening += '\x1b[1m';
  }
  if (options.dim) {
    opening += '\x1b[2m';
  }
  if (options.italic) {
    opening += '\x1b[3m';
  }
  if (options.underline) {
    opening += '\x1b[4m';
  }
  if (options.inverse) {
    opening += '\x1b[7m';
  }
  return output.enabled ? wrapAnsi(text, opening) : text;
}

type PathInspection =
  | { readonly kind: 'present'; readonly stats: FileStat; }
  | { readonly kind: 'missing'; };

async function inspectPath(path: string, follow: boolean): Promise<PathInspection> {
  try {
    return { kind: 'present', stats: await (follow ? stat(path) : lstat(path)) };
  } catch (error) {
    if (
      typeof error === 'object' && error !== null && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || (follow && error.code === 'ELOOP'))
    ) {
      return { kind: 'missing' };
    }
    throw error;
  }
}

export function createStyle(colors: Readonly<Record<OutputChannel, OutputColor>>, lsColors: string | false | undefined): Style {
  let rules: LsColors | undefined;
  const getRules = (): LsColors => rules ??= parseLsColors(lsColors || '');

  const link = (url: string | URL, options: LinkStyleOptions = {}): string => {
    const address = typeof url === 'string' ? url : url.href;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Control characters can terminate an OSC sequence.
    if (/[\x00-\x1f\x7f-\x9f]/u.test(address)) {
      throw new TypeError('Link URL contains control characters');
    }
    // OSC 8 carries a URI encoded as printable ASCII.
    const target = new URL(address).href.replace(/[^!-~]/gu, encodeURIComponent);
    const label = options.label ?? address;
    return colors[options.stream ?? 'stdout'].enabled && label !== ''
      ? `\x1b]8;;${target}\x1b\\${label}\x1b]8;;\x1b\\`
      : label;
  };

  const file = (path: string, options: FileStyleOptions = {}): string => {
    const label = options.label ?? path;
    if (!colors[options.stream ?? 'stdout'].enabled) {
      return label;
    }
    const rules = getRules();
    if (!rules.active) {
      return label;
    }
    const sequence = fileSequence(path, options, rules);
    return sequence === undefined || sequence === '' || sequence === '0' || sequence === '00'
      ? label
      : wrapAnsi(label, `\x1b[${sequence}m`);
  };

  const path = async (path: string, options: PathStyleOptions = {}): Promise<string> => {
    if (!colors[options.stream ?? 'stdout'].enabled) {
      return options.label ?? path;
    }
    const rules = getRules();
    if (!rules.active) {
      return options.label ?? path;
    }
    const inspection = await inspectPath(path, false);
    const targetInspection: PathInspection | undefined = inspection.kind === 'present'
        && (inspection.stats.mode & constants.S_IFMT) === constants.S_IFLNK
        && rules.inspectSymlinks
      ? await inspectPath(path, true)
      : undefined;
    return file(path, {
      ...options,
      stats: inspection.kind === 'present' ? inspection.stats : null,
      ...(targetInspection === undefined
        ? {}
        : { targetStats: targetInspection.kind === 'present' ? targetInspection.stats : null }),
    });
  };

  return Object.freeze(Object.assign(
    (text: string, options: StyleOptions): string => styleText(text, options, colors[options.stream ?? 'stdout']),
    { link, file, path },
  ));
}
