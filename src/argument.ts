import { validateDeprecatedAliases } from './deprecation.js';
import type { DynamicCompletionProvider } from './dynamic-completion.js';
import {
  parsers,
  validateValueParser,
  type CompletionValueHint,
  type ValueParser,
} from './parser.js';

/** The syntax and value-taking behavior of a configured argument. */
export type ArgumentKind = 'option' | 'positional' | 'flag' | 'count';
type ValueArgumentKind = Extract<ArgumentKind, 'option' | 'positional'>;
/** Argument kinds invoked by a named option or switch. */
type NamedArgumentKind = Exclude<ArgumentKind, 'positional'>;
/** Whether an argument is optional, required, or backed by a configured default. */
export type ArgumentPresence = 'optional' | 'required' | 'default';
/** Whether an argument yields a scalar, an optional scalar, or a collection. */
export type ArgumentCardinality = 'one' | 'optional' | 'many';

/** Runtime actions follow clap's ArgAction names while using JS-style values. */
export const ArgumentAction = Object.freeze(
  {
    /** Stores a parsed value. */
    Set: 'set',
    /** Appends parsed values across occurrences. */
    Append: 'append',
    /** Sets a flag to true when supplied. */
    SetTrue: 'setTrue',
    /** Sets a flag to false when supplied. */
    SetFalse: 'setFalse',
    /** Counts occurrences. */
    Count: 'count',
    /** Displays help for the command. */
    Help: 'help',
    /** Displays abbreviated help. */
    HelpShort: 'helpShort',
    /** Displays full help. */
    HelpLong: 'helpLong',
    /** Displays the command version. */
    Version: 'version',
  } as const,
);

/** The parser action associated with an argument. */
export type ArgumentAction = (typeof ArgumentAction)[keyof typeof ArgumentAction];

/** Inclusive bounds on the number of values accepted per occurrence. */
export interface ValueCountRange {
  /** The minimum number of values, a nonnegative safe integer. */
  readonly min: number;
  /** A safe integer at least as large as `min`. Omit it for an unbounded range. */
  readonly max?: number;
}

/** The normalized argument configuration available to completion providers. */
export interface ArgumentDefinition {
  /** The key used for this argument in parsed values. */
  readonly name: string;
  /** Whether the argument is an option, positional, flag, or counter. */
  readonly kind: ArgumentKind;
  /** What the parser does when the argument is supplied. */
  readonly action: ArgumentAction;
  /** Whether the flag controls automatic color selection. */
  readonly color: boolean;
  /** Converts raw values for a positional or option. */
  readonly parser?: ValueParser<unknown> | undefined;
  /** The short spelling without its leading hyphen. */
  readonly short?: string;
  /** The long spelling without its leading hyphens. */
  readonly long?: string;
  /** The long spelling that disables a color flag, without leading hyphens. */
  readonly negativeLong?: string;
  /** Additional long spellings without leading hyphens. */
  readonly aliases: readonly string[];
  /** The warning message emitted when the argument is supplied explicitly. */
  readonly deprecated?: string;
  /** Warning messages keyed by deprecated long alias. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** The description shown in help. */
  readonly help?: string;
  /** The heading under which this argument is rendered in generated help and documentation. */
  readonly helpHeading?: string;
  /** The value placeholder shown in usage and help. */
  readonly valueName?: string;
  /** The argument's requiredness or default status. */
  readonly presence: ArgumentPresence;
  /** The scalar fallback when the argument is absent. Flags and counters also have intrinsic values. */
  readonly defaultValue?: unknown;
  /** The collection fallback when the argument is absent. */
  readonly defaultValues?: readonly unknown[];
  /** The value supplied for an option used without an explicit value. */
  readonly defaultMissingValue?: unknown;
  /** Whether a missing-value fallback was explicitly configured. */
  readonly hasDefaultMissingValue: boolean;
  /** Whether values are collected across repeated occurrences. */
  readonly repeatable: boolean;
  /** The minimum number of values accepted per occurrence. */
  readonly minValues: number;
  /** The maximum number of values accepted per occurrence, or null if unbounded. */
  readonly maxValues: number | null;
  /** The delimiter used to split raw values before parsing. */
  readonly valueDelimiter?: string;
  /** The token that ends value collection for the argument. */
  readonly valueTerminator?: string;
  /** Whether the option requires `--option=value` syntax. */
  readonly requireEquals: boolean;
  /** Whether values may begin with a hyphen. */
  readonly allowHyphenValues: boolean;
  /** Whether negative numeric tokens are accepted as values. */
  readonly allowNegativeNumbers: boolean;
  /** Whether this positional can capture trailing tokens that look like options. */
  readonly trailingVarArg: boolean;
  /** Whether the argument is inherited by descendant commands. */
  readonly global: boolean;
  /** Whether to omit the argument from help and completion. */
  readonly hidden: boolean;
  /** Whether to redact values from diagnostics and omit defaults from documentation. */
  readonly sensitive: boolean;
  /** The environment variable used as a fallback. */
  readonly env?: string;
  /** The argument's explicit file or directory completion hint. */
  readonly completionHint?: CompletionValueHint;
  /** The callback that supplies dynamic value completions. */
  readonly completion?: DynamicCompletionProvider;
}

type OneCharacter<Value extends string> = string extends Value ? Value
  : Value extends '-' ? never
  : Value extends `${infer _First}${infer Rest}` ? Rest extends '' ? Value
    : never
  : never;

/** Settings shared by every argument factory. */
export interface ArgumentOptions {
  /** Warns when explicitly supplied, with guidance for its replacement. */
  readonly deprecated?: string;
  /** Sets the argument description shown in generated help. */
  readonly describe?: string;
  /** Groups this argument under a custom heading in generated help and documentation. */
  readonly helpHeading?: string;
  /** Reads a missing value from this environment variable. Flags use its presence. */
  readonly env?: string;
  /** Hides the argument from help and completion while keeping it parseable. */
  readonly hide?: boolean;
  /** Redacts values and parser error details and omits defaults from help and metadata. */
  readonly sensitive?: boolean;
}

/** Settings shared by named argument factories. */
export interface NamedArgumentOptions extends ArgumentOptions {
  /** Maps declared long aliases to deprecation messages. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** Makes the argument available to nested subcommands. */
  readonly global?: boolean;
  /** Adds a one-character short form. */
  readonly short?: string;
  /** Sets the long form without the leading --. */
  readonly long?: string;
  /** Adds parseable long aliases. */
  readonly aliases?: readonly string[];
}

/** Settings shared by value-taking options and positionals. */
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
  /** Supplies parsed values when a collection argument is omitted. */
  readonly defaultValues?: readonly NoInfer<Value>[];
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

type CollectionNumArgs<NumArgs> = NumArgs extends number ? NumArgs extends 1 ? false : true
  : NumArgs extends { readonly max?: infer Maximum extends number | undefined; } ? Maximum extends 1 ? false : true
  : false;

type HasCollectionShape<Options> = true extends Field<Options, 'repeatable'> ? true
  : true extends Field<Options, 'trailingVarArg'> ? true
  : true extends CollectionNumArgs<Field<Options, 'numArgs'>> ? true
  : false;

type CheckedDefaultValuesOptions<Value, Options> = Options extends {
  readonly defaultValues: infer DefaultValues;
}
  ? [DefaultValues] extends [readonly NoInfer<Value>[]]
    ? HasCollectionShape<Options> extends true
      ? true extends Field<Options, 'required'> ? ConfigurationError<'An argument cannot be required and have default values'>
      : 'default' extends keyof Options ? ConfigurationError<'An argument cannot configure both default and defaultValues'>
      : unknown
    : ConfigurationError<'defaultValues requires a collection argument'>
  : { readonly defaultValues: readonly NoInfer<Value>[]; }
  : unknown;

type CheckedCollectionOptions<Options> = Options extends { readonly trailingVarArg: true; }
  ? true extends Field<Options, 'repeatable'> ? ConfigurationError<'A trailing argument cannot be repeatable'>
  : 'numArgs' extends keyof Options ? ConfigurationError<'A trailing argument cannot configure numArgs'>
  : false extends Field<Options, 'allowHyphenValues'> ? ConfigurationError<'A trailing argument must allow hyphen values'>
  : unknown
  : unknown;

type CheckedValueOptions<Value, Options> =
  & CheckedDefaultOptions<Value, Options>
  & CheckedDefaultValuesOptions<Value, Options>
  & CheckedCollectionOptions<Options>;

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

type ConfiguredScalarOutput<Value, Options> = Options extends { readonly defaultValues: unknown; } ? Value
  : Options extends { readonly default: unknown; } ? Value
  : Options extends { readonly required: true; } ? Exclude<Value, undefined>
  : Value | undefined;

type ExactConfiguredCountOutput<
  Value,
  Output,
  Count extends number,
> = number extends Count ? Output | PreserveUndefined<Output, readonly Value[]>
  : ExactCountOutput<Value, Output, Count>;

type OptionalScalarOutput<Value, Output, Options> = Options extends { readonly defaultValues: unknown; } ? Output
  : Options extends { readonly default: unknown; } ? Output
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
  readonly defaultValues?: readonly Value[];
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
      'Expected an argument created by option(), positional(), flag(), colorFlag(), or count()',
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
    color: false,
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
    sensitive: false,
  });
}

function applyArgumentOptions(
  definition: ArgumentDefinition,
  options: ArgumentOptions,
): ArgumentDefinition {
  let configured = definition;
  if (options.deprecated !== undefined) {
    configured = copyDefinition(configured, { deprecated: options.deprecated });
  }
  if (options.describe !== undefined) {
    configured = copyDefinition(configured, { help: options.describe });
  }
  if (options.helpHeading !== undefined) {
    configured = copyDefinition(configured, { helpHeading: options.helpHeading });
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
  if (options.sensitive !== undefined) {
    configured = copyDefinition(configured, { sensitive: options.sensitive });
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
  if (options.deprecatedAliases !== undefined) {
    configured = copyDefinition(configured, {
      deprecatedAliases: Object.freeze({ ...options.deprecatedAliases }),
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
  const hasDefaultValues = Object.hasOwn(options, 'defaultValues');
  const hasDefaultMissing = Object.hasOwn(options, 'defaultMissing');
  const hasNumArgs = Object.hasOwn(options, 'numArgs');

  if (hasDefaultValues) {
    if (!Array.isArray(options.defaultValues)) {
      throw new TypeError('Argument defaultValues must be an array');
    }
    for (let index = 0; index < options.defaultValues.length; index += 1) {
      if (!Object.hasOwn(options.defaultValues, index)) {
        throw new TypeError('Argument defaultValues cannot contain sparse entries');
      }
    }
    if (hasDefault) {
      throw new TypeError('An argument cannot configure both default and defaultValues');
    }
    if (options.required === true) {
      throw new TypeError('An argument cannot be required and have default values');
    }
    const numArgsCollectsValues = options.numArgs === undefined
      ? false
      : typeof options.numArgs === 'number'
      ? options.numArgs !== 1
      : options.numArgs.max !== 1;
    const collectsValues = options.repeatable === true
      || options.trailingVarArg === true
      || numArgsCollectsValues;
    if (!collectsValues) {
      throw new TypeError('defaultValues requires a collection argument');
    }
    const minimum = options.numArgs === undefined
      ? 0
      : typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.min;
    const maximum = options.numArgs === undefined
      ? undefined
      : typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.max;
    const count = options.defaultValues.length;
    if (options.repeatable) {
      if (
        count > 0
        && maximum === undefined
        && count < minimum
      ) {
        throw new TypeError('Argument defaultValues does not contain a complete occurrence');
      }
      if (
        count > 0
        && maximum !== undefined
        && minimum > 0
        && Math.ceil(count / maximum) > Math.floor(count / minimum)
      ) {
        throw new TypeError('Argument defaultValues does not contain complete occurrences');
      }
    } else if (
      count < minimum
      || (maximum !== undefined && count > maximum)
    ) {
      throw new TypeError('Argument defaultValues does not satisfy its value count');
    }
  }

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
    'deprecated',
    'describe',
    'helpHeading',
    'env',
    'hide',
    'sensitive',
    ...(kind === 'positional' ? [] : ['global', 'short', 'long', 'aliases', 'deprecatedAliases']),
    ...(kind === 'option' || kind === 'positional'
      ? [
        'valueName',
        'valueHint',
        'complete',
        'required',
        'default',
        'defaultValues',
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
      'deprecated',
      'describe',
      'helpHeading',
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
  if (configured.helpHeading === '') {
    throw new TypeError(`${kind} argument option 'helpHeading' cannot be empty`);
  }
  if (typeof configured.helpHeading === 'string' && /[\r\n]/u.test(configured.helpHeading)) {
    throw new TypeError(`${kind} argument option 'helpHeading' cannot contain line breaks`);
  }
  for (
    const key of [
      'hide',
      'sensitive',
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
  validateDeprecatedAliases(
    configured.deprecatedAliases,
    (configured.aliases ?? []) as readonly string[],
  );
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
  const hasDefaultValues = Object.hasOwn(options, 'defaultValues');
  if (hasDefault) {
    configured = copyDefinition(configured, {
      presence: 'default',
      defaultValue: options.default,
    });
  }
  if (hasDefaultValues) {
    configured = copyDefinition(configured, {
      presence: 'default',
      defaultValues: Object.freeze([...(options.defaultValues ?? [])]),
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
      presence: configured.presence === 'required'
        ? 'required'
        : configured.presence === 'default'
        ? 'default'
        : 'optional',
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

/** Creates a named option that accepts one string value. */
export function option<const Name extends string>(
  name: Name,
): ArgumentType<Name, string, string | undefined, 'option', 'one', false>;
/** Creates a named option that accepts one value converted by the supplied parser. */
export function option<const Name extends string, Value>(
  name: Name,
  parser: ValueParser<Value>,
): ArgumentType<Name, Value, Value | undefined, 'option', 'one', false>;
/** Creates a named option with a value parser and settings for spelling, arity, and defaults. */
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

/** Creates a positional that accepts one string. Positionals are consumed in declaration order. */
export function positional<const Name extends string>(
  name: Name,
): ArgumentType<Name, string, string | undefined, 'positional', 'one', false>;
/** Creates a positional that accepts one value converted by the supplied parser. */
export function positional<const Name extends string, Value>(
  name: Name,
  parser: ValueParser<Value>,
): ArgumentType<Name, Value, Value | undefined, 'positional', 'one', false>;
/** Creates a positional with a value parser and settings for arity, defaults, and trailing tokens. */
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
/** Creates a boolean switch with configurable spellings, polarity, and scope. */
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

/** Creates global --name and --no-name switches with automatic color detection. */
export function colorFlag<const Name extends string>(
  name: Name,
): ArgumentType<Name, boolean, boolean, 'flag', 'one', true>;
export function colorFlag(name: string): ArgumentType {
  const definition = baseDefinition(name, 'flag');
  return configuredArgument(copyDefinition(definition, {
    color: true,
    negativeLong: `no-${name.replaceAll('_', '-')}`,
    global: true,
    env: 'NO_COLOR',
    help: 'Enable or disable color output',
  }));
}

/** Creates an occurrence counter, such as -vvv. An absent counter is zero. */
export function count<const Name extends string>(
  name: Name,
): ArgumentType<Name, number, number, 'count', 'one', false>;
/** Creates an occurrence counter with configurable spellings and scope. */
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
  /** Carries the argument's inferred schema and output types. */
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

/** A configured argument of any kind. */
export type AnyArgument = ArgumentType;
/** A configured named argument that descendants can access. */
export type AnyGlobalArgument = GlobalArgument;
/** Extracts the declared name of a configured argument. */
export type ArgumentName<Value> = Value extends ArgumentType<infer Name> ? Name : never;
/** Extracts the parsed output type of a configured argument. */
export type ArgumentOutput<Value> = Value extends ArgumentType<string, unknown, infer Output> ? Output : never;
