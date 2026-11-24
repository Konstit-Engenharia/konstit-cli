import type { DynamicCompletionProvider } from '../completion/dynamic/types.js';
import type { CompletionValueHint } from '../parser/index.js';

/** The syntax and value-taking behavior of a configured argument. */
export type ArgumentKind = 'option' | 'positional' | 'flag' | 'count';
export type ValueArgumentKind = Extract<ArgumentKind, 'option' | 'positional'>;
/** Argument kinds invoked by a named option or switch. */
export type NamedArgumentKind = Exclude<ArgumentKind, 'positional'>;
/** Whether an argument is optional, required, or backed by a configured default. */
export type ArgumentPresence = 'optional' | 'required' | 'default';
/** Whether an argument yields a scalar, an optional scalar, or a collection. */
export type ArgumentCardinality = 'one' | 'optional' | 'many';

type OneCharacter<Value extends string> = string extends Value ? Value
  : Value extends '-' ? never
  : Value extends `${infer _First}${infer Rest}` ? Rest extends '' ? Value
    : never
  : never;

/** Inclusive bounds on the number of values accepted per occurrence. */
export interface ValueCountRange {
  /** The minimum number of values, a nonnegative safe integer. */
  readonly min: number;
  /** A safe integer at least as large as `min`. Omit it for an unbounded range. */
  readonly max?: number;
}
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
export interface ValueMetadataOptions<Value> extends ArgumentOptions {
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

export type CheckedShort<Options extends NamedArgumentOptions> = Options extends { readonly short: infer Short extends string; }
  ? { readonly short: OneCharacter<Short>; }
  : unknown;

export type ConfiguredGlobal<Options> = Options extends { readonly global: infer Global extends boolean; } ? Global
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

export type CheckedOptionKeys<Options, Allowed, Kind extends ArgumentKind> = Exclude<keyof Options, keyof Allowed> extends never ? unknown
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

export type CheckedValueOptions<Value, Options> =
  & CheckedDefaultOptions<Value, Options>
  & CheckedDefaultValuesOptions<Value, Options>
  & CheckedCollectionOptions<Options>;

type CheckedDefaultMissingOptions<Value, Options> = Options extends { readonly defaultMissing: infer DefaultMissing; }
  ? [DefaultMissing] extends [Value]
    ? 'numArgs' extends keyof Options ? ConfigurationError<'defaultMissing cannot be combined with numArgs'>
    : unknown
  : { readonly defaultMissing: NoInfer<Value>; }
  : unknown;

export type CheckedOptionOptions<Value, Options> = 'trailingVarArg' extends keyof Options
  ? ConfigurationError<'Options cannot be trailing positional arguments'>
  : CheckedDefaultMissingOptions<Value, Options>;

export type CheckedPositionalOptions<Options> = 'global' extends keyof Options ? ConfigurationError<'Positional arguments cannot be global'>
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

export type ConfiguredValueOutput<Value, Options> = CollectionOutput<
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

export type ConfiguredCardinality<Options> = CollectionCardinality<
  CollectionCardinality<
    ConfiguredNumArgsCardinality<
      ConfiguredField<Options, 'numArgs'>
    >,
    ConfiguredField<Options, 'repeatable'>
  >,
  ConfiguredField<Options, 'trailingVarArg'>
>;

export interface RuntimeValueOptions<Value> extends ValueMetadataOptions<Value> {
  readonly defaultValues?: readonly Value[];
  readonly defaultMissing?: Value;
  readonly requireEquals?: boolean;
  readonly trailingVarArg?: boolean;
}

export interface RuntimeOptionOptions<Value> extends NamedArgumentOptions, RuntimeValueOptions<Value> {}

export type PreserveUndefined<Current, Present> = undefined extends Current ? Present | undefined : Present;

export type FixedTuple<
  Value,
  Count extends number,
  Values extends readonly Value[] = [],
> = number extends Count ? readonly Value[]
  : Values['length'] extends Count ? Readonly<Values>
  : Values['length'] extends 20 ? readonly Value[]
  : FixedTuple<Value, Count, readonly [...Values, Value]>;

export type ExactCountOutput<Value, Output, Count extends number> = Count extends 1 ? Output
  : PreserveUndefined<Output, FixedTuple<Value, Count>>;
