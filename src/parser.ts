/** Converts one command-line token to a typed value. */
export interface ValueParser<out Value> {
  readonly label: string;
  /** Static values offered by generated shell completions. */
  readonly completions?: readonly string[];
  /** A fallback used by generated shell completions. */
  readonly completionHint?: CompletionValueHint;
  /** Converts one raw argument value or throws when the value is invalid. */
  parse(input: string): Value;
}

export type CompletionValueHint = 'file' | 'directory';

export interface ValueParserOptions {
  readonly completions?: readonly string[];
  readonly completionHint?: CompletionValueHint;
}

/** Settings accepted by parsers.range(). */
export interface RangeParserOptions {
  /** Accepts only base-10 safe integers, like parsers.integer. Defaults to false. */
  readonly integer?: boolean;
}

/** A key and value separated by the first equals sign in an argument. */
export interface KeyValuePair {
  readonly key: string;
  readonly value: string;
}

/** Creates an immutable parser for the public parsers namespace. */
function createValueParser<Value>(
  label: string,
  parse: (input: string) => Value,
  options: ValueParserOptions = {},
): ValueParser<Value> {
  return Object.freeze({
    label,
    parse,
    ...(options.completions === undefined
      ? {}
      : { completions: Object.freeze([...options.completions]) }),
    ...(options.completionHint === undefined
      ? {}
      : { completionHint: options.completionHint }),
  });
}

function finiteNumber(input: string): number {
  if (input.trim() === '') {
    throw new Error('expected a number');
  }
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new Error('expected a finite number');
  }
  return value;
}

function scaledInteger(
  input: string,
  units: Readonly<Record<string, number>>,
  errorMessage: string,
): number {
  const match = /^(\d+)(?:\.(\d+))?([A-Za-z]+)$/.exec(input);
  if (match === null) {
    throw new Error(errorMessage);
  }

  const [, whole = '0', fraction, unit = '',] = match;
  const multiplier = units[unit];
  if (multiplier === undefined) {
    throw new Error(errorMessage);
  }

  const multiplierValue = BigInt(multiplier);
  let value = BigInt(whole) * multiplierValue;
  if (fraction !== undefined) {
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(fraction) * multiplierValue;
    if (numerator % denominator !== 0n) {
      throw new Error(errorMessage);
    }
    value += numerator / denominator;
  }

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(errorMessage);
  }
  return Number(value);
}

const durationUnits = Object.freeze({
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
});

const byteSizeUnits = Object.freeze({
  B: 1,
  KB: 1_000,
  MB: 1_000_000,
  GB: 1_000_000_000,
  TB: 1_000_000_000_000,
  KiB: 1_024,
  MiB: 1_048_576,
  GiB: 1_073_741_824,
  TiB: 1_099_511_627_776,
});

function jsonParser(): ValueParser<unknown>;
function jsonParser<Value>(
  guard: (value: unknown) => value is Value,
): ValueParser<Value>;
function jsonParser<Value>(
  guard?: (value: unknown) => value is Value,
): ValueParser<unknown> {
  return createValueParser('JSON', (input) => {
    let value: unknown;
    try {
      value = JSON.parse(input);
    } catch {
      throw new Error('expected valid JSON');
    }
    if (guard !== undefined && !guard(value)) {
      throw new Error('JSON value has an invalid shape');
    }
    return value;
  });
}

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

  /** Parses a date accepted by the JavaScript Date constructor. */
  date: createValueParser('DATE', (input) => {
    const value = new Date(input);
    if (Number.isNaN(value.getTime())) {
      throw new Error('expected a valid date');
    }
    return value;
  }),

  /** Parses a duration and returns its integer millisecond count. */
  duration: createValueParser('DURATION', (input) =>
    scaledInteger(
      input,
      durationUnits,
      'expected a duration such as 500ms, 30s, 5m, 2h, or 1d',
    )),

  /** Parses an SI or IEC byte size and returns its integer byte count. */
  byteSize: createValueParser('BYTES', (input) =>
    scaledInteger(
      input,
      byteSizeUnits,
      'expected a byte size such as 512B, 10KB, or 4MiB',
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

  /** Creates a parser that accepts one of the supplied string values. */
  enum<const Values extends readonly [string, ...string[]]>(
    values: Values,
  ): ValueParser<Values[number]> {
    const allowed = new Set<string>(values);
    return createValueParser(
      values.join('|'),
      (input): Values[number] => {
        if (!allowed.has(input)) {
          throw new Error(`expected one of: ${values.join(', ')}`);
        }
        return input as Values[number];
      },
      { completions: values },
    );
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
    { integer = false }: RangeParserOptions = {},
  ): ValueParser<number> {
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
