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

  /** Creates a number parser limited to the inclusive range. */
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
