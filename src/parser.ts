/** A canonical enum value with optional accepted aliases and documentation metadata. */
export interface EnumValue<Value extends string = string> {
  readonly value: Value;
  readonly aliases?: readonly string[];
  readonly describe?: string;
  readonly hide?: boolean;
}

/** Options accepted by parsers.enum(). */
export interface EnumParserOptions {
  /** Matches canonical values and aliases without regard to letter case. */
  readonly ignoreCase?: boolean;
}

/** Converts one command-line token to a typed value. */
export interface ValueParser<out Value> {
  readonly label: string;
  /** Static values offered by generated shell completions. */
  readonly completions?: readonly string[];
  /** A fallback used by generated shell completions. */
  readonly completionHint?: CompletionValueHint;
  /** Canonical values and aliases known by enum-backed parsers. */
  readonly choices?: readonly EnumValue[];
  /** Whether enum values and aliases are matched case-insensitively. */
  readonly ignoreCase?: boolean;
  /** Converts one raw argument value or throws when the value is invalid. */
  parse(input: string): Value;
}

export type CompletionValueHint = 'file' | 'directory';

export interface ValueParserOptions {
  readonly completions?: readonly string[];
  readonly completionHint?: CompletionValueHint;
}

interface ParserMetadata {
  readonly choices?: readonly EnumValue[];
  readonly ignoreCase?: boolean;
}

type EnumDefinition = string | EnumValue<string>;

type EnumCanonicalValue<Definition> = Definition extends string ? Definition
  : Definition extends EnumValue<infer Value> ? Value
  : never;

type EnumCanonicalValues<Definitions extends readonly EnumDefinition[]> = EnumCanonicalValue<Definitions[number]>;

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

function validateParserOptions(options: unknown): asserts options is ValueParserOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Value parser options must be an object');
  }
  const configured = options as Record<string, unknown>;
  if (configured.completions !== undefined) {
    if (
      !Array.isArray(configured.completions)
      || Array.from(configured.completions).some((value) => typeof value !== 'string')
    ) {
      throw new TypeError('Value parser completions must be an array of strings');
    }
  }
  if (
    configured.completionHint !== undefined
    && configured.completionHint !== 'file'
    && configured.completionHint !== 'directory'
  ) {
    throw new TypeError('A value parser completion hint must be \'file\' or \'directory\'');
  }
}

function validateEnumValue(value: unknown): asserts value is EnumValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('An enum value must be a string or descriptor object');
  }
  const configured = value as Record<string, unknown>;
  if (typeof configured.value !== 'string') {
    throw new TypeError('An enum value descriptor must define a string value');
  }
  if (configured.aliases !== undefined) {
    if (
      !Array.isArray(configured.aliases)
      || Array.from(configured.aliases).some((alias) => typeof alias !== 'string')
    ) {
      throw new TypeError('An enum value descriptor aliases must be an array of strings');
    }
  }
  if (configured.describe !== undefined && typeof configured.describe !== 'string') {
    throw new TypeError('An enum value descriptor describe must be a string');
  }
  if (configured.hide !== undefined && typeof configured.hide !== 'boolean') {
    throw new TypeError('An enum value descriptor hide must be a boolean');
  }
  const unsupported = Object.keys(configured).find(
    (key) => !['value', 'aliases', 'describe', 'hide'].includes(key),
  );
  if (unsupported !== undefined) {
    throw new TypeError(`An enum value descriptor cannot configure ${unsupported}`);
  }
}

function validateParserMetadata(metadata: ParserMetadata): void {
  const configured = metadata as Record<string, unknown>;
  if (configured.choices !== undefined) {
    if (
      !Array.isArray(configured.choices)
      || Array.from(configured.choices).some((choice) => {
        try {
          validateEnumValue(choice);
          return false;
        } catch {
          return true;
        }
      })
    ) {
      throw new TypeError('Value parser choices must be an array of enum descriptors');
    }
  }
  if (configured.ignoreCase !== undefined && typeof configured.ignoreCase !== 'boolean') {
    throw new TypeError('Value parser ignoreCase must be a boolean');
  }
}

function normalizeEnumToken(input: string, ignoreCase: boolean): string {
  return ignoreCase ? input.toLowerCase() : input;
}

function copyEnumValue(choice: EnumValue): EnumValue {
  return Object.freeze({
    value: choice.value,
    ...(choice.aliases === undefined
      ? {}
      : { aliases: Object.freeze([...choice.aliases]) }),
    ...(choice.describe === undefined ? {} : { describe: choice.describe }),
    ...(choice.hide === undefined ? {} : { hide: choice.hide }),
  });
}

function copyEnumValues(choices: readonly EnumValue[]): readonly EnumValue[] {
  return Object.freeze(choices.map(copyEnumValue));
}

function choicesMatchingCompletions(
  choices: readonly EnumValue[] | undefined,
  completions: readonly string[] | undefined,
  ignoreCase = false,
): readonly EnumValue[] | undefined {
  if (choices === undefined || completions === undefined) {
    return choices;
  }
  const accepted = new Set(completions.map((value) => normalizeEnumToken(value, ignoreCase)));
  return choices.filter((choice) =>
    choice.hide !== true && [choice.value, ...(choice.aliases ?? [])].some(
      (value) => accepted.has(normalizeEnumToken(value, ignoreCase)),
    )
  );
}

function completionsWithoutHiddenChoices(
  completions: readonly string[] | undefined,
  choices: readonly EnumValue[] | undefined,
  ignoreCase = false,
): readonly string[] | undefined {
  if (completions === undefined || choices === undefined) {
    return completions;
  }
  const hidden = new Set(
    choices
      .filter(({ hide }) => hide === true)
      .flatMap(({ value, aliases }) => [value, ...(aliases ?? [])])
      .map((value) => normalizeEnumToken(value, ignoreCase)),
  );
  return completions.filter((value) => !hidden.has(normalizeEnumToken(value, ignoreCase)));
}

/** Validates a parser supplied to argument factories and parser combinators. */
export function validateValueParser(parser: unknown): asserts parser is ValueParser<unknown> {
  if (parser === null || typeof parser !== 'object' || Array.isArray(parser)) {
    throw new TypeError('A value parser must be an object');
  }
  if (!('label' in parser) || typeof parser.label !== 'string') {
    throw new TypeError('A value parser label must be a string');
  }
  if (!('parse' in parser) || typeof parser.parse !== 'function') {
    throw new TypeError('A value parser parse field must be a function');
  }
  validateParserOptions(parser);
  validateParserMetadata(parser as ParserMetadata);
}

/** Creates an immutable parser for the public parsers namespace. */
function createValueParser<Value>(
  label: string,
  parse: (input: string) => Value,
  options: ValueParserOptions = {},
  metadata: ParserMetadata = {},
): ValueParser<Value> {
  if (typeof label !== 'string') {
    throw new TypeError('A value parser label must be a string');
  }
  if (typeof parse !== 'function') {
    throw new TypeError('A value parser parse field must be a function');
  }
  validateParserOptions(options);
  validateParserMetadata(metadata);
  return Object.freeze({
    label,
    parse,
    ...(options.completions === undefined
      ? {}
      : { completions: Object.freeze([...options.completions]) }),
    ...(options.completionHint === undefined
      ? {}
      : { completionHint: options.completionHint }),
    ...(metadata.choices === undefined
      ? {}
      : { choices: copyEnumValues(metadata.choices) }),
    ...(metadata.ignoreCase === undefined
      ? {}
      : { ignoreCase: metadata.ignoreCase }),
  });
}

function composedParserOptions<Value>(
  parser: ValueParser<Value>,
  options: ValueParserOptions,
  completions: readonly string[] | undefined = options.completions ?? parser.completions,
): ValueParserOptions {
  const completionHint = options.completionHint ?? parser.completionHint;
  return {
    ...(completions === undefined ? {} : { completions }),
    ...(completionHint === undefined ? {} : { completionHint }),
  };
}

function composedParserMetadata<Value>(
  parser: ValueParser<Value>,
  choices: readonly EnumValue[] | undefined = parser.choices,
): ParserMetadata {
  return {
    ...(choices === undefined ? {} : { choices }),
    ...(parser.ignoreCase === undefined ? {} : { ignoreCase: parser.ignoreCase }),
  };
}

/** Creates a parser that transforms the value produced by another parser. */
function mapParser<Value, MappedValue>(
  parser: ValueParser<Value>,
  transform: (value: Value) => MappedValue,
  options: ValueParserOptions = {},
): ValueParser<MappedValue> {
  validateValueParser(parser);
  if (typeof transform !== 'function') {
    throw new TypeError('A map parser transform must be a function');
  }
  validateParserOptions(options);
  const completions = options.completions === undefined
    ? parser.completions
    : completionsWithoutHiddenChoices(options.completions, parser.choices, parser.ignoreCase);
  return createValueParser(
    parser.label,
    (input) => transform(parser.parse(input)),
    composedParserOptions(parser, options, completions),
    composedParserMetadata(
      parser,
      options.completions === undefined
        ? parser.choices
        : choicesMatchingCompletions(parser.choices, completions, parser.ignoreCase),
    ),
  );
}

function refineParser<Value, NarrowedValue extends Value>(
  parser: ValueParser<Value>,
  predicate: (value: Value) => value is NarrowedValue,
  message?: string,
  options?: ValueParserOptions,
): ValueParser<NarrowedValue>;
function refineParser<Value>(
  parser: ValueParser<Value>,
  predicate: (value: Value) => boolean,
  message?: string,
  options?: ValueParserOptions,
): ValueParser<Value>;
/** Creates a parser that accepts only values satisfying a predicate. */
function refineParser<Value>(
  parser: ValueParser<Value>,
  predicate: (value: Value) => boolean,
  message?: string,
  options: ValueParserOptions = {},
): ValueParser<Value> {
  validateValueParser(parser);
  if (typeof predicate !== 'function') {
    throw new TypeError('A refine parser predicate must be a function');
  }
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('A refine parser message must be a string');
  }
  validateParserOptions(options);
  const sourceCompletions = options.completions === undefined
    ? parser.completions
    : completionsWithoutHiddenChoices(options.completions, parser.choices, parser.ignoreCase);
  const completions = sourceCompletions === undefined
    ? undefined
    : sourceCompletions.filter((candidate) => {
      try {
        return predicate(parser.parse(candidate));
      } catch {
        return false;
      }
    });
  const refinedChoices = parser.choices === undefined
    ? undefined
    : parser.choices.filter((choice) => {
      try {
        return predicate(parser.parse(choice.value));
      } catch {
        return false;
      }
    });
  return createValueParser(
    parser.label,
    (input) => {
      const value = parser.parse(input);
      if (!predicate(value)) {
        throw new Error(message ?? 'expected a value satisfying the refinement');
      }
      return value;
    },
    composedParserOptions(parser, options, completions),
    composedParserMetadata(
      parser,
      options.completions === undefined
        ? refinedChoices
        : choicesMatchingCompletions(refinedChoices, completions, parser.ignoreCase),
    ),
  );
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
  if (!Object.hasOwn(units, unit)) {
    throw new Error(errorMessage);
  }
  const multiplier = units[unit] as number;

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

function validateEnumParserOptions(options: unknown): asserts options is EnumParserOptions {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Enum parser options must be an object');
  }
  const configured = options as Record<string, unknown>;
  if (configured.ignoreCase !== undefined && typeof configured.ignoreCase !== 'boolean') {
    throw new TypeError('Enum parser option \'ignoreCase\' must be a boolean');
  }
  const unsupported = Object.keys(configured).find((key) => key !== 'ignoreCase');
  if (unsupported !== undefined) {
    throw new TypeError(`Enum parser options cannot configure ${unsupported}`);
  }
}

function createEnumParser<const Values extends readonly [EnumDefinition, ...EnumDefinition[]]>(
  values: Values,
  options: EnumParserOptions = {},
): ValueParser<EnumCanonicalValues<Values>> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('An enum parser requires a non-empty array of strings or descriptors');
  }
  validateEnumParserOptions(options);
  const ignoreCase = options.ignoreCase ?? false;
  const choices = Array.from(values, (definition): EnumValue => {
    if (typeof definition === 'string') {
      return { value: definition };
    }
    if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
      throw new TypeError('An enum parser requires a non-empty array of strings or descriptors');
    }
    validateEnumValue(definition);
    return {
      value: definition.value,
      ...(definition.aliases === undefined
        ? {}
        : { aliases: [...definition.aliases] }),
      ...(definition.describe === undefined ? {} : { describe: definition.describe }),
      ...(definition.hide === undefined ? {} : { hide: definition.hide }),
    };
  });
  const lookup = new Map<string, string>();
  for (const choice of choices) {
    for (const spelling of [choice.value, ...(choice.aliases ?? [])]) {
      const key = normalizeEnumToken(spelling, ignoreCase);
      if (lookup.has(key)) {
        throw new TypeError(`An enum value or alias is duplicated or ambiguous: ${spelling}`);
      }
      lookup.set(key, choice.value);
    }
  }
  const visibleValues = choices
    .filter(({ hide }) => hide !== true)
    .map(({ value }) => value);
  const allowedText = visibleValues.join(', ');
  return createValueParser(
    visibleValues.length === 0 ? 'VALUE' : visibleValues.join('|'),
    (input): EnumCanonicalValues<Values> => {
      const canonical = lookup.get(normalizeEnumToken(input, ignoreCase));
      if (canonical === undefined) {
        if (visibleValues.length === 0) {
          throw new Error('expected a configured value');
        }
        throw new Error(`expected one of: ${allowedText}`);
      }
      return canonical as EnumCanonicalValues<Values>;
    },
    { completions: visibleValues },
    {
      choices,
      ...(options.ignoreCase === undefined ? {} : { ignoreCase }),
    },
  );
}

function jsonParser(): ValueParser<unknown>;
function jsonParser<Value>(
  guard: (value: unknown) => value is Value,
): ValueParser<Value>;
function jsonParser<Value>(
  guard?: (value: unknown) => value is Value,
): ValueParser<unknown> {
  if (guard !== undefined && typeof guard !== 'function') {
    throw new TypeError('A JSON parser guard must be a function');
  }
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
