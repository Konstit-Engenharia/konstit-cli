import { constants } from 'node:fs';
import { basename } from 'node:path';
import { isSgrSequence } from './ansi.js';
import type {
  FileStat,
  FileStyleOptions,
} from './style.js';

interface SuffixRule {
  readonly suffix: string;
  readonly folded: string;
  readonly sequence: string;
  caseSensitive: boolean;
  shadowed: boolean;
}

export interface LsColors {
  readonly indicators: ReadonlyMap<string, string>;
  readonly suffixes: readonly SuffixRule[];
  readonly active: boolean;
  readonly followSymlinks: boolean;
  readonly inspectSymlinks: boolean;
}

const indicatorNames = new Set(['no', 'fi', 'di', 'ln', 'pi', 'so', 'bd', 'cd', 'or', 'mi', 'ex', 'su', 'sg', 'st', 'ow', 'tw', 'mh']);
const escapes: Readonly<Record<string, string>> = {
  'a': '\x07',
  'b': '\b',
  'e': '\x1b',
  'f': '\f',
  'n': '\n',
  'r': '\r',
  't': '\t',
  'v': '\v',
  '_': ' ',
  '?': '\x7f',
};

function splitEscaped(input: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === '\\') {
      index += 1;
    } else if (input[index] === separator) {
      parts.push(input.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function decodeToken(input: string): string {
  return input.replace(/\\(x[0-9a-fA-F]{1,2}|[0-7]{1,3}|[\s\S])|\^([@-~?])/g, (
    _match: string,
    escaped: string | undefined,
    control: string | undefined,
  ) => {
    if (control !== undefined) {
      return String.fromCharCode(control === '?' ? 127 : control.charCodeAt(0) & 31);
    }
    const value = escaped as string;
    if (value.startsWith('x') && value.length > 1) {
      return String.fromCharCode(Number.parseInt(value.slice(1), 16));
    }
    if (/^[0-7]+$/.test(value)) {
      return String.fromCharCode(Number.parseInt(value, 8) & 255);
    }
    return escapes[value] ?? value;
  });
}

function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function isColored(sequence: string | undefined): boolean {
  return sequence !== undefined && sequence !== '' && sequence !== '0' && sequence !== '00';
}

function prioritizeSuffixes(suffixes: SuffixRule[]): readonly SuffixRule[] {
  suffixes.reverse();
  for (const [index, current,] of suffixes.entries()) {
    if (current.shadowed) {
      continue;
    }
    let mergedCase = false;
    for (const older of suffixes.slice(index + 1)) {
      if (older.shadowed || older.folded !== current.folded) {
        continue;
      }
      if (older.suffix === current.suffix) {
        older.shadowed = true;
      } else if (mergedCase || older.sequence === current.sequence) {
        older.shadowed = true;
        mergedCase = true;
      } else {
        current.caseSensitive = true;
        older.caseSensitive = true;
      }
    }
  }
  return suffixes.filter((rule) => !rule.shadowed);
}

/** Parses the common SGR-based LS_COLORS rules, retaining order and terminal palette indices. */
export function parseLsColors(input: string): LsColors {
  const indicators = new Map<string, string>();
  const suffixes: SuffixRule[] = [];
  for (const entry of splitEscaped(input, ':')) {
    const fields = splitEscaped(entry, '=');
    if (fields.length !== 2) {
      continue;
    }
    const name = decodeToken(fields[0] as string);
    const sequence = decodeToken(fields[1] as string);
    if (name === 'ln' && sequence === 'target') {
      indicators.set(name, sequence);
    } else if (isSgrSequence(sequence)) {
      if (name.startsWith('*')) {
        const suffix = name.slice(1);
        suffixes.push({ suffix, folded: foldAscii(suffix), sequence, caseSensitive: false, shadowed: false });
      } else if (indicatorNames.has(name)) {
        indicators.set(name, sequence);
      }
    }
  }
  const orderedSuffixes = prioritizeSuffixes(suffixes);
  const followSymlinks = indicators.get('ln') === 'target';
  return {
    indicators,
    suffixes: orderedSuffixes,
    active: [...indicators.values(), ...orderedSuffixes.map(({ sequence }) => sequence)]
      .some((sequence) => sequence !== 'target' && isColored(sequence)),
    followSymlinks,
    inspectSymlinks: followSymlinks || isColored(indicators.get('or')),
  };
}

function fileIndicator(stats: FileStat, rules: LsColors): string {
  const mode = stats.mode;
  const active = (name: string): boolean => isColored(rules.indicators.get(name));
  switch (mode & constants.S_IFMT) {
    case constants.S_IFREG:
      if ((mode & 0o4000) !== 0 && active('su')) {
        return 'su';
      }
      if ((mode & 0o2000) !== 0 && active('sg')) {
        return 'sg';
      }
      if ((mode & 0o111) !== 0 && active('ex')) {
        return 'ex';
      }
      if ((stats.nlink ?? 1) > 1 && active('mh')) {
        return 'mh';
      }
      return 'fi';
    case constants.S_IFDIR:
      if ((mode & 0o1002) === 0o1002 && active('tw')) {
        return 'tw';
      }
      if ((mode & 0o002) !== 0 && active('ow')) {
        return 'ow';
      }
      if ((mode & 0o1000) !== 0 && active('st')) {
        return 'st';
      }
      return 'di';
    case constants.S_IFLNK:
      return 'ln';
    case constants.S_IFIFO:
      return 'pi';
    case constants.S_IFSOCK:
      return 'so';
    case constants.S_IFBLK:
      return 'bd';
    case constants.S_IFCHR:
      return 'cd';
    default:
      return 'or';
  }
}

export function fileSequence(path: string, options: FileStyleOptions, rules: LsColors): string | undefined {
  let stats = options.stats;
  if (stats === null) {
    return rules.indicators.get('mi') ?? rules.indicators.get('or') ?? rules.indicators.get('no');
  }
  if (stats !== undefined && (stats.mode & constants.S_IFMT) === constants.S_IFLNK) {
    if (options.targetStats === null && (rules.followSymlinks || isColored(rules.indicators.get('or')))) {
      return rules.indicators.get('or') ?? rules.indicators.get('no');
    }
    if (rules.followSymlinks && options.targetStats != null) {
      // GNU ln=target uses the target mode but the symlink's own hard-link count.
      stats = { ...stats, mode: options.targetStats.mode };
    } else if (rules.followSymlinks) {
      return rules.indicators.get('no');
    }
  }
  const indicator = stats === undefined ? 'fi' : fileIndicator(stats, rules);
  if (indicator === 'fi') {
    const name = basename(path);
    const folded = foldAscii(name);
    const suffix = rules.suffixes.find((rule) => rule.caseSensitive ? name.endsWith(rule.suffix) : folded.endsWith(rule.folded));
    if (suffix !== undefined) {
      return suffix.sequence;
    }
  }
  return rules.indicators.get(indicator) ?? rules.indicators.get('no');
}
