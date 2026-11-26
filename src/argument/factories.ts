import {
  parsers,
  type ValueParser,
} from '../parser/index.js';
import type {
  CheckedOptionKeys,
  CheckedOptionOptions,
  CheckedPositionalOptions,
  CheckedShort,
  CheckedValueOptions,
  ConfiguredCardinality,
  ConfiguredGlobal,
  ConfiguredValueOutput,
  CountOptions,
  FlagOptions,
  OptionOptions,
  PositionalOptions,
  RuntimeOptionOptions,
  RuntimeValueOptions,
} from './options.js';
import {
  applyNamedArgumentOptions,
  applyValueArgumentOptions,
  ArgumentAction,
  baseDefinition,
  configuredArgument,
  copyDefinition,
  validateArgumentOptionKeys,
} from './runtime.js';
import type {
  ArgumentType,
  RequiredArgumentFromOptions,
  RequiredWithoutSubcommandFromOptions,
  TrailingPositionalFromOptions,
} from './types.js';

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
):
  & ArgumentType<
    Name,
    Value,
    ConfiguredValueOutput<Value, Options>,
    'option',
    ConfiguredCardinality<Options>,
    ConfiguredGlobal<Options>
  >
  & RequiredArgumentFromOptions<Options>
  & RequiredWithoutSubcommandFromOptions<Value, Options>;
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
):
  & ArgumentType<
    Name,
    Value,
    ConfiguredValueOutput<Value, Options>,
    'positional',
    ConfiguredCardinality<Options>,
    false
  >
  & RequiredArgumentFromOptions<Options>
  & RequiredWithoutSubcommandFromOptions<Value, Options>
  & TrailingPositionalFromOptions<Options>;
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
