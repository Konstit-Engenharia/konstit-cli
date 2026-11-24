/** A canonical enum value with optional accepted aliases and documentation metadata. */
export interface EnumValue<Value extends string = string> {
  /** The canonical value returned by the parser. */
  readonly value: Value;
  /** Alternative input spellings that resolve to the canonical value. */
  readonly aliases?: readonly string[];
  /** The description shown in help and completions that support descriptions. */
  readonly describe?: string;
  /** Omits this choice from help and completion while keeping it parseable. */
  readonly hide?: boolean;
}

/** Options accepted by parsers.enum(). */
export interface EnumParserOptions {
  /** Matches canonical values and aliases without regard to letter case. */
  readonly ignoreCase?: boolean;
}

/** Converts one command-line token to a typed value. */
export interface ValueParser<out Value> {
  /** The default value placeholder used in generated usage and help. */
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

/** The kind of filesystem path a shell can suggest for a value. */
export type CompletionValueHint = 'file' | 'directory';

/** Static completion settings for custom parsers and parser combinators. */
export interface ValueParserOptions {
  /** Raw input strings to offer as shell completions. */
  readonly completions?: readonly string[];
  /** A file or directory fallback for shell completion. */
  readonly completionHint?: CompletionValueHint;
}

interface ParserMetadata {
  readonly choices?: readonly EnumValue[];
  readonly ignoreCase?: boolean;
}

const authoritativeEnumParsers = new WeakSet<object>();

/** Identifies parsers whose choices describe every accepted input spelling. */
export function isAuthoritativeEnumParser(parser: ValueParser<unknown>): boolean {
  return authoritativeEnumParsers.has(parser);
}

/** An enum choice declared as a canonical string or a descriptor. */
export type EnumDefinition = string | EnumValue<string>;

export type EnumCanonicalValue<Definition> = Definition extends string ? Definition
  : Definition extends EnumValue<infer Value> ? Value
  : never;

/** The possible canonical outputs of an enum parser. */
export type EnumCanonicalValues<Definitions extends readonly EnumDefinition[]> = EnumCanonicalValue<Definitions[number]>;

/** Settings accepted by parsers.range(). */
export interface RangeParserOptions {
  /** Accepts only base-10 safe integers, like parsers.integer. Defaults to false. */
  readonly integer?: boolean;
}

/** Settings accepted by parsers.path(). */
export interface PathParserOptions {
  /** The required kind of an existing path and the shell completion hint. */
  readonly kind: CompletionValueHint;
  /** Requires the path to exist at parse time. Defaults to false. */
  readonly mustExist?: boolean;
}

/** A key and value separated by the first equals sign in an argument. */
export interface KeyValuePair {
  /** The nonempty text before the first equals sign. */
  readonly key: string;
  /** The text after the first equals sign, which may be empty. */
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
export function createValueParser<Value>(
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
export function mapParser<Value, MappedValue>(
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

/** Uses a type guard to reject values and narrow the parser's output type. */
export function refineParser<Value, NarrowedValue extends Value>(
  parser: ValueParser<Value>,
  predicate: (value: Value) => value is NarrowedValue,
  message?: string,
  options?: ValueParserOptions,
): ValueParser<NarrowedValue>;
/** Rejects parsed values for which the predicate returns false. */
export function refineParser<Value>(
  parser: ValueParser<Value>,
  predicate: (value: Value) => boolean,
  message?: string,
  options?: ValueParserOptions,
): ValueParser<Value>;
export function refineParser<Value>(
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

export function createEnumParser<const Values extends readonly [EnumDefinition, ...EnumDefinition[]]>(
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
  const parser = createValueParser(
    visibleValues.length === 0 ? 'value' : visibleValues.join('|'),
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
  authoritativeEnumParsers.add(parser);
  return parser;
}

/** Parses JSON using the unknown output type. */
export function jsonParser(): ValueParser<unknown>;
/** Parses JSON and rejects decoded values that fail the supplied type guard. */
export function jsonParser<Value>(
  guard: (value: unknown) => value is Value,
): ValueParser<Value>;
export function jsonParser<Value>(
  guard?: (value: unknown) => value is Value,
): ValueParser<unknown> {
  if (guard !== undefined && typeof guard !== 'function') {
    throw new TypeError('A JSON parser guard must be a function');
  }
  return createValueParser('json', (input) => {
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
