import type { DynamicCompletionProvider } from './dynamic-completion';
import {
  parsers,
  type CompletionValueHint,
  type ValueParser,
} from './parser';

export type ArgumentKind = 'option' | 'positional' | 'flag' | 'count';
type ValueArgumentKind = Extract<ArgumentKind, 'option' | 'positional'>;
type NamedArgumentKind = Exclude<ArgumentKind, 'positional'>;
export type ArgumentPresence = 'optional' | 'required' | 'default';
export type ArgumentCardinality = 'one' | 'optional' | 'many';

/** Runtime actions follow clap's ArgAction names while using JS-style values. */
export const ArgumentAction = Object.freeze(
  {
    Set: 'set',
    Append: 'append',
    SetTrue: 'setTrue',
    SetFalse: 'setFalse',
    Count: 'count',
    Help: 'help',
    HelpShort: 'helpShort',
    HelpLong: 'helpLong',
    Version: 'version',
  } as const,
);

export type ArgumentAction = (typeof ArgumentAction)[keyof typeof ArgumentAction];

export interface ValueCountRange {
  readonly min: number;
  readonly max?: number;
}

export interface ArgumentDefinition {
  readonly name: string;
  readonly kind: ArgumentKind;
  readonly action: ArgumentAction;
  readonly parser?: ValueParser<unknown> | undefined;
  readonly short?: string;
  readonly long?: string;
  readonly aliases: readonly string[];
  readonly help?: string;
  readonly valueName?: string;
  readonly presence: ArgumentPresence;
  readonly defaultValue?: unknown;
  readonly defaultMissingValue?: unknown;
  readonly hasDefaultMissingValue: boolean;
  readonly repeatable: boolean;
  readonly minValues: number;
  readonly maxValues: number | null;
  readonly valueDelimiter?: string;
  readonly valueTerminator?: string;
  readonly requireEquals: boolean;
  readonly allowHyphenValues: boolean;
  readonly allowNegativeNumbers: boolean;
  readonly trailingVarArg: boolean;
  readonly global: boolean;
  readonly hidden: boolean;
  readonly env?: string;
  readonly completionHint?: CompletionValueHint;
  readonly completion?: DynamicCompletionProvider;
}

type OneCharacter<Value extends string> = string extends Value ? Value
  : Value extends '-' ? never
  : Value extends `${infer _First}${infer Rest}` ? Rest extends '' ? Value
    : never
  : never;

/** Settings shared by every argument factory. */
export interface ArgumentOptions {
  /** Sets the argument description shown in generated help. */
  readonly describe?: string;
  /** Reads a missing value from this environment variable. */
  readonly env?: string;
  /** Hides the argument from help and completion while keeping it parseable. */
  readonly hide?: boolean;
}

/** Settings shared by named argument factories. */
export interface NamedArgumentOptions extends ArgumentOptions {
  /** Makes the argument available to nested subcommands. */
  readonly global?: boolean;
  /** Adds a one-character short form. */
  readonly short?: string;
  /** Sets the long form without the leading --. */
  readonly long?: string;
  /** Adds parseable long aliases. */
  readonly aliases?: readonly string[];
}

interface ValueMetadataOptions<Value> extends ArgumentOptions {
  /** Sets the value label shown in usage and help. */
  readonly valueName?: string;
  /** Selects file or directory completion for the value. */
  readonly valueHint?: CompletionValueHint;
  /** Computes value completions from the active command line. */
  readonly complete?: DynamicCompletionProvider;
  /** Requires a value when no default is configured. */
  readonly required?: boolean;
  /** Supplies a value when the user omits the argument. */
  readonly default?: NoInfer<Value>;
  /** Collects each occurrence into an array. */
  readonly repeatable?: boolean;
  /** Sets the number of values consumed by each occurrence. */
  readonly numArgs?: number | ValueCountRange;
  /** Splits each raw value before parsing. */
  readonly valueDelimiter?: string;
  /** Stops collecting values when this token is encountered. */
  readonly valueTerminator?: string;
  /** Allows values that begin with a hyphen. */
  readonly allowHyphenValues?: boolean;
  /** Allows negative numeric values while preserving option parsing. */
  readonly allowNegativeNumbers?: boolean;
}

/** Settings accepted by option(). */
export type OptionOptions<Value> =
  & NamedArgumentOptions
  & ValueMetadataOptions<Value>
  & {
    /** Supplies a value when the option is present without one. */
    readonly defaultMissing?: NoInfer<Value>;
    /** Requires the --option=value form. */
    readonly requireEquals?: boolean;
  };

/** Settings accepted by positional(). */
export type PositionalOptions<Value> = ValueMetadataOptions<Value> & {
  /** Captures all remaining tokens, including option-looking tokens. */
  readonly trailingVarArg?: boolean;
};

/** Settings accepted by flag(). */
export interface FlagOptions extends NamedArgumentOptions {
  /** Makes the switch false when present and true when absent. */
  readonly negated?: boolean;
}

/** Settings accepted by count(). */
export type CountOptions = NamedArgumentOptions;

type CheckedShort<Options extends NamedArgumentOptions> = Options extends { readonly short: infer Short extends string; }
  ? { readonly short: OneCharacter<Short>; }
  : unknown;

type ConfiguredGlobal<Options> = Options extends { readonly global: infer Global extends boolean; } ? Global
  : 'global' extends keyof Options ? boolean
  : false;

type Field<Options, Key extends PropertyKey> = Key extends keyof Options ? Options[Key] : never;

type ConfiguredField<
  Options,
  Key extends PropertyKey,
> = Options extends { readonly [Property in Key]: infer Value; } ? Value
  : Key extends keyof Options ? Field<Options, Key>
  : undefined;

type ConfigurationError<Message extends string> = {
  readonly __typeclap_error__: Message;
};

type CheckedOptionKeys<Options, Allowed, Kind extends ArgumentKind> = Exclude<keyof Options, keyof Allowed> extends never ? unknown
  : ConfigurationError<`${Kind} configuration contains unsupported fields`>;

type NumArgsAllowsScalarDefault<Options> = 'numArgs' extends keyof Options
  ? Options extends { readonly numArgs: infer NumArgs; } ? NumArgs extends 1 | { readonly max: 1; } ? true : false
  : false
  : true;

type CheckedDefaultOptions<Value, Options> = Options extends { readonly default: infer Default; }
  ? [Default] extends [Value]
    ? true extends Field<Options, 'required'> ? ConfigurationError<'An argument cannot be required and have a default'>
    : true extends Field<Options, 'repeatable'> ? ConfigurationError<'A repeatable argument cannot have a scalar default'>
    : true extends Field<Options, 'trailingVarArg'> ? ConfigurationError<'A trailing argument cannot have a scalar default'>
    : NumArgsAllowsScalarDefault<Options> extends true ? unknown
    : ConfigurationError<'A multi-value argument cannot have a scalar default'>
  : { readonly default: NoInfer<Value>; }
  : unknown;

type CheckedCollectionOptions<Options> = Options extends { readonly trailingVarArg: true; }
  ? true extends Field<Options, 'repeatable'> ? ConfigurationError<'A trailing argument cannot be repeatable'>
  : 'numArgs' extends keyof Options ? ConfigurationError<'A trailing argument cannot configure numArgs'>
  : false extends Field<Options, 'allowHyphenValues'> ? ConfigurationError<'A trailing argument must allow hyphen values'>
  : unknown
  : unknown;

type CheckedValueOptions<Value, Options> = CheckedDefaultOptions<Value, Options> & CheckedCollectionOptions<Options>;

type CheckedDefaultMissingOptions<Value, Options> = Options extends { readonly defaultMissing: infer DefaultMissing; }
  ? [DefaultMissing] extends [Value]
    ? 'numArgs' extends keyof Options ? ConfigurationError<'defaultMissing cannot be combined with numArgs'>
    : unknown
  : { readonly defaultMissing: NoInfer<Value>; }
  : unknown;

type CheckedOptionOptions<Value, Options> = 'trailingVarArg' extends keyof Options
  ? ConfigurationError<'Options cannot be trailing positional arguments'>
  : CheckedDefaultMissingOptions<Value, Options>;

type CheckedPositionalOptions<Options> = 'global' extends keyof Options ? ConfigurationError<'Positional arguments cannot be global'>
  : 'defaultMissing' extends keyof Options ? ConfigurationError<'Positional arguments cannot configure defaultMissing'>
  : 'requireEquals' extends keyof Options ? ConfigurationError<'Positional arguments cannot require equals-form values'>
  : unknown;

type ConfiguredScalarOutput<Value, Options> = Options extends { readonly default: unknown; } ? Value
  : Options extends { readonly required: true; } ? Exclude<Value, undefined>
  : Value | undefined;

type ExactConfiguredCountOutput<
  Value,
  Output,
  Count extends number,
> = number extends Count ? Output | PreserveUndefined<Output, readonly Value[]>
  : ExactCountOutput<Value, Output, Count>;

type OptionalScalarOutput<Value, Output, Options> = Options extends { readonly default: unknown; } ? Output
  : Options extends { readonly defaultMissing: unknown; } ? Output
  : Output | Value | undefined;

type ConfiguredRangeOutput<
  Value,
  Output,
  Minimum extends number,
  Maximum extends number | undefined,
  Options,
> = number extends Maximum ? OptionalScalarOutput<Value, Output, Options> | PreserveUndefined<Output, readonly Value[]>
  : Maximum extends 1 ? 0 extends Minimum ? OptionalScalarOutput<Value, Output, Options>
    : Output
  : PreserveUndefined<Output, readonly Value[]>;

type ConfiguredNumArgsOutput<
  Value,
  Output,
  NumArgs,
  Options,
> = NumArgs extends number ? ExactConfiguredCountOutput<Value, Output, NumArgs>
  : NumArgs extends {
    readonly min: infer Minimum extends number;
    readonly max?: infer Maximum extends number | undefined;
  } ? ConfiguredRangeOutput<Value, Output, Minimum, Maximum, Options>
  : Output;

type CollectionOutput<Value, Output, Enabled> = Enabled extends true ? readonly Value[] : Output;

type ConfiguredValueOutput<Value, Options> = CollectionOutput<
  Value,
  CollectionOutput<
    Value,
    ConfiguredNumArgsOutput<
      Value,
      ConfiguredScalarOutput<Value, Options>,
      ConfiguredField<Options, 'numArgs'>,
      Options
    >,
    ConfiguredField<Options, 'repeatable'>
  >,
  ConfiguredField<Options, 'trailingVarArg'>
>;

type ExactCountCardinality<Count extends number> = number extends Count ? 'one' | 'many'
  : Count extends 1 ? 'one'
  : 'many';

type ConfiguredRangeCardinality<
  Minimum extends number,
  Maximum extends number | undefined,
> = number extends Maximum ? ArgumentCardinality
  : Maximum extends 1 ? number extends Minimum ? 'optional' | 'one'
    : Minimum extends 0 ? 'optional'
    : 'one'
  : 'many';

type ConfiguredNumArgsCardinality<NumArgs> = NumArgs extends number ? ExactCountCardinality<NumArgs>
  : NumArgs extends {
    readonly min: infer Minimum extends number;
    readonly max?: infer Maximum extends number | undefined;
  } ? ConfiguredRangeCardinality<Minimum, Maximum>
  : 'one';

type CollectionCardinality<Cardinality, Enabled> = Enabled extends true ? 'many' : Cardinality;

type ConfiguredCardinality<Options> = CollectionCardinality<
  CollectionCardinality<
    ConfiguredNumArgsCardinality<
      ConfiguredField<Options, 'numArgs'>
    >,
    ConfiguredField<Options, 'repeatable'>
  >,
  ConfiguredField<Options, 'trailingVarArg'>
>;

interface RuntimeValueOptions<Value> extends ValueMetadataOptions<Value> {
  readonly defaultMissing?: Value;
  readonly requireEquals?: boolean;
  readonly trailingVarArg?: boolean;
}

interface RuntimeOptionOptions<Value> extends NamedArgumentOptions, RuntimeValueOptions<Value> {}

type PreserveUndefined<Current, Present> = undefined extends Current ? Present | undefined : Present;

type FixedTuple<
  Value,
  Count extends number,
  Values extends readonly Value[] = [],
> = number extends Count ? readonly Value[]
  : Values['length'] extends Count ? Readonly<Values>
  : Values['length'] extends 20 ? readonly Value[]
  : FixedTuple<Value, Count, readonly [...Values, Value]>;

type ExactCountOutput<Value, Output, Count extends number> = Count extends 1 ? Output : PreserveUndefined<Output, FixedTuple<Value, Count>>;

function copyDefinition(
  definition: ArgumentDefinition,
  patch: Partial<ArgumentDefinition>,
): ArgumentDefinition {
  const merged = { ...definition, ...patch };
  return Object.freeze({
    ...merged,
    aliases: Object.freeze([...merged.aliases]),
  });
}

declare const argumentTypeKey: unique symbol;

const argumentDefinitions = new WeakMap<object, ArgumentDefinition>();

function configuredArgument<
  const Name extends string,
  Value,
  Output,
  const Kind extends ArgumentKind,
  const Cardinality extends ArgumentCardinality = 'one',
  const Global extends boolean = false,
>(
  definition: ArgumentDefinition,
): ArgumentType<Name, Value, Output, Kind, Cardinality, Global> {
  const argument = Object.freeze({}) as ArgumentType<
    Name,
    Value,
    Output,
    Kind,
    Cardinality,
    Global
  >;
  argumentDefinitions.set(argument, definition);
  return argument;
}

/** Gets the runtime definition for internal parser and completion code. */
export function getArgumentDefinition(argument: ArgumentType): ArgumentDefinition {
  const definition = argumentDefinitions.get(argument);
  if (definition === undefined) {
    throw new TypeError(
      'Expected an argument created by option(), positional(), flag(), or count()',
    );
  }
  return definition;
}

function validateName(name: string): void {
  if (typeof name !== 'string') {
    throw new TypeError('An argument name must be a string');
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new TypeError(`Invalid argument name: ${JSON.stringify(name)}`);
  }
}

function validateLongName(name: string): void {
  validateName(name);
}

function validateValueParser(parser: unknown): asserts parser is ValueParser<unknown> {
  if (parser === null || typeof parser !== 'object' || Array.isArray(parser)) {
    throw new TypeError('A value parser must be an object');
  }
  if (!('label' in parser) || typeof parser.label !== 'string') {
    throw new TypeError('A value parser label must be a string');
  }
  if (!('parse' in parser) || typeof parser.parse !== 'function') {
    throw new TypeError('A value parser parse field must be a function');
  }
  if ('completions' in parser && parser.completions !== undefined) {
    if (
      !Array.isArray(parser.completions)
      || parser.completions.some((value) => typeof value !== 'string')
    ) {
      throw new TypeError('Value parser completions must be an array of strings');
    }
  }
  if (
    'completionHint' in parser
    && parser.completionHint !== undefined
    && parser.completionHint !== 'file'
    && parser.completionHint !== 'directory'
  ) {
    throw new TypeError('A value parser completion hint must be \'file\' or \'directory\'');
  }
}

function validateValueCount(minimum: number, maximum: number | undefined): void {
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new RangeError('The minimum value count must be a non-negative integer');
  }
  if (
    maximum !== undefined
    && (!Number.isSafeInteger(maximum) || maximum < minimum)
  ) {
    throw new RangeError('The maximum value count must be an integer at least equal to min');
  }
}

function baseDefinition(
  name: string,
  kind: ArgumentKind,
  parser?: ValueParser<unknown>,
): ArgumentDefinition {
  validateName(name);
  if (kind === 'option' || kind === 'positional') {
    validateValueParser(parser);
  }
  const long = kind === 'positional' ? undefined : name.replaceAll('_', '-');
  return Object.freeze({
    name,
    kind,
    action: kind === 'flag'
      ? ArgumentAction.SetTrue
      : kind === 'count'
      ? ArgumentAction.Count
      : ArgumentAction.Set,
    ...(parser === undefined ? {} : { parser }),
    ...(long === undefined ? {} : { long }),
    aliases: Object.freeze([]),
    presence: kind === 'flag' || kind === 'count' ? 'default' : 'optional',
    ...(kind === 'flag' ? { defaultValue: false } : {}),
    ...(kind === 'count' ? { defaultValue: 0 } : {}),
    hasDefaultMissingValue: false,
    repeatable: false,
    minValues: kind === 'flag' || kind === 'count' ? 0 : 1,
    maxValues: kind === 'flag' || kind === 'count' ? 0 : 1,
    requireEquals: false,
    allowHyphenValues: false,
    allowNegativeNumbers: false,
    trailingVarArg: false,
    global: false,
    hidden: false,
  });
}

function applyArgumentOptions(
  definition: ArgumentDefinition,
  options: ArgumentOptions,
): ArgumentDefinition {
  let configured = definition;
  if (options.describe !== undefined) {
    configured = copyDefinition(configured, { help: options.describe });
  }
  if (options.env !== undefined) {
    if (options.env.length === 0) {
      throw new TypeError('An environment variable name cannot be empty');
    }
    configured = copyDefinition(configured, { env: options.env });
  }
  if (options.hide !== undefined) {
    configured = copyDefinition(configured, { hidden: options.hide });
  }
  return configured;
}

function applyNamedArgumentOptions(
  definition: ArgumentDefinition,
  options: NamedArgumentOptions,
): ArgumentDefinition {
  let configured = applyArgumentOptions(definition, options);
  if (options.short !== undefined) {
    configured = copyDefinition(configured, { short: options.short });
  }
  if (options.long !== undefined) {
    validateLongName(options.long);
    configured = copyDefinition(configured, { long: options.long });
  }
  for (const alias of options.aliases ?? []) {
    validateLongName(alias);
    configured = copyDefinition(configured, {
      aliases: [...configured.aliases, alias],
    });
  }
  return options.global === true
    ? copyDefinition(configured, { global: true })
    : configured;
}

function validateConfiguredValueOptions(
  kind: ValueArgumentKind,
  options: RuntimeValueOptions<unknown>,
): void {
  validateArgumentOptionKeys(kind, options);
  const hasDefault = Object.hasOwn(options, 'default');
  const hasDefaultMissing = Object.hasOwn(options, 'defaultMissing');
  const hasNumArgs = Object.hasOwn(options, 'numArgs');

  if (kind === 'option' && Object.hasOwn(options, 'trailingVarArg')) {
    throw new TypeError('Options cannot be trailing positional arguments');
  }
  if (kind === 'positional') {
    if (Object.hasOwn(options, 'global')) {
      throw new TypeError('Positional arguments cannot be global');
    }
    if (hasDefaultMissing) {
      throw new TypeError('Positional arguments cannot configure defaultMissing');
    }
    if (Object.hasOwn(options, 'requireEquals')) {
      throw new TypeError('Positional arguments cannot require equals-form values');
    }
  }
  if (hasDefault && options.required === true) {
    throw new TypeError('An argument configuration cannot be required and have a default');
  }
  if (hasDefault && options.repeatable === true) {
    throw new TypeError('A repeatable argument cannot have a scalar default');
  }
  if (hasDefault && options.trailingVarArg === true) {
    throw new TypeError('A trailing argument cannot have a scalar default');
  }
  if (hasDefault && options.numArgs !== undefined) {
    const maximum = typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.max;
    const message = 'A multi-value argument cannot have a scalar default';
    if (maximum !== 1) {
      throw new TypeError(message);
    }
  }
  if (hasDefaultMissing && hasNumArgs) {
    throw new TypeError('defaultMissing cannot be combined with numArgs');
  }
  if (options.trailingVarArg === true) {
    if (options.repeatable === true) {
      throw new TypeError('A trailing argument cannot be repeatable');
    }
    if (hasNumArgs) {
      throw new TypeError('A trailing argument cannot configure numArgs');
    }
    if (options.allowHyphenValues === false) {
      throw new TypeError('A trailing argument must allow hyphen values');
    }
  }
}

function validateArgumentOptionKeys(
  kind: ArgumentKind,
  options: unknown,
): void {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${kind} argument configuration must be an object`);
  }
  const allowed = [
    'describe',
    'env',
    'hide',
    ...(kind === 'positional' ? [] : ['global', 'short', 'long', 'aliases']),
    ...(kind === 'option' || kind === 'positional'
      ? [
        'valueName',
        'valueHint',
        'complete',
        'required',
        'default',
        'repeatable',
        'numArgs',
        'valueDelimiter',
        'valueTerminator',
        'allowHyphenValues',
        'allowNegativeNumbers',
      ]
      : []),
    ...(kind === 'option' ? ['defaultMissing', 'requireEquals'] : []),
    ...(kind === 'positional' ? ['trailingVarArg'] : []),
    ...(kind === 'flag' ? ['negated'] : []),
  ];
  const deferredUnsupported = kind === 'option'
    ? ['trailingVarArg']
    : kind === 'positional'
    ? ['global', 'defaultMissing', 'requireEquals']
    : [];
  const unsupported = Object.keys(options).find(
    (key) => !allowed.includes(key) && !deferredUnsupported.includes(key),
  );
  if (unsupported !== undefined) {
    throw new TypeError(`${kind} arguments cannot configure ${unsupported}`);
  }

  const configured = options as Record<string, unknown>;
  for (
    const key of [
      'describe',
      'env',
      'long',
      'valueName',
      'valueDelimiter',
      'valueTerminator',
    ]
  ) {
    if (configured[key] !== undefined && typeof configured[key] !== 'string') {
      throw new TypeError(`${kind} argument option '${key}' must be a string`);
    }
  }
  for (
    const key of [
      'hide',
      'global',
      'required',
      'repeatable',
      'requireEquals',
      'allowHyphenValues',
      'allowNegativeNumbers',
      'trailingVarArg',
      'negated',
    ]
  ) {
    if (configured[key] !== undefined && typeof configured[key] !== 'boolean') {
      throw new TypeError(`${kind} argument option '${key}' must be a boolean`);
    }
  }
  if (configured.short !== undefined) {
    if (typeof configured.short !== 'string') {
      throw new TypeError(`${kind} argument option 'short' must be a string`);
    }
    if (configured.short.length !== 1 || configured.short === '-') {
      throw new TypeError('A short option must be one UTF-16 character other than \'-\'');
    }
  }
  if (configured.aliases !== undefined) {
    if (
      !Array.isArray(configured.aliases)
      || configured.aliases.some((alias) => typeof alias !== 'string')
    ) {
      throw new TypeError(`${kind} argument option 'aliases' must be an array of strings`);
    }
  }
  if (
    configured.valueHint !== undefined
    && configured.valueHint !== 'file'
    && configured.valueHint !== 'directory'
  ) {
    throw new TypeError(
      `${kind} argument option 'valueHint' must be 'file' or 'directory'`,
    );
  }
  if (configured.complete !== undefined && typeof configured.complete !== 'function') {
    throw new TypeError(`${kind} argument option 'complete' must be a function`);
  }
  if (configured.numArgs !== undefined) {
    if (typeof configured.numArgs === 'number') {
      validateValueCount(configured.numArgs, configured.numArgs);
    } else {
      const range = configured.numArgs;
      if (range === null || typeof range !== 'object' || Array.isArray(range)) {
        throw new TypeError(
          `${kind} argument option 'numArgs' must be a number or range object`,
        );
      }
      const unsupportedRangeKey = Object.keys(range).find(
        (key) => key !== 'min' && key !== 'max',
      );
      if (unsupportedRangeKey !== undefined) {
        throw new TypeError(
          `${kind} argument option 'numArgs' contains unsupported field '${unsupportedRangeKey}'`,
        );
      }
      if (!('min' in range) || typeof range.min !== 'number') {
        throw new TypeError(`${kind} argument option 'numArgs.min' must be a number`);
      }
      const maximum = 'max' in range ? range.max : undefined;
      if (maximum !== undefined && typeof maximum !== 'number') {
        throw new TypeError(`${kind} argument option 'numArgs.max' must be a number`);
      }
      validateValueCount(range.min, maximum as number | undefined);
    }
  }
}

function applyValueArgumentOptions(
  definition: ArgumentDefinition,
  options: RuntimeValueOptions<unknown>,
): ArgumentDefinition {
  validateConfiguredValueOptions(
    definition.kind as ValueArgumentKind,
    options,
  );

  let configured = applyArgumentOptions(definition, options);
  if (options.valueName !== undefined) {
    configured = copyDefinition(configured, { valueName: options.valueName });
  }
  if (options.valueHint !== undefined) {
    configured = copyDefinition(configured, {
      completionHint: options.valueHint,
    });
  }
  if (options.complete !== undefined) {
    configured = copyDefinition(configured, { completion: options.complete });
  }

  const hasDefault = Object.hasOwn(options, 'default');
  if (hasDefault) {
    configured = copyDefinition(configured, {
      presence: 'default',
      defaultValue: options.default,
    });
  }
  if (Object.hasOwn(options, 'defaultMissing')) {
    configured = copyDefinition(configured, {
      minValues: 0,
      maxValues: 1,
      defaultMissingValue: options.defaultMissing,
      hasDefaultMissingValue: true,
      requireEquals: true,
    });
  }
  if (options.numArgs !== undefined) {
    const minimum = typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.min;
    const maximum = typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.max;
    validateValueCount(minimum, maximum);
    configured = copyDefinition(configured, {
      minValues: minimum,
      maxValues: maximum ?? null,
    });
  }
  if (options.required === true) {
    configured = copyDefinition(configured, { presence: 'required' });
  }
  if (options.repeatable === true) {
    configured = copyDefinition(configured, {
      action: ArgumentAction.Append,
      repeatable: true,
      presence: configured.presence === 'required' ? 'required' : 'optional',
      defaultValue: undefined,
    });
  }
  if (options.valueDelimiter !== undefined) {
    if (Array.from(options.valueDelimiter).length !== 1) {
      throw new TypeError('A value delimiter must be one character');
    }
    configured = copyDefinition(configured, {
      valueDelimiter: options.valueDelimiter,
    });
  }
  if (options.valueTerminator !== undefined) {
    if (options.valueTerminator.length === 0) {
      throw new TypeError('A value terminator cannot be empty');
    }
    configured = copyDefinition(configured, {
      valueTerminator: options.valueTerminator,
    });
  }
  if (options.requireEquals !== undefined) {
    configured = copyDefinition(configured, {
      requireEquals: options.requireEquals,
    });
  }
  if (options.allowHyphenValues !== undefined) {
    configured = copyDefinition(configured, {
      allowHyphenValues: options.allowHyphenValues,
    });
  }
  if (options.allowNegativeNumbers !== undefined) {
    configured = copyDefinition(configured, {
      allowNegativeNumbers: options.allowNegativeNumbers,
    });
  }
  if (options.trailingVarArg === true) {
    configured = copyDefinition(configured, {
      minValues: configured.presence === 'required' ? 1 : 0,
      maxValues: null,
      trailingVarArg: true,
      allowHyphenValues: true,
    });
  }
  return configured;
}

/** Creates a named --option which consumes one value. */
export function option<const Name extends string>(
  name: Name,
): ArgumentType<Name, string, string | undefined, 'option', 'one', false>;
export function option<const Name extends string, Value>(
  name: Name,
  parser: ValueParser<Value>,
): ArgumentType<Name, Value, Value | undefined, 'option', 'one', false>;
export function option<
  const Name extends string,
  Value,
  const Options extends OptionOptions<NoInfer<Value>>,
>(
  name: Name,
  parser: ValueParser<Value>,
  options:
    & Options
    & CheckedShort<Options>
    & CheckedValueOptions<Value, Options>
    & CheckedOptionOptions<Value, Options>
    & CheckedOptionKeys<Options, OptionOptions<Value>, 'option'>,
): ArgumentType<
  Name,
  Value,
  ConfiguredValueOutput<Value, Options>,
  'option',
  ConfiguredCardinality<Options>,
  ConfiguredGlobal<Options>
>;
export function option(
  name: string,
  parser: ValueParser<unknown> = parsers.string,
  options: RuntimeOptionOptions<unknown> = {},
): ArgumentType {
  validateArgumentOptionKeys('option', options);
  const definition = applyNamedArgumentOptions(
    baseDefinition(name, 'option', parser),
    options,
  );
  return configuredArgument(applyValueArgumentOptions(definition, options));
}

/** Creates a positional value. Positionals are consumed in declaration order. */
export function positional<const Name extends string>(
  name: Name,
): ArgumentType<Name, string, string | undefined, 'positional', 'one', false>;
export function positional<const Name extends string, Value>(
  name: Name,
  parser: ValueParser<Value>,
): ArgumentType<Name, Value, Value | undefined, 'positional', 'one', false>;
export function positional<
  const Name extends string,
  Value,
  const Options extends PositionalOptions<NoInfer<Value>>,
>(
  name: Name,
  parser: ValueParser<Value>,
  options:
    & Options
    & CheckedValueOptions<Value, Options>
    & CheckedPositionalOptions<Options>
    & CheckedOptionKeys<Options, PositionalOptions<Value>, 'positional'>,
): ArgumentType<
  Name,
  Value,
  ConfiguredValueOutput<Value, Options>,
  'positional',
  ConfiguredCardinality<Options>,
  false
>;
export function positional(
  name: string,
  parser: ValueParser<unknown> = parsers.string,
  options: RuntimeValueOptions<unknown> = {},
): ArgumentType {
  return configuredArgument(
    applyValueArgumentOptions(
      baseDefinition(name, 'positional', parser),
      options,
    ),
  );
}

/** Creates a boolean switch. An absent flag is false. */
export function flag<const Name extends string>(
  name: Name,
): ArgumentType<Name, boolean, boolean, 'flag', 'one', false>;
export function flag<
  const Name extends string,
  const Options extends FlagOptions,
>(
  name: Name,
  options:
    & Options
    & CheckedShort<Options>
    & CheckedOptionKeys<Options, FlagOptions, 'flag'>,
): ArgumentType<Name, boolean, boolean, 'flag', 'one', ConfiguredGlobal<Options>>;
export function flag(
  name: string,
  options: FlagOptions = {},
): ArgumentType {
  validateArgumentOptionKeys('flag', options);
  let definition = applyNamedArgumentOptions(
    baseDefinition(name, 'flag'),
    options,
  );
  if (options.negated === true) {
    definition = copyDefinition(definition, {
      action: ArgumentAction.SetFalse,
      defaultValue: true,
    });
  }
  return configuredArgument(definition);
}

/** Creates an occurrence counter, such as -vvv. An absent counter is zero. */
export function count<const Name extends string>(
  name: Name,
): ArgumentType<Name, number, number, 'count', 'one', false>;
export function count<
  const Name extends string,
  const Options extends CountOptions,
>(
  name: Name,
  options:
    & Options
    & CheckedShort<Options>
    & CheckedOptionKeys<Options, CountOptions, 'count'>,
): ArgumentType<Name, number, number, 'count', 'one', ConfiguredGlobal<Options>>;
export function count(
  name: string,
  options: CountOptions = {},
): ArgumentType {
  validateArgumentOptionKeys('count', options);
  return configuredArgument(
    applyNamedArgumentOptions(baseDefinition(name, 'count'), options),
  );
}

/** The covariant, opaque type surface used to inspect a configured argument. */
export interface ArgumentType<
  out Name extends string = string,
  out Value = unknown,
  out Output = unknown,
  out Kind extends ArgumentKind = ArgumentKind,
  out Cardinality extends ArgumentCardinality = ArgumentCardinality,
  out Global extends boolean = boolean,
> {
  readonly [argumentTypeKey]: readonly [
    Name,
    Value,
    Output,
    Kind,
    Cardinality,
    Global,
  ];
}

/** Internal type-level brand for an argument declared as global. */
export interface GlobalArgument<
  out Name extends string = string,
  out Value = unknown,
  out Output = unknown,
  out Kind extends NamedArgumentKind = NamedArgumentKind,
  out Cardinality extends ArgumentCardinality = ArgumentCardinality,
> extends ArgumentType<Name, Value, Output, Kind, Cardinality, true> {}

export type AnyArgument = ArgumentType;
export type AnyGlobalArgument = GlobalArgument;
export type ArgumentName<Value> = Value extends ArgumentType<infer Name> ? Name : never;
export type ArgumentOutput<Value> = Value extends ArgumentType<string, unknown, infer Output> ? Output : never;
