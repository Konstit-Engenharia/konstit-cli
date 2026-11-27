import type { DynamicCompletionProvider } from '../completion/dynamic/types.js';
import type {
  CompletionValueHint,
  ValueParser,
} from '../parser/index.js';
import type {
  ArgumentCardinality,
  ArgumentKind,
  ArgumentPresence,
  ConfiguredValueOutput,
  NamedArgumentKind,
} from './options.js';
import type { ArgumentAction } from './runtime.js';

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
  /** The prompt text or enabled default prompt for interactive runs. */
  readonly prompt?: string | boolean;
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
  /** Whether duplicate parsed values are rejected. */
  readonly unique?: true;
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
  /** Whether this trailing positional captures tokens before option and subcommand recognition. */
  readonly literal?: true;
  /** The separator used to join all CLI tokens of a literal trailing positional before parsing. */
  readonly joinWith?: string;
  /** Whether the joined trailing positional returns a scalar. */
  readonly output?: 'scalar';
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

/** The covariant, opaque type surface used to inspect a configured argument. */
declare const argumentTypeKey: unique symbol;
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

declare const requiredArgumentKey: unique symbol;
export interface RequiredArgument {
  readonly [requiredArgumentKey]: true;
}

export type RequiredArgumentFromOptions<Options> = [Options] extends [{ readonly required: true | 'without-subcommand'; }]
  ? RequiredArgument
  : unknown;

declare const requiredWithoutSubcommandKey: unique symbol;
export interface RequiredWithoutSubcommand<out Output = unknown> {
  readonly [requiredWithoutSubcommandKey]: Output;
}

export type RequiredWithoutSubcommandFromOptions<Value, Options> = [Options] extends [{ readonly required: 'without-subcommand'; }]
  ? RequiredWithoutSubcommand<ConfiguredValueOutput<Value, Options, 'defaultMissing' extends keyof Options ? Value | undefined : Value>>
  : unknown;

declare const trailingPositionalKey: unique symbol;
export interface TrailingPositional {
  readonly [trailingPositionalKey]: true;
}

export type TrailingPositionalFromOptions<Options> = [Options] extends [{ readonly trailingVarArg: true; }] ? TrailingPositional
  : unknown;
