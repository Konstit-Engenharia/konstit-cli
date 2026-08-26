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

type OneCharacter<Value extends string> = Value extends `${infer _First}${infer Rest}` ? Rest extends '' ? Value
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
}

/** Settings accepted by option(). */
export type OptionOptions<Value> =
  & NamedArgumentOptions
  & ValueMetadataOptions<Value>;

/** Settings accepted by positional(). */
export type PositionalOptions<Value> = ValueMetadataOptions<Value>;

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

type CheckedValueOptions<Value, Options> = Options extends { readonly required: true; readonly default: unknown; }
  ? { readonly __typeclap_error__: 'An argument cannot be required and have a default'; }
  : Options extends { readonly default: infer Default; } ? [Default] extends [Value] ? unknown : { readonly default: NoInfer<Value>; }
  : unknown;

type ConfiguredValueOutput<Value, Options> = Options extends { readonly default: unknown; } ? Value
  : Options extends { readonly required: true; } ? Exclude<Value, undefined>
  : Value | undefined;

interface RuntimeValueOptions<Value> extends ValueMetadataOptions<Value> {}

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

type RangeCountOutput<Value, Output, Maximum extends number | undefined> = Maximum extends 1 ? Output
  : PreserveUndefined<Output, readonly Value[]>;

type RangeCardinality<
  Minimum extends number,
  Maximum extends number | undefined,
> = Maximum extends 1 ? Minimum extends 0 ? 'optional'
  : 'one'
  : 'many';

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

/**
 * An immutable argument builder. The generic parameters are used by Command to
 * infer the final parse result. Application code normally creates this through
 * option(), positional(), flag(), or count().
 */
export class Argument<
  const Name extends string,
  Value,
  Output,
  const Kind extends ArgumentKind,
  const Cardinality extends ArgumentCardinality = 'one',
  const Global extends boolean = false,
> implements ArgumentType<Name, Value, Output, Kind, Cardinality, Global> {
  declare readonly [argumentTypeKey]: readonly [
    Name,
    Value,
    Output,
    Kind,
    Cardinality,
    Global,
  ];

  constructor(definition: ArgumentDefinition) {
    argumentDefinitions.set(this, definition);
  }

  private with<
    NextOutput = Output,
    NextCardinality extends ArgumentCardinality = Cardinality,
  >(
    patch: Partial<ArgumentDefinition>,
  ): Argument<Name, Value, NextOutput, Kind, NextCardinality, Global> {
    return new Argument(copyDefinition(getArgumentDefinition(this), patch));
  }

  /** Adds a one-character short form, such as -p. */
  short<const Short extends string>(
    this: Argument<Name, Value, Output, Extract<Kind, NamedArgumentKind>, Cardinality, Global>,
    short: OneCharacter<Short>,
  ): Argument<Name, Value, Output, Extract<Kind, NamedArgumentKind>, Cardinality, Global> {
    if (Array.from(short).length !== 1 || short === '-') {
      throw new TypeError('A short option must be one character');
    }
    return this.with({ short });
  }

  /** Sets the long form without the leading --. */
  long(
    this: Argument<Name, Value, Output, Extract<Kind, NamedArgumentKind>, Cardinality, Global>,
    long: string,
  ): Argument<Name, Value, Output, Extract<Kind, NamedArgumentKind>, Cardinality, Global> {
    validateLongName(long);
    return this.with({ long });
  }

  /** Adds another long form without the leading --. */
  alias(
    this: Argument<Name, Value, Output, Extract<Kind, NamedArgumentKind>, Cardinality, Global>,
    alias: string,
  ): Argument<Name, Value, Output, Extract<Kind, NamedArgumentKind>, Cardinality, Global> {
    validateLongName(alias);
    const definition = getArgumentDefinition(this);
    return this.with({ aliases: [...definition.aliases, alias] });
  }

  /** Sets the argument description shown in generated help. */
  describe(help: string): Argument<Name, Value, Output, Kind, Cardinality, Global> {
    return this.with({ help });
  }

  /** Sets the value label shown in usage and help, such as PATH. */
  valueName(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    valueName: string,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    return this.with({ valueName });
  }

  /** Selects file or directory completion for this argument's value. */
  valueHint(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    hint: CompletionValueHint,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    return this.with({ completionHint: hint });
  }

  /** Computes value completions from the active command line. */
  complete(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    provider: DynamicCompletionProvider,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    return this.with({ completion: provider });
  }

  /** Makes a boolean switch false when present and true when absent. */
  negated(
    this: Argument<Name, boolean, boolean, Extract<Kind, 'flag'>, Cardinality, Global>,
  ): Argument<Name, boolean, boolean, Extract<Kind, 'flag'>, Cardinality, Global> {
    return this.with({ action: ArgumentAction.SetFalse, defaultValue: true });
  }

  /** Sets the number of values consumed by each occurrence. */
  numArgs<const Count extends number>(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, 'one', Global>,
    count: Count,
  ): Argument<
    Name,
    Value,
    ExactCountOutput<Value, Output, Count>,
    Extract<Kind, ValueArgumentKind>,
    Count extends 1 ? 'one' : 'many',
    Global
  >;
  numArgs<
    const Minimum extends number,
    const Maximum extends number | undefined = undefined,
  >(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, 'one', Global>,
    range: { readonly min: Minimum; readonly max?: Maximum; },
  ): Argument<
    Name,
    Value,
    RangeCountOutput<Value, Output, Maximum>,
    Extract<Kind, ValueArgumentKind>,
    RangeCardinality<Minimum, Maximum>,
    Global
  >;
  numArgs(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, 'one', Global>,
    countOrRange: number | ValueCountRange,
  ): Argument<
    Name,
    Value,
    unknown,
    Extract<Kind, ValueArgumentKind>,
    ArgumentCardinality,
    Global
  > {
    const minimum = typeof countOrRange === 'number'
      ? countOrRange
      : countOrRange.min;
    const maximum = typeof countOrRange === 'number'
      ? countOrRange
      : countOrRange.max;
    validateValueCount(minimum, maximum);
    if (getArgumentDefinition(this).presence === 'default' && maximum !== 1) {
      throw new TypeError('A multi-value argument cannot have a scalar default');
    }
    return this.with<unknown, ArgumentCardinality>({
      minValues: minimum,
      maxValues: maximum ?? null,
    });
  }

  /** Supplies a value when an option is present without one. */
  defaultMissing(
    this: Argument<Name, Value, Output, Extract<Kind, 'option'>, 'one', Global>,
    value: Value,
  ): Argument<Name, Value, Output, Extract<Kind, 'option'>, 'one', Global> {
    return this.with({
      minValues: 0,
      maxValues: 1,
      defaultMissingValue: value,
      hasDefaultMissingValue: true,
      requireEquals: true,
    });
  }

  /** Splits each raw value before parsing. */
  valueDelimiter(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    delimiter: string,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    if (Array.from(delimiter).length !== 1) {
      throw new TypeError('A value delimiter must be one character');
    }
    return this.with({ valueDelimiter: delimiter });
  }

  /** Stops collecting values when this token is encountered. */
  valueTerminator(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    terminator: string,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    if (terminator.length === 0) {
      throw new TypeError('A value terminator cannot be empty');
    }
    return this.with({ valueTerminator: terminator });
  }

  /** Requires the --option=value form. */
  requireEquals(
    this: Argument<Name, Value, Output, Extract<Kind, 'option'>, Cardinality, Global>,
    enabled = true,
  ): Argument<Name, Value, Output, Extract<Kind, 'option'>, Cardinality, Global> {
    return this.with({ requireEquals: enabled });
  }

  /** Allows values that begin with a hyphen. */
  allowHyphenValues(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    enabled = true,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    return this.with({ allowHyphenValues: enabled });
  }

  /** Allows negative numeric values while preserving option parsing. */
  allowNegativeNumbers(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
    enabled = true,
  ): Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global> {
    return this.with({ allowNegativeNumbers: enabled });
  }

  /** Captures all remaining tokens, including option-looking tokens. */
  trailingVarArg(
    this: Argument<Name, Value, Output, Extract<Kind, 'positional'>, 'one', Global>,
  ): Argument<
    Name,
    Value,
    readonly Value[],
    Extract<Kind, 'positional'>,
    'many',
    Global
  > {
    const definition = getArgumentDefinition(this);
    if (definition.presence === 'default') {
      throw new TypeError('A trailing argument cannot have a scalar default');
    }
    return this.with<readonly Value[], 'many'>({
      minValues: definition.presence === 'required' ? 1 : 0,
      maxValues: null,
      trailingVarArg: true,
      allowHyphenValues: true,
    });
  }

  /** Makes this named argument available to all nested subcommands. */
  global(
    this: Argument<
      Name,
      Value,
      Output,
      Extract<Kind, NamedArgumentKind>,
      Cardinality,
      Global
    >,
  ): Argument<
    Name,
    Value,
    Output,
    Extract<Kind, NamedArgumentKind>,
    Cardinality,
    true
  > {
    return new Argument(copyDefinition(getArgumentDefinition(this), { global: true }));
  }

  /** Requires this argument. Its result no longer includes undefined. */
  required(): Argument<
    Name,
    Value,
    Cardinality extends 'optional' ? Output : Exclude<Output, undefined>,
    Kind,
    Cardinality,
    Global
  > {
    return this.with<
      Cardinality extends 'optional' ? Output : Exclude<Output, undefined>
    >({ presence: 'required' });
  }

  /** Restores optional single-value behavior. */
  optional(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, 'one', Global>,
  ): Argument<
    Name,
    Value,
    Value | undefined,
    Extract<Kind, ValueArgumentKind>,
    'one',
    Global
  > {
    if (getArgumentDefinition(this).repeatable) {
      throw new TypeError('A repeatable argument always defaults to an empty array');
    }
    return this.with<Value | undefined>({ presence: 'optional', defaultValue: undefined });
  }

  /** Supplies a value when the user omits the argument. */
  default(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, 'one', Global>,
    value: Value,
  ): Argument<Name, Value, Value, Extract<Kind, ValueArgumentKind>, 'one', Global> {
    if (getArgumentDefinition(this).repeatable) {
      throw new TypeError('A repeatable argument cannot have a scalar default');
    }
    return this.with<Value>({ presence: 'default', defaultValue: value });
  }

  /** Collects each occurrence in declaration order. An absent list is empty. */
  repeatable(
    this: Argument<Name, Value, Output, Extract<Kind, ValueArgumentKind>, Cardinality, Global>,
  ): Argument<
    Name,
    Value,
    readonly Value[],
    Extract<Kind, ValueArgumentKind>,
    'many',
    Global
  > {
    const definition = getArgumentDefinition(this);
    if (definition.kind === 'flag' || definition.kind === 'count') {
      throw new TypeError('Flags and counters cannot be repeatable values');
    }
    return this.with<readonly Value[], 'many'>({
      action: ArgumentAction.Append,
      repeatable: true,
      presence: definition.presence === 'required' ? 'required' : 'optional',
      defaultValue: undefined,
    });
  }

  /** Reads a missing value from this environment variable. */
  env(name: string): Argument<Name, Value, Output, Kind, Cardinality, Global> {
    if (name.length === 0) {
      throw new TypeError('An environment variable name cannot be empty');
    }
    return this.with({ env: name });
  }

  /** Hides the argument from help and completion while keeping it parseable. */
  hide(hidden = true): Argument<Name, Value, Output, Kind, Cardinality, Global> {
    return this.with({ hidden });
  }
}

function validateName(name: string): void {
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

function applyArgumentOptions<
  const Name extends string,
  Value,
  Output,
  const Kind extends ArgumentKind,
  const Cardinality extends ArgumentCardinality,
  const Global extends boolean,
>(
  argument: Argument<Name, Value, Output, Kind, Cardinality, Global>,
  options: ArgumentOptions,
): Argument<Name, Value, Output, Kind, Cardinality, Global> {
  let configured = argument;
  if (options.describe !== undefined) {
    configured = configured.describe(options.describe);
  }
  if (options.env !== undefined) {
    configured = configured.env(options.env);
  }
  if (options.hide !== undefined) {
    configured = configured.hide(options.hide);
  }
  return configured;
}

function applyNamedArgumentOptions<
  const Name extends string,
  Value,
  Output,
  const Kind extends NamedArgumentKind,
  const Cardinality extends ArgumentCardinality,
  const Options extends NamedArgumentOptions,
>(
  argument: Argument<Name, Value, Output, Kind, Cardinality, false>,
  options: Options,
): Argument<Name, Value, Output, Kind, Cardinality, ConfiguredGlobal<Options>> {
  let configured = applyArgumentOptions(argument, options) as Argument<
    Name,
    Value,
    Output,
    Extract<Kind, NamedArgumentKind>,
    Cardinality,
    false
  >;
  if (options.short !== undefined) {
    configured = configured.short(options.short as never);
  }
  if (options.long !== undefined) {
    configured = configured.long(options.long);
  }
  for (const alias of options.aliases ?? []) {
    configured = configured.alias(alias);
  }
  const result = options.global === true ? configured.global() : configured;
  return result as unknown as Argument<
    Name,
    Value,
    Output,
    Kind,
    Cardinality,
    ConfiguredGlobal<Options>
  >;
}

function applyValueArgumentOptions<
  const Name extends string,
  Value,
  Output,
  const Kind extends ValueArgumentKind,
  const Global extends boolean,
>(
  argument: Argument<Name, Value, Output, Kind, 'one', Global>,
  options: RuntimeValueOptions<Value>,
): ArgumentType<Name, Value, unknown, Kind, 'one', Global> {
  let configured = applyArgumentOptions(argument, options) as Argument<
    Name,
    Value,
    Output,
    Extract<Kind, ValueArgumentKind>,
    'one',
    Global
  >;
  if (options.valueName !== undefined) {
    configured = configured.valueName(options.valueName);
  }
  if (options.valueHint !== undefined) {
    configured = configured.valueHint(options.valueHint);
  }
  if (options.complete !== undefined) {
    configured = configured.complete(options.complete);
  }

  const hasDefault = Object.hasOwn(options, 'default');
  if (hasDefault && options.required === true) {
    throw new TypeError('An argument configuration cannot be required and have a default');
  }
  if (hasDefault) {
    return configured.default(options.default as Value);
  }
  if (options.required === true) {
    return configured.required();
  }
  return configured;
}

/** Creates a named --option which consumes one value. */
export function option<const Name extends string>(
  name: Name,
): Argument<Name, string, string | undefined, 'option'>;
export function option<const Name extends string, Value>(
  name: Name,
  parser: ValueParser<Value>,
): Argument<Name, Value, Value | undefined, 'option'>;
export function option<
  const Name extends string,
  Value,
  const Options extends OptionOptions<NoInfer<Value>>,
>(
  name: Name,
  parser: ValueParser<Value>,
  options: Options & CheckedShort<Options> & CheckedValueOptions<Value, Options>,
): Argument<
  Name,
  Value,
  ConfiguredValueOutput<Value, Options>,
  'option',
  'one',
  ConfiguredGlobal<Options>
>;
export function option(
  name: string,
  parser: ValueParser<unknown> = parsers.string,
  options: RuntimeOptionOptions<unknown> = {},
): ArgumentType {
  const argument = applyNamedArgumentOptions(
    new Argument<string, unknown, unknown, 'option'>(
      baseDefinition(name, 'option', parser),
    ),
    options,
  );
  return applyValueArgumentOptions(argument, options);
}

/** Creates a positional value. Positionals are consumed in declaration order. */
export function positional<const Name extends string>(
  name: Name,
): Argument<Name, string, string | undefined, 'positional'>;
export function positional<const Name extends string, Value>(
  name: Name,
  parser: ValueParser<Value>,
): Argument<Name, Value, Value | undefined, 'positional'>;
export function positional<
  const Name extends string,
  Value,
  const Options extends PositionalOptions<NoInfer<Value>>,
>(
  name: Name,
  parser: ValueParser<Value>,
  options: Options & CheckedValueOptions<Value, Options>,
): Argument<Name, Value, ConfiguredValueOutput<Value, Options>, 'positional'>;
export function positional(
  name: string,
  parser: ValueParser<unknown> = parsers.string,
  options: RuntimeValueOptions<unknown> = {},
): ArgumentType {
  if (Object.hasOwn(options, 'global')) {
    throw new TypeError('Positional arguments cannot be global');
  }
  return applyValueArgumentOptions(
    new Argument<string, unknown, unknown, 'positional'>(
      baseDefinition(name, 'positional', parser),
    ),
    options,
  );
}

/** Creates a boolean switch. An absent flag is false. */
export function flag<const Name extends string>(
  name: Name,
): Argument<Name, boolean, boolean, 'flag'>;
export function flag<
  const Name extends string,
  const Options extends FlagOptions,
>(
  name: Name,
  options: Options & CheckedShort<Options>,
): Argument<Name, boolean, boolean, 'flag', 'one', ConfiguredGlobal<Options>>;
export function flag(
  name: string,
  options: FlagOptions = {},
): ArgumentType {
  const configured = applyNamedArgumentOptions(
    new Argument<string, boolean, boolean, 'flag'>(baseDefinition(name, 'flag')),
    options,
  );
  return options.negated === true ? configured.negated() : configured;
}

/** Creates an occurrence counter, such as -vvv. An absent counter is zero. */
export function count<const Name extends string>(
  name: Name,
): Argument<Name, number, number, 'count'>;
export function count<
  const Name extends string,
  const Options extends CountOptions,
>(
  name: Name,
  options: Options & CheckedShort<Options>,
): Argument<Name, number, number, 'count', 'one', ConfiguredGlobal<Options>>;
export function count(
  name: string,
  options: CountOptions = {},
): ArgumentType {
  return applyNamedArgumentOptions(
    new Argument<string, number, number, 'count'>(baseDefinition(name, 'count')),
    options,
  );
}

/** The covariant type surface used to inspect any argument builder. */
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
