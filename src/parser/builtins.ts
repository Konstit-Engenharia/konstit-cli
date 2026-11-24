import { statSync } from 'node:fs';
import {
  createEnumParser,
  createValueParser,
  jsonParser,
  mapParser,
  refineParser,
  type EnumCanonicalValues,
  type EnumDefinition,
  type EnumParserOptions,
  type KeyValuePair,
  type PathParserOptions,
  type RangeParserOptions,
  type ValueParser,
  type ValueParserOptions,
} from './core.js';
import {
  byteSizeUnits,
  durationUnits,
  finiteNumber,
  scaledInteger,
} from './numeric.js';

/** Built-in value parsers and factories for custom parsing rules. */
export const parsers = Object.freeze({
  /** Returns the raw argument text without conversion. */
  string: createValueParser('STRING', (input) => input),

  /** Parses a base-10 safe integer. */
  integer: createValueParser('INTEGER', (input) => {
    if (!/^[+-]?\d+$/.test(input)) {
      throw new Error('expected an integer');
    }
    const value = Number(input);
    if (!Number.isSafeInteger(value)) {
      throw new Error('integer is outside the safe range');
    }
    return value;
  }),

  /** Parses a finite JavaScript number. */
  float: createValueParser('NUMBER', finiteNumber),

  /** Parses a base-10 bigint. */
  bigint: createValueParser('INTEGER', (input) => {
    if (!/^[+-]?\d+$/.test(input)) {
      throw new Error('expected an integer');
    }
    return BigInt(input);
  }),

  /** Parses common true and false spellings. */
  boolean: createValueParser(
    'BOOLEAN',
    (input) => {
      switch (input.toLowerCase()) {
        case '1':
        case 'true':
        case 'yes':
        case 'on':
          return true;
        case '0':
        case 'false':
        case 'no':
        case 'off':
          return false;
        default:
          throw new Error('expected true or false');
      }
    },
    { completions: ['true', 'false'] },
  ),

  /** Parses a URL accepted by the JavaScript URL constructor. */
  url: createValueParser('URL', (input) => {
    try {
      return new URL(input);
    } catch {
      throw new Error('expected a valid URL');
    }
  }),

  /** Parses a file or directory path as supplied and provides a matching completion hint. */
  path(options: PathParserOptions): ValueParser<string> {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Path parser options must be an object');
    }
    const { kind, mustExist = false } = options;
    if (kind !== 'file' && kind !== 'directory') {
      throw new TypeError('Path parser option \'kind\' must be \'file\' or \'directory\'');
    }
    if (typeof mustExist !== 'boolean') {
      throw new TypeError('Path parser option \'mustExist\' must be a boolean');
    }
    return createValueParser(kind === 'file' ? 'FILE' : 'DIRECTORY', (input) => {
      if (input === '' || input.includes('\0')) {
        throw new Error('expected a non-empty path without null bytes');
      }
      const stats = statSync(input, { throwIfNoEntry: false });
      if (stats === undefined) {
        if (mustExist) {
          throw new Error(`expected an existing ${kind}`);
        }
      } else if (!(kind === 'file' ? stats.isFile() : stats.isDirectory())) {
        throw new Error(`expected a ${kind}`);
      }
      return input;
    }, { completionHint: kind });
  },

  /** Parses a date accepted by the JavaScript Date constructor. */
  date: createValueParser('DATE', (input) => {
    const value = new Date(input);
    if (Number.isNaN(value.getTime())) {
      throw new Error('expected a valid date');
    }
    return value;
  }),

  /** Parses a duration as an integer millisecond count. Unitless values are milliseconds. */
  duration: createValueParser('DURATION', (input) =>
    scaledInteger(
      input,
      durationUnits,
      'expected a duration such as 500, 500ms, 30s, 5m, 2h, or 1d',
    )),

  /** Parses an SI or IEC byte size as an integer byte count. Unitless values are bytes. */
  byteSize: createValueParser('BYTES', (input) =>
    scaledInteger(
      input,
      byteSizeUnits,
      'expected a byte size such as 512, 512B, 10KB, or 4MiB',
    )),

  /** Parses KEY=VALUE, splitting only at the first equals sign. */
  keyValue: createValueParser('KEY=VALUE', (input): KeyValuePair => {
    const separator = input.indexOf('=');
    if (separator < 1) {
      throw new Error('expected KEY=VALUE with a non-empty key');
    }
    return Object.freeze({
      key: input.slice(0, separator),
      value: input.slice(separator + 1),
    });
  }),

  /** Validates a schedulable five-field Bun cron expression or nickname. */
  cron: createValueParser('CRON', (input) => {
    let next: Date | null;
    try {
      next = Bun.cron.parse(input, 0, { tz: 'UTC' });
    } catch {
      throw new Error('expected a schedulable Bun cron expression');
    }
    if (next === null) {
      throw new Error('expected a schedulable Bun cron expression');
    }
    return input;
  }),

  /** Validates a CSS color accepted by Bun while preserving its source text. */
  color: createValueParser('COLOR', (input) => {
    if (Bun.color(input, 'css') === null) {
      throw new Error('expected a valid CSS color');
    }
    return input;
  }),

  /** Creates a parser that accepts one of the supplied enum values or descriptors. */
  enum<const Values extends readonly [EnumDefinition, ...EnumDefinition[]]>(
    values: Values,
    options: EnumParserOptions = {},
  ): ValueParser<EnumCanonicalValues<Values>> {
    return createEnumParser(values, options);
  },

  /** Creates a string parser that requires a regular-expression match. */
  regex(expression: RegExp): ValueParser<string> {
    if (!(expression instanceof RegExp)) {
      throw new TypeError('A regex parser requires a RegExp');
    }
    const source = expression.source;
    const flags = expression.flags;
    const label = expression.toString();
    return createValueParser(label, (input) => {
      if (!new RegExp(source, flags).test(input)) {
        throw new Error(`expected value matching ${label}`);
      }
      return input;
    });
  },

  /** Parses JSON and optionally checks its decoded shape with a type guard. */
  json: jsonParser,

  /** Maps a parsed value while preserving raw completion metadata by default. */
  map: mapParser,

  /** Refines a parsed value and filters static completions rejected by the predicate. */
  refine: refineParser,

  /** Creates a parser from a label and conversion callback. */
  custom<Value>(
    label: string,
    parse: (input: string) => Value,
    options: ValueParserOptions = {},
  ): ValueParser<Value> {
    return createValueParser(label, parse, options);
  },

  /** Creates a number parser limited to the inclusive range, optionally restricted to safe integers. */
  range(
    minimum: number,
    maximum: number,
    options: RangeParserOptions = {},
  ): ValueParser<number> {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Range parser options must be an object');
    }
    const { integer = false } = options;
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
      throw new RangeError('A parser range must have finite, ascending bounds');
    }
    if (typeof integer !== 'boolean') {
      throw new TypeError('Range parser option \'integer\' must be a boolean');
    }
    return createValueParser(`${minimum}..${maximum}`, (input) => {
      const value = integer ? parsers.integer.parse(input) : finiteNumber(input);
      if (value < minimum || value > maximum) {
        throw new Error(`expected ${integer ? 'an integer' : 'a number'} from ${minimum} to ${maximum}`);
      }
      return value;
    });
  },
});
