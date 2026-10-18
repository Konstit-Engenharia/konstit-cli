import {
  ArgumentAction,
  type ArgumentDefinition,
} from '../argument.js';
import {
  collectDeprecation,
  getWarnings,
  setWarnings,
  type DeprecationWarning,
} from '../deprecation.js';
import {
  CliError,
  DisplayKind,
  ErrorKind,
  type ParseDisplay,
  type ParseOutcome,
  type ParseResult,
} from '../error.js';
import { parsers } from '../parser.js';
import {
  setValueSources,
  updateValueSource,
  type ValueSource,
} from '../value-source.js';
import {
  validateConfigShape,
  type CommandConfig,
  type ConfigValue,
  type ParseOptions,
} from './config.js';
import {
  commandError,
  displayArgument,
  renderHelp,
  suggestToken,
  suggestTokenCandidates,
} from './help.js';
import {
  argumentLongNames,
  isNegativeNumberToken,
  matchSubcommand,
  parseLongOptionToken,
  parseShortOptionCluster,
  splitArgumentValue,
  stopsOptionValueCollection,
} from './recognition.js';
import {
  applyOverrides,
  validateRelations,
  type RelationState,
} from './relations.js';
import type { CommandDefinition } from './schema.js';

class DisplayRequest {
  constructor(readonly outcome: ParseDisplay) {}
}

export type ColorMode = 'auto' | 'always' | 'never';

interface ParseSession {
  readonly defaultColor: boolean;
  readonly warnings: DeprecationWarning[];
  colorMode?: ColorMode;
}

export const outputColorModes = new WeakMap<object, ColorMode>();

export function parseConfigured<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  defaultColor: boolean,
  options: ParseOptions = {},
): ParseOutcome<Value> {
  validateConfigShape(options.config);
  const session: ParseSession = { defaultColor, warnings: [] };
  try {
    const value = parseDefinition(
      definition,
      [...argv],
      0,
      [definition.name],
      [],
      session,
      options.config,
    ) as Value;
    const outcome = { ok: true, type: 'value', value } as const;
    setWarnings(outcome, session.warnings);
    return outcome;
  } catch (error) {
    if (session.colorMode !== undefined) {
      const target = error instanceof DisplayRequest ? error.outcome : error;
      if (typeof target === 'object' && target !== null) {
        outputColorModes.set(target, session.colorMode);
      }
    }
    if (error instanceof DisplayRequest) {
      return error.outcome;
    }
    if (error instanceof CliError) {
      setWarnings(error, session.warnings);
    }
    throw error;
  }
}

export function tryParseConfigured<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  defaultColor: boolean,
  options: ParseOptions = {},
): ParseResult<Value> {
  try {
    return parseConfigured<Value>(definition, argv, defaultColor, options);
  } catch (error) {
    if (error instanceof CliError) {
      const result = { ok: false, type: 'error', error } as const;
      setWarnings(result, getWarnings(error));
      return result;
    }
    throw error;
  }
}

interface ParseState extends RelationState {
  readonly session: ParseSession;
  readonly sources: Map<string, ValueSource>;
  readonly tokenIndices: Map<string, number>;
  positionalIndex: number;
  subcommand?: { readonly name: string; readonly args: Record<string, unknown>; };
}

interface GlobalBinding {
  readonly argument: ArgumentDefinition;
  readonly definition: CommandDefinition;
  readonly state: ParseState;
}

function deprecatedAliasMessage(
  aliases: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  return aliases !== undefined && Object.hasOwn(aliases, name)
    ? aliases[name]
    : undefined;
}

function parseDefinition(
  definition: CommandDefinition,
  argv: string[],
  argvOffset: number,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
  session: ParseSession,
  config: CommandConfig | undefined,
): Record<string, unknown> {
  collectDeprecation(
    session.warnings,
    'command',
    definition.name,
    definition.deprecated,
    path,
  );
  const state: ParseState = {
    values: {},
    provided: new Set(),
    cliProvided: new Set(),
    valueCounts: {},
    sources: new Map(),
    tokenIndices: new Map(),
    session,
    positionalIndex: 0,
  };
  const positionals = definition.arguments.filter(({ kind }) => kind === 'positional');
  initializeValues(definition, state);
  validateGlobalArguments(definition, inheritedGlobals);
  validateConfigForCommand(definition, config, path, inheritedGlobals);
  const localGlobals = definition.arguments
    .filter(({ global }) => global)
    .map((argument) => ({ argument, definition, state }));
  const globals = [...inheritedGlobals, ...localGlobals];

  let index = 0;
  let optionsEnabled = true;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }

    if (optionsEnabled && token === '--') {
      optionsEnabled = false;
      index += 1;
      continue;
    }
    if (
      optionsEnabled
      && !definition.disableHelpFlag
      && (token === '--help' || token === '-h')
    ) {
      throw new DisplayRequest({
        ok: true,
        type: 'display',
        kind: DisplayKind.Help,
        output: renderHelp(
          definition,
          path,
          inheritedGlobals.map(({ argument }) => argument),
        ),
      });
    }
    if (
      optionsEnabled
      && !definition.disableVersionFlag
      && definition.version !== undefined
      && (token === '--version' || token === '-V')
    ) {
      throw new DisplayRequest({
        ok: true,
        type: 'display',
        kind: DisplayKind.Version,
        output: `${definition.name} ${definition.version}\n`,
      });
    }
    const positionalArgument = currentPositional(positionals, state);
    const consumeAsPositional = optionsEnabled
      && positionalArgument !== undefined
      && acceptsOptionLookingPositional(
        positionalArgument,
        token,
        definition,
        state,
        inheritedGlobals,
      );
    if (
      optionsEnabled
      && !consumeAsPositional
      && token.startsWith('--')
      && token.length > 2
    ) {
      index = parseLongOption(
        definition,
        argv,
        index,
        token,
        argvOffset,
        path,
        state,
        inheritedGlobals,
      );
      continue;
    }
    if (
      optionsEnabled
      && !consumeAsPositional
      && token.startsWith('-')
      && token !== '-'
    ) {
      index = parseShortOptions(
        definition,
        argv,
        index,
        token,
        argvOffset,
        path,
        state,
        inheritedGlobals,
      );
      continue;
    }

    if (optionsEnabled && !consumeAsPositional) {
      if (
        token === 'help'
        && definition.subcommands.length > 0
        && !definition.disableHelpSubcommand
        && !hasExactSubcommand(definition, token)
      ) {
        throw new DisplayRequest({
          ok: true,
          type: 'display',
          kind: DisplayKind.Help,
          output: renderSubcommandHelp(
            definition,
            argv.slice(index + 1),
            argvOffset + index + 1,
            path,
            inheritedGlobals,
          ),
        });
      }
      const child = resolveSubcommand(definition, token, path, inheritedGlobals, argvOffset + index);
      if (child !== undefined) {
        const childPath = [...path, child.name];
        collectDeprecation(
          session.warnings,
          'command',
          child.name,
          child.deprecated,
          childPath,
        );
        collectDeprecation(
          session.warnings,
          'alias',
          token,
          deprecatedAliasMessage(child.deprecatedAliases, token),
          childPath,
        );
        state.subcommand = Object.freeze({
          name: child.name,
          args: parseDefinition(
            child,
            argv.slice(index + 1),
            argvOffset + index + 1,
            [...path, child.name],
            globals,
            session,
            config?.subcommands?.[child.name],
          ),
        });
        index = argv.length;
        break;
      }
    }

    if (positionalArgument === undefined) {
      const suggestions = suggestTokenCandidates(
        token,
        definition,
        inheritedGlobals.map(({ argument }) => argument),
      );
      const suggestion = suggestToken(
        token,
        definition,
        inheritedGlobals.map(({ argument }) => argument),
      );
      const kind = definition.subcommands.length > 0
        ? ErrorKind.InvalidSubcommand
        : ErrorKind.UnknownArgument;
      throw commandError(
        kind,
        `unexpected argument '${token}'${suggestion}`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
        {
          tokenIndex: argvOffset + index,
          suggestions,
        },
      );
    }
    if (positionalArgument.valueTerminator === token) {
      state.positionalIndex += 1;
      index += 1;
      continue;
    }
    collectDeprecation(
      session.warnings,
      'argument',
      positionalArgument.name,
      positionalArgument.deprecated,
      path,
      positionalArgument.name,
    );
    storePositionalValue(
      positionalArgument,
      token,
      argvOffset + index,
      definition,
      path,
      state,
    );
    const count = state.valueCounts[positionalArgument.name] ?? 0;
    if (
      !positionalArgument.repeatable
      && positionalArgument.maxValues !== null
      && count >= positionalArgument.maxValues
    ) {
      state.positionalIndex += 1;
    }
    if (positionalArgument.trailingVarArg) {
      optionsEnabled = false;
    }
    index += 1;
  }

  // Capture CLI presence before environment fallbacks and overrides can change it.
  const subcommandConflict = definition.argsConflictWithSubcommands && state.subcommand !== undefined
    ? definition.arguments.find((argument) => !argument.global && state.cliProvided.has(argument.name))
    : undefined;
  applyEnvironmentFallbacks(definition, state, path);
  applyConfigValues(definition, config, path, state, inheritedGlobals);
  const cliProvidedBeforeOverrides = new Set(state.cliProvided);
  applyOverrides(definition, state);
  resetOverriddenSources(definition, state, cliProvidedBeforeOverrides);
  refreshInheritedSources(state.subcommand, localGlobals);
  validateParsedValues(
    definition,
    path,
    state,
    inheritedGlobals.map(({ argument }) => argument),
    subcommandConflict,
  );
  if (definition.subcommands.length > 0) {
    state.values.subcommand = state.subcommand;
  }
  for (const value of Object.values(state.values)) {
    if (Array.isArray(value)) {
      Object.freeze(value);
    }
  }
  const result = Object.freeze(state.values);
  const sources = new Map(state.sources);
  for (const { argument, state: inheritedState } of inheritedGlobals) {
    const source = inheritedState.sources.get(argument.name);
    if (source !== undefined) {
      sources.set(argument.name, source);
    }
  }
  setValueSources(result, sources);
  return result;
}

function refreshInheritedSources(
  subcommand: ParseState['subcommand'],
  globals: readonly GlobalBinding[],
): void {
  if (subcommand === undefined) {
    return;
  }
  for (const { argument, state } of globals) {
    updateValueSource(subcommand.args, argument.name, state.sources.get(argument.name));
  }
  const nested = subcommand.args.subcommand;
  if (
    typeof nested === 'object'
    && nested !== null
    && 'name' in nested
    && 'args' in nested
    && typeof nested.args === 'object'
    && nested.args !== null
  ) {
    refreshInheritedSources(
      nested as ParseState['subcommand'],
      globals,
    );
  }
}

function initializeValues(
  definition: CommandDefinition,
  state: ParseState,
): void {
  for (const argument of definition.arguments) {
    if (argument.color) {
      const disabled = Bun.env.NO_COLOR !== undefined;
      state.values[argument.name] = disabled ? false : state.session.defaultColor;
      state.sources.set(argument.name, disabled ? 'env' : 'default');
      state.session.colorMode = disabled ? 'never' : 'auto';
    } else if (argument.repeatable || argument.trailingVarArg) {
      state.values[argument.name] = [];
    } else if (argument.presence === 'default') {
      state.values[argument.name] = argument.defaultValue;
      state.sources.set(argument.name, 'default');
    } else {
      state.values[argument.name] = undefined;
    }
  }
}

function configSubcommand(
  definition: CommandDefinition,
  name: string,
): CommandDefinition | undefined {
  return definition.subcommands.find(
    (child) => child.name === name,
  );
}

function validateConfigForCommand(
  definition: CommandDefinition,
  config: CommandConfig | undefined,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
): void {
  if (config === undefined) {
    return;
  }
  const values = config.values;
  if (values !== undefined) {
    const bindings = availableArgumentBindings(
      definition,
      {
        values: {},
        provided: new Set(),
        cliProvided: new Set(),
        valueCounts: {},
        sources: new Map(),
        tokenIndices: new Map(),
        session: { defaultColor: false, warnings: [] },
        positionalIndex: 0,
      },
      inheritedGlobals,
    );
    for (const name of Object.keys(values)) {
      if (!bindings.some(({ argument }) => argument.name === name)) {
        throw commandError(
          ErrorKind.UnknownArgument,
          `unknown config argument '${name}' for command '${path.join(' ')}'`,
          definition,
          path,
          inheritedGlobals.map(({ argument }) => argument),
        );
      }
    }
  }
  if (config.subcommands !== undefined) {
    for (const [name, childConfig,] of Object.entries(config.subcommands)) {
      if (configSubcommand(definition, name) === undefined) {
        throw commandError(
          ErrorKind.InvalidSubcommand,
          `unknown config subcommand '${name}' for command '${path.join(' ')}'`,
          definition,
          path,
          inheritedGlobals.map(({ argument }) => argument),
        );
      }
      // Structural validation for every configured branch happens up front;
      // argument validation is intentionally deferred to the selected branch.
      validateConfigShape(childConfig, ['config', ...path.slice(1), 'subcommands', name]);
    }
  }
}

function configArgumentValue(
  value: ConfigValue,
  argument: ArgumentDefinition,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  if (argument.kind === 'flag') {
    if (typeof value !== 'boolean') {
      throw new TypeError(`Config value for '${display}' must be a boolean`);
    }
    state.values[argument.name] = argument.color && Bun.env.NO_COLOR !== undefined
      ? false
      : value;
    state.provided.add(argument.name);
    state.sources.set(argument.name, 'config');
    if (argument.color) {
      state.session.colorMode = state.values[argument.name] === true
        ? 'always'
        : 'never';
    }
    return;
  }
  if (argument.kind === 'count') {
    if (
      typeof value !== 'number'
      || !Number.isSafeInteger(value)
      || value < 0
    ) {
      throw new TypeError(`Config value for '${display}' must be a nonnegative integer`);
    }
    state.values[argument.name] = value;
    state.provided.add(argument.name);
    state.sources.set(argument.name, 'config');
    return;
  }
  if (
    typeof value !== 'string'
    && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
  ) {
    throw new TypeError(`Config value for '${display}' must be a string or string array`);
  }
  const rawValues = typeof value === 'string' ? [value] : value;
  const values = rawValues.flatMap((raw) => splitRawValue(argument, raw));
  if (
    (!argument.repeatable || argument.maxValues === 0)
    && argument.maxValues !== null
    && values.length > argument.maxValues
  ) {
    throw commandError(
      ErrorKind.TooManyValues,
      `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      { argumentName: argument.name },
    );
  }
  if (
    argument.repeatable
    && argument.minValues > 0
    && argument.maxValues !== null
    && Math.ceil(values.length / argument.maxValues) > Math.floor(values.length / argument.minValues)
  ) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${display}' requires complete occurrences of ${argument.minValues} to ${argument.maxValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      { argumentName: argument.name },
    );
  }
  storeRawValues(
    argument,
    values,
    display,
    definition,
    path,
    state,
    true,
    'config',
  );
}

function applyConfigValues(
  definition: CommandDefinition,
  config: CommandConfig | undefined,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): void {
  if (config?.values === undefined) {
    return;
  }
  const inheritedArguments = inheritedGlobals.map(({ argument }) => argument);
  for (const [name, value,] of Object.entries(config.values)) {
    const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
      ({ argument }) => argument.name === name,
    );
    if (
      binding === undefined
      || binding.state.cliProvided.has(name)
      || binding.state.sources.get(name) === 'env'
      || binding.state.sources.get(name) === 'config'
      || hasEnvironmentValue(binding.argument)
      || isOverriddenTarget(binding.definition, binding.state, name)
    ) {
      continue;
    }
    configArgumentValue(
      value,
      binding.argument,
      `config:${name}`,
      definition,
      path,
      binding.state,
      inheritedArguments,
    );
  }
}

function hasEnvironmentValue(argument: ArgumentDefinition): boolean {
  return argument.env !== undefined && Bun.env[argument.env] !== undefined;
}

function isOverriddenTarget(
  definition: CommandDefinition,
  state: ParseState,
  name: string,
): boolean {
  return definition.overrides.some(
    ({ source, target }) => target === name && state.cliProvided.has(source),
  );
}

function resetOverriddenSources(
  definition: CommandDefinition,
  state: ParseState,
  cliProvidedBeforeOverrides: ReadonlySet<string>,
): void {
  for (const { source, target } of definition.overrides) {
    if (!cliProvidedBeforeOverrides.has(source)) {
      continue;
    }
    const argument = definition.arguments.find(({ name }) => name === target);
    if (argument === undefined) {
      continue;
    }
    const collectsValues = argument.repeatable || argument.trailingVarArg;
    if (argument.presence === 'default') {
      state.sources.set(target, 'default');
    } else {
      state.sources.delete(target);
    }
    if (collectsValues) {
      // relation application already restored an empty collection
      state.values[target] = [];
    }
  }
}

function applyEnvironmentFallbacks(
  definition: CommandDefinition,
  state: ParseState,
  path: readonly string[],
): void {
  const overriddenTargets = new Set(
    definition.overrides
      .filter(({ source }) => state.cliProvided.has(source))
      .map(({ target }) => target),
  );
  for (const argument of definition.arguments) {
    if (
      argument.env === undefined
      || state.cliProvided.has(argument.name)
      || overriddenTargets.has(argument.name)
    ) {
      continue;
    }
    const raw = Bun.env[argument.env];
    if (raw === undefined) {
      continue;
    }
    if (argument.kind === 'flag') {
      state.values[argument.name] = argument.color
        ? false
        : argument.action === ArgumentAction.SetTrue;
      if (argument.color) {
        state.session.colorMode = 'never';
      }
      state.provided.add(argument.name);
      state.sources.set(argument.name, 'env');
      continue;
    }
    const display = `env:${argument.env}`;
    if (argument.kind === 'count') {
      const count = parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        parsers.integer,
        true,
      );
      if (typeof count !== 'number' || count < 0) {
        throw commandError(
          ErrorKind.InvalidValue,
          `invalid value for '${display}'`,
          definition,
          path,
          [],
          { argumentName: argument.name },
        );
      }
      state.values[argument.name] = count;
      state.provided.add(argument.name);
      state.sources.set(argument.name, 'env');
      continue;
    }

    const values = splitRawValue(argument, raw);
    const delimiterCanExpandSingle = argument.repeatable && argument.maxValues === 1;
    if (
      !delimiterCanExpandSingle
      && argument.maxValues !== null
      && values.length > argument.maxValues
    ) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
        definition,
        path,
        [],
        { argumentName: argument.name },
      );
    }
    storeRawValues(argument, values, display, definition, path, state, true, 'env');
    state.cliProvided.delete(argument.name);
  }
}

function acceptsOptionLookingPositional(
  argument: ArgumentDefinition,
  token: string,
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): boolean {
  if (token === '--' || token === '-' || !token.startsWith('-')) {
    return false;
  }
  if (hasDeclaredOption(token, definition, state, inheritedGlobals)) {
    return false;
  }
  return argument.allowHyphenValues
    || (argument.allowNegativeNumbers && isNegativeNumberToken(token));
}

function hasDeclaredOption(
  token: string,
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): boolean {
  const bindings = availableArgumentBindings(definition, state, inheritedGlobals);
  if (token.startsWith('--')) {
    const name = token.slice(2).split('=', 1)[0];
    return bindings.some(
      ({ argument }) => name !== undefined && argumentLongNames(argument).includes(name),
    );
  }
  const short = Array.from(token.slice(1))[0];
  return short !== undefined && bindings.some(({ argument }) => argument.short === short);
}

function currentPositional(
  positionals: readonly ArgumentDefinition[],
  state: ParseState,
): ArgumentDefinition | undefined {
  return positionals[state.positionalIndex];
}

function availableArgumentBindings(
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): readonly GlobalBinding[] {
  return [
    ...definition.arguments.map((argument) => ({ argument, definition, state })),
    ...inheritedGlobals,
  ];
}

function validateGlobalArguments(
  definition: CommandDefinition,
  inheritedGlobals: readonly GlobalBinding[],
): void {
  for (const local of definition.arguments) {
    for (const { argument: global } of inheritedGlobals) {
      const localLongs = argumentLongNames(local);
      const globalLongs = argumentLongNames(global);
      if (
        (local.color && global.color)
        || (local.short !== undefined && local.short === global.short)
        || localLongs.some((name) => globalLongs.includes(name))
      ) {
        throw new TypeError(
          `Argument '${local.name}' conflicts with inherited global '${global.name}'`,
        );
      }
    }
  }
}

function hasExactSubcommand(
  definition: CommandDefinition,
  token: string,
): boolean {
  return matchSubcommand(definition, token).kind === 'exact';
}

function resolveSubcommand(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
  tokenIndex: number,
): CommandDefinition | undefined {
  return resolveSubcommandWithArguments(
    definition,
    token,
    path,
    inheritedGlobals.map(({ argument }) => argument),
    tokenIndex,
  );
}

function resolveSubcommandWithArguments(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
  tokenIndex: number,
): CommandDefinition | undefined {
  const match = matchSubcommand(definition, token);
  if (match.kind === 'exact' || match.kind === 'unique') {
    return match.command;
  }
  if (match.kind === 'ambiguous') {
    throw commandError(
      ErrorKind.InvalidSubcommand,
      `subcommand '${token}' is ambiguous: ${match.commands.map(({ name }) => name).join(', ')}`,
      definition,
      path,
      inheritedArguments,
      { tokenIndex, suggestions: match.commands.map(({ name }) => name) },
    );
  }
  return undefined;
}

function renderSubcommandHelp(
  definition: CommandDefinition,
  tokens: readonly string[],
  argvOffset: number,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
): string {
  let current = definition;
  let currentPath = [...path];
  let inheritedArguments = inheritedGlobals.map(({ argument }) => argument);

  for (const [tokenIndex, token,] of tokens.entries()) {
    const globalsForChild = [
      ...inheritedArguments,
      ...current.arguments.filter(({ global }) => global),
    ];
    const child = resolveSubcommandWithArguments(
      current,
      token,
      currentPath,
      globalsForChild,
      argvOffset + tokenIndex,
    );
    if (child === undefined) {
      const suggestions = suggestTokenCandidates(token, current, globalsForChild);
      throw commandError(
        ErrorKind.InvalidSubcommand,
        `unrecognized subcommand '${token}'${suggestToken(token, current, globalsForChild)}`,
        current,
        currentPath,
        inheritedArguments,
        {
          tokenIndex: argvOffset + tokenIndex,
          suggestions,
        },
      );
    }
    current = child;
    currentPath = [...currentPath, child.name];
    inheritedArguments = globalsForChild;
  }
  return renderHelp(current, currentPath, inheritedArguments);
}

function parseLongOption(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
  argvOffset: number,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const { name, inlineValue } = parseLongOptionToken(token);
  const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
    ({ argument }) => argumentLongNames(argument).includes(name),
  );
  if (binding === undefined || binding.argument.kind === 'positional') {
    const suggestions = suggestTokenCandidates(
      `--${name}`,
      definition,
      inheritedGlobals.map(({ argument }) => argument),
    );
    throw commandError(
      ErrorKind.UnknownArgument,
      `unexpected argument '--${name}'${
        suggestToken(
          `--${name}`,
          definition,
          inheritedGlobals.map(({ argument }) => argument),
        )
      }`,
      definition,
      path,
      inheritedGlobals.map(({ argument }) => argument),
      {
        tokenIndex: argvOffset + index,
        suggestions,
      },
    );
  }
  const { argument } = binding;
  collectDeprecation(
    state.session.warnings,
    'argument',
    argument.name,
    argument.deprecated,
    path,
    argument.name,
  );
  if (argument.aliases.includes(name)) {
    collectDeprecation(
      state.session.warnings,
      'alias',
      name,
      deprecatedAliasMessage(argument.deprecatedAliases, name),
      path,
      argument.name,
    );
  }
  if (argument.kind === 'flag' || argument.kind === 'count') {
    if (inlineValue !== undefined) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '--${name}' does not accept a value`,
        definition,
        path,
        [],
        { argumentName: argument.name, tokenIndex: argvOffset + index },
      );
    }
    storeSwitch(
      argument,
      `--${name}`,
      definition,
      path,
      binding.state,
      inheritedGlobals.map(({ argument: inherited }) => inherited),
      argument.negativeLong === name ? false : undefined,
      argvOffset + index,
    );
    return index + 1;
  }
  if (argument.requireEquals && inlineValue === undefined) {
    if (argument.hasDefaultMissingValue) {
      storeParsedValues(
        argument,
        [argument.defaultMissingValue],
        `--${name}`,
        definition,
        path,
        binding.state,
        'cli',
        argvOffset + index,
      );
      return index + 1;
    }
    throw commandError(
      ErrorKind.NoEquals,
      `an equals sign is required for '--${name}=<VALUE>'`,
      definition,
      path,
      inheritedGlobals.map(({ argument }) => argument),
      {
        argumentName: argument.name,
        tokenIndex: argvOffset + index,
      },
    );
  }
  const consumed = consumeOptionValues(
    argument,
    argv,
    index,
    inlineValue,
    argvOffset,
    definition,
    path,
    `--${name}`,
    inheritedGlobals.map(({ argument }) => argument),
  );
  if (consumed.values.length === 0 && argument.hasDefaultMissingValue) {
    storeParsedValues(
      argument,
      [argument.defaultMissingValue],
      `--${name}`,
      definition,
      path,
      binding.state,
      'cli',
      argvOffset + index,
    );
  } else {
    storeRawValues(
      argument,
      consumed.values,
      `--${name}`,
      definition,
      path,
      binding.state,
      false,
      'cli',
      consumed.valueIndices,
      argvOffset + index,
    );
  }
  return consumed.nextIndex;
}

function parseShortOptions(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
  argvOffset: number,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const cluster = parseShortOptionCluster(token);
  for (let clusterIndex = 0; clusterIndex < cluster.length; clusterIndex += 1) {
    const short = cluster[clusterIndex];
    if (short === undefined) {
      continue;
    }
    const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
      ({ argument }) => argument.short === short,
    );
    if (binding === undefined || binding.argument.kind === 'positional') {
      const suggestions = suggestTokenCandidates(
        `-${short}`,
        definition,
        inheritedGlobals.map(({ argument }) => argument),
      );
      throw commandError(
        ErrorKind.UnknownArgument,
        `unexpected argument '-${short}'${
          suggestToken(
            `-${short}`,
            definition,
            inheritedGlobals.map(({ argument }) => argument),
          )
        }`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
        {
          tokenIndex: argvOffset + index,
          suggestions,
        },
      );
    }
    const { argument } = binding;
    collectDeprecation(
      state.session.warnings,
      'argument',
      argument.name,
      argument.deprecated,
      path,
      argument.name,
    );
    if (argument.kind === 'flag' || argument.kind === 'count') {
      storeSwitch(
        argument,
        `-${short}`,
        definition,
        path,
        binding.state,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
        undefined,
        argvOffset + index,
      );
      continue;
    }
    const attachedSource = cluster.slice(clusterIndex + 1).join('');
    const hasAttachedValue = attachedSource !== '';
    const attached = attachedSource.startsWith('=')
      ? attachedSource.slice(1)
      : attachedSource;
    if (argument.requireEquals && !hasAttachedValue) {
      if (argument.hasDefaultMissingValue) {
        storeParsedValues(
          argument,
          [argument.defaultMissingValue],
          `-${short}`,
          definition,
          path,
          binding.state,
          'cli',
          argvOffset + index,
        );
        return index + 1;
      }
      throw commandError(
        ErrorKind.NoEquals,
        `an attached value is required for '-${short}<VALUE>'`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
        {
          argumentName: argument.name,
          tokenIndex: argvOffset + index,
        },
      );
    }
    const consumed = consumeOptionValues(
      argument,
      argv,
      index,
      hasAttachedValue ? attached : undefined,
      argvOffset,
      definition,
      path,
      `-${short}`,
      inheritedGlobals.map(({ argument }) => argument),
    );
    if (consumed.values.length === 0 && argument.hasDefaultMissingValue) {
      storeParsedValues(
        argument,
        [argument.defaultMissingValue],
        `-${short}`,
        definition,
        path,
        binding.state,
        'cli',
        argvOffset + index,
      );
    } else {
      storeRawValues(
        argument,
        consumed.values,
        `-${short}`,
        definition,
        path,
        binding.state,
        false,
        'cli',
        consumed.valueIndices,
        argvOffset + index,
      );
    }
    return consumed.nextIndex;
  }
  return index + 1;
}

interface ConsumedOptionValues {
  readonly values: readonly string[];
  readonly valueIndices: readonly number[];
  readonly nextIndex: number;
}

function consumeOptionValues(
  argument: ArgumentDefinition,
  argv: readonly string[],
  optionIndex: number,
  inlineValue: string | undefined,
  argvOffset: number,
  definition: CommandDefinition,
  path: readonly string[],
  display: string,
  inheritedArguments: readonly ArgumentDefinition[],
): ConsumedOptionValues {
  const values: string[] = [];
  const valueIndices: number[] = [];
  let rawCount = 0;
  let nextIndex = optionIndex + 1;

  const append = (raw: string, rawIndex: number): void => {
    const parts = splitRawValue(argument, raw);
    const delimiterCanExpandSingle = argument.repeatable && argument.maxValues === 1;
    if (
      !delimiterCanExpandSingle
      && argument.maxValues !== null
      && values.length + parts.length > argument.maxValues
    ) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
        definition,
        path,
        inheritedArguments,
        {
          argumentName: argument.name,
          tokenIndex: argvOffset + rawIndex,
        },
      );
    }
    values.push(...parts);
    valueIndices.push(...parts.map(() => argvOffset + rawIndex));
    rawCount += 1;
  };

  if (inlineValue !== undefined) {
    append(inlineValue, optionIndex);
  }
  while (
    (argument.maxValues === null || values.length < argument.maxValues)
    && !(argument.repeatable && argument.maxValues === 1 && rawCount >= 1)
  ) {
    const raw = argv[nextIndex];
    if (raw === undefined) {
      break;
    }
    if (argument.valueTerminator === raw) {
      nextIndex += 1;
      break;
    }
    if (
      stopsOptionValueCollection(argument, raw)
      || (
        values.length >= argument.minValues
        && resolveSubcommandWithArguments(
            definition,
            raw,
            path,
            inheritedArguments,
            argvOffset + nextIndex,
          ) !== undefined
      )
    ) {
      break;
    }
    append(raw, nextIndex);
    nextIndex += 1;
  }

  if (values.length < argument.minValues) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${display}' requires at least ${argument.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: argument.name,
        tokenIndex: argvOffset + optionIndex,
      },
    );
  }
  return { values, valueIndices, nextIndex };
}

function splitRawValue(argument: ArgumentDefinition, raw: string): readonly string[] {
  return splitArgumentValue(argument, raw);
}

function storePositionalValue(
  argument: ArgumentDefinition,
  raw: string,
  tokenIndex: number,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
): void {
  const values = splitRawValue(argument, raw);
  const currentCount = state.sources.get(argument.name) === 'cli'
    ? state.valueCounts[argument.name] ?? 0
    : 0;
  if (
    !argument.repeatable
    && argument.maxValues !== null
    && currentCount + values.length > argument.maxValues
  ) {
    throw commandError(
      ErrorKind.TooManyValues,
      `argument '${displayArgument(argument)}' accepts at most ${argument.maxValues} value(s)`,
      definition,
      path,
      [],
      {
        argumentName: argument.name,
        tokenIndex,
      },
    );
  }
  storeRawValues(
    argument,
    values,
    raw,
    definition,
    path,
    state,
    false,
    'cli',
    values.map(() => tokenIndex),
    tokenIndex,
  );
}

function storeRawValues(
  argument: ArgumentDefinition,
  rawValues: readonly string[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  redactRaw = false,
  source: ValueSource = 'cli',
  tokenIndices?: readonly number[],
  tokenIndex?: number,
): void {
  storeParsedValues(
    argument,
    rawValues.map((raw, index) =>
      parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        argument.parser,
        redactRaw,
        tokenIndices?.[index],
      )
    ),
    display,
    definition,
    path,
    state,
    source,
    tokenIndex ?? tokenIndices?.[0],
  );
}

function storeParsedValues(
  argument: ArgumentDefinition,
  values: readonly unknown[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  source: ValueSource = 'cli',
  tokenIndex?: number,
): void {
  const collectsValues = argument.repeatable
    || argument.trailingVarArg
    || argument.maxValues !== 1;
  const previousSource = state.sources.get(argument.name);
  if (previousSource !== source && previousSource !== undefined) {
    state.values[argument.name] = collectsValues ? [] : undefined;
    state.provided.delete(argument.name);
    state.cliProvided.delete(argument.name);
    delete state.valueCounts[argument.name];
  }
  if (
    argument.kind === 'option'
    && !argument.repeatable
    && source === 'cli'
    && state.cliProvided.has(argument.name)
  ) {
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${display}' cannot be used more than once`,
      definition,
      path,
      [],
      {
        argumentName: argument.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }

  if (collectsValues) {
    const current = state.values[argument.name];
    if (current === undefined) {
      state.values[argument.name] = [...values];
    } else if (Array.isArray(current)) {
      current.push(...values);
    } else {
      throw new Error(`Internal parser state for '${argument.name}' is not an array`);
    }
  } else if (values.length > 0) {
    state.values[argument.name] = values[0];
  }
  state.valueCounts[argument.name] = (state.valueCounts[argument.name] ?? 0) + values.length;
  state.provided.add(argument.name);
  state.sources.set(argument.name, source);
  if (source === 'cli' && tokenIndex !== undefined) {
    state.tokenIndices.set(argument.name, tokenIndex);
  }
  if (source === 'cli') {
    state.cliProvided.add(argument.name);
  }
}

function storeSwitch(
  argument: ArgumentDefinition,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
  explicitValue?: boolean,
  tokenIndex?: number,
): void {
  if (
    argument.action === ArgumentAction.Help
    || argument.action === ArgumentAction.HelpShort
    || argument.action === ArgumentAction.HelpLong
  ) {
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
      output: renderHelp(
        definition,
        path,
        inheritedArguments,
        argument.action !== ArgumentAction.HelpShort,
      ),
    });
  }
  if (argument.action === ArgumentAction.Version) {
    if (definition.version === undefined) {
      throw new TypeError(
        `Command '${path.join(' ')}' must define a version for '${display}'`,
      );
    }
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Version,
      output: `${definition.name} ${definition.version}\n`,
    });
  }
  const previousSource = state.sources.get(argument.name);
  if (!state.cliProvided.has(argument.name)) {
    state.provided.delete(argument.name);
    state.cliProvided.delete(argument.name);
    delete state.valueCounts[argument.name];
  }
  if (
    argument.action === ArgumentAction.SetTrue
    || argument.action === ArgumentAction.SetFalse
  ) {
    if (state.cliProvided.has(argument.name)) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `argument '${display}' cannot be used more than once`,
        definition,
        path,
        inheritedArguments,
        {
          argumentName: argument.name,
          ...(tokenIndex === undefined ? {} : { tokenIndex }),
        },
      );
    }
    const value = explicitValue ?? argument.action === ArgumentAction.SetTrue;
    state.values[argument.name] = argument.color && Bun.env.NO_COLOR !== undefined
      ? false
      : value;
    if (argument.color) {
      state.session.colorMode = state.values[argument.name] === true
        ? 'always'
        : 'never';
    }
  } else if (argument.action === ArgumentAction.Count) {
    const current = state.values[argument.name];
    state.values[argument.name] = previousSource === 'cli' && typeof current === 'number'
      ? current + 1
      : 1;
  } else {
    throw new Error(`Action '${argument.action}' is not a switch action`);
  }
  state.provided.add(argument.name);
  state.sources.set(argument.name, argument.color && Bun.env.NO_COLOR !== undefined ? 'env' : 'cli');
  if (tokenIndex !== undefined) {
    state.tokenIndices.set(argument.name, tokenIndex);
  }
  state.cliProvided.add(argument.name);
}

function parseWith(
  argument: ArgumentDefinition,
  raw: string,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  overrideParser = argument.parser,
  redactRaw = false,
  tokenIndex?: number,
): unknown {
  if (overrideParser === undefined) {
    throw new Error(`Argument '${argument.name}' has no value parser`);
  }
  try {
    const parsed = overrideParser.parse(raw);
    if (parsed === undefined) {
      throw new TypeError('a value parser returned undefined');
    }
    return parsed;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw commandError(
      ErrorKind.InvalidValue,
      redactRaw
        ? `invalid value for '${display}'`
        : `invalid value '${raw}' for '${display}': ${detail}`,
      definition,
      path,
      [],
      {
        argumentName: argument.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
}

function validateParsedValues(
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
  subcommandConflict: ArgumentDefinition | undefined,
): void {
  const missingArguments = definition.arguments.filter(
    (argument) => argument.presence === 'required' && !state.provided.has(argument.name),
  );
  const firstMissing = missingArguments[0];
  if (firstMissing !== undefined) {
    const missing = missingArguments.map(displayArgument);
    throw commandError(
      ErrorKind.MissingRequiredArgument,
      `the following required arguments were not provided: ${missing.join(', ')}`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: firstMissing.name,
        relatedArguments: missingArguments.slice(1).map(({ name }) => name),
      },
    );
  }
  const tooShort = definition.arguments.find(
    (argument) =>
      (argument.kind === 'option' || argument.kind === 'positional')
      && state.provided.has(argument.name)
      && (state.valueCounts[argument.name] ?? 0) < argument.minValues,
  );
  if (tooShort !== undefined) {
    const tokenIndex = state.tokenIndices.get(tooShort.name);
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${displayArgument(tooShort)}' requires at least ${tooShort.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: tooShort.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
  if (
    definition.argRequiredElseHelp
    && state.provided.size === 0
    && state.subcommand === undefined
  ) {
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
      output: renderHelp(definition, path, inheritedArguments),
    });
  }
  if (definition.subcommandRequired && state.subcommand === undefined) {
    throw commandError(
      ErrorKind.MissingSubcommand,
      'a subcommand is required but one was not provided',
      definition,
      path,
      inheritedArguments,
    );
  }
  validateRelations(definition, path, state, inheritedArguments);
  if (subcommandConflict !== undefined && state.subcommand !== undefined) {
    const tokenIndex = state.tokenIndices.get(subcommandConflict.name);
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${displayArgument(subcommandConflict)}' cannot be used with subcommand '${state.subcommand.name}'`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: subcommandConflict.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
}
