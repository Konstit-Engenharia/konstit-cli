/** Converts one command-line token to a typed value. */
export interface ValueParser<out Value> {
  readonly label: string;
  /** Static values offered by generated shell completions. */
  readonly completions?: readonly string[];
  /** A fallback used by generated shell completions. */
  readonly completionHint?: CompletionValueHint;
  parse(input: string): Value;
}

export type CompletionValueHint = 'file' | 'directory';

export interface ValueParserOptions {
  readonly completions?: readonly string[];
  readonly completionHint?: CompletionValueHint;
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

function jsonParser(): ValueParser<unknown>;
function jsonParser<Value>(
  guard: (value: unknown) => value is Value,
): ValueParser<Value>;
function jsonParser<Value>(
  guard?: (value: unknown) => value is Value,
): ValueParser<Value | unknown> {
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

export const parsers = Object.freeze({
  string: createValueParser('STRING', (input) => input),

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

  float: createValueParser('NUMBER', finiteNumber),

  bigint: createValueParser('INTEGER', (input) => {
    try {
      return BigInt(input);
    } catch {
      throw new Error('expected an integer');
    }
  }),

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

  url: createValueParser('URL', (input) => {
    try {
      return new URL(input);
    } catch {
      throw new Error('expected a valid URL');
    }
  }),

  date: createValueParser('DATE', (input) => {
    const value = new Date(input);
    if (Number.isNaN(value.getTime())) {
      throw new Error('expected a valid date');
    }
    return value;
  }),

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

  json: jsonParser,

  custom<Value>(
    label: string,
    parse: (input: string) => Value,
    options: ValueParserOptions = {},
  ): ValueParser<Value> {
    return createValueParser(label, parse, options);
  },

  range(
    minimum: number,
    maximum: number,
  ): ValueParser<number> {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
      throw new RangeError('A parser range must have finite, ascending bounds');
    }
    return createValueParser(`${minimum}..${maximum}`, (input) => {
      const value = finiteNumber(input);
      if (value < minimum || value > maximum) {
        throw new Error(`expected a number from ${minimum} to ${maximum}`);
      }
      return value;
    });
  },
});
