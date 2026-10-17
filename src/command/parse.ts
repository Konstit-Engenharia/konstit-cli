import {
  ArgumentAction,
  type ArgumentDefinition,
} from '../argument.js';
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
  commandError,
  displayArgument,
  renderHelp,
  suggestToken,
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
  colorMode?: ColorMode;
}

export const outputColorModes = new WeakMap<object, ColorMode>();

export function parseConfigured<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  defaultColor: boolean,
): ParseOutcome<Value> {
  const session: ParseSession = { defaultColor };
  try {
    const value = parseDefinition(
      definition,
      [...argv],
      [definition.name],
      [],
      session,
    ) as Value;
    return { ok: true, type: 'value', value };
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
    throw error;
  }
}

export function tryParseConfigured<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  defaultColor: boolean,
): ParseResult<Value> {
  try {
    return parseConfigured<Value>(definition, argv, defaultColor);
  } catch (error) {
    if (error instanceof CliError) {
      return { ok: false, type: 'error', error };
    }
    throw error;
  }
}

interface ParseState extends RelationState {
  readonly session: ParseSession;
  positionalIndex: number;
  subcommand?: { readonly name: string; readonly args: Record<string, unknown>; };
}

interface GlobalBinding {
  readonly argument: ArgumentDefinition;
  readonly state: ParseState;
}

function parseDefinition(
  definition: CommandDefinition,
  argv: string[],
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
  session: ParseSession,
): Record<string, unknown> {
  const state: ParseState = {
    values: {},
    provided: new Set(),
    cliProvided: new Set(),
    valueCounts: {},
    session,
    positionalIndex: 0,
  };
  const positionals = definition.arguments.filter(({ kind }) => kind === 'positional');
  initializeValues(definition, state);
  validateGlobalArguments(definition, inheritedGlobals);
  const localGlobals = definition.arguments
    .filter(({ global }) => global)
    .map((argument) => ({ argument, state }));
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
            path,
            inheritedGlobals,
          ),
        });
      }
      const child = resolveSubcommand(definition, token, path, inheritedGlobals);
      if (child !== undefined) {
        state.subcommand = Object.freeze({
          name: child.name,
          args: parseDefinition(
            child,
            argv.slice(index + 1),
            [...path, child.name],
            globals,
            session,
          ),
        });
        index = argv.length;
        break;
      }
    }

    if (positionalArgument === undefined) {
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
      );
    }
    if (positionalArgument.valueTerminator === token) {
      state.positionalIndex += 1;
      index += 1;
      continue;
    }
    storePositionalValue(positionalArgument, token, definition, path, state);
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
  applyOverrides(definition, state);
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
  return Object.freeze(state.values);
}

function initializeValues(
  definition: CommandDefinition,
  state: ParseState,
): void {
  for (const argument of definition.arguments) {
    if (argument.color) {
      const disabled = Bun.env.NO_COLOR !== undefined;
      state.values[argument.name] = disabled ? false : state.session.defaultColor;
      state.session.colorMode = disabled ? 'never' : 'auto';
    } else if (argument.repeatable || argument.trailingVarArg) {
      state.values[argument.name] = [];
    } else if (argument.presence === 'default') {
      state.values[argument.name] = argument.defaultValue;
    } else {
      state.values[argument.name] = undefined;
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
        );
      }
      state.values[argument.name] = count;
      state.provided.add(argument.name);
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
      );
    }
    storeRawValues(argument, values, display, definition, path, state, true);
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
    ...definition.arguments.map((argument) => ({ argument, state })),
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
): CommandDefinition | undefined {
  return resolveSubcommandWithArguments(
    definition,
    token,
    path,
    inheritedGlobals.map(({ argument }) => argument),
  );
}

function resolveSubcommandWithArguments(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
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
    );
  }
  return undefined;
}

function renderSubcommandHelp(
  definition: CommandDefinition,
  tokens: readonly string[],
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
): string {
  let current = definition;
  let currentPath = [...path];
  let inheritedArguments = inheritedGlobals.map(({ argument }) => argument);

  for (const token of tokens) {
    const globalsForChild = [
      ...inheritedArguments,
      ...current.arguments.filter(({ global }) => global),
    ];
    const child = resolveSubcommandWithArguments(
      current,
      token,
      currentPath,
      globalsForChild,
    );
    if (child === undefined) {
      throw commandError(
        ErrorKind.InvalidSubcommand,
        `unrecognized subcommand '${token}'${suggestToken(token, current, globalsForChild)}`,
        current,
        currentPath,
        inheritedArguments,
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
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const { name, inlineValue } = parseLongOptionToken(token);
  const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
    ({ argument }) => argumentLongNames(argument).includes(name),
  );
  if (binding === undefined || binding.argument.kind === 'positional') {
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
    );
  }
  const { argument } = binding;
  if (argument.kind === 'flag' || argument.kind === 'count') {
    if (inlineValue !== undefined) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '--${name}' does not accept a value`,
        definition,
        path,
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
      );
      return index + 1;
    }
    throw commandError(
      ErrorKind.NoEquals,
      `an equals sign is required for '--${name}=<VALUE>'`,
      definition,
      path,
      inheritedGlobals.map(({ argument }) => argument),
    );
  }
  const consumed = consumeOptionValues(
    argument,
    argv,
    index,
    inlineValue,
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
    );
  } else {
    storeRawValues(
      argument,
      consumed.values,
      `--${name}`,
      definition,
      path,
      binding.state,
    );
  }
  return consumed.nextIndex;
}

function parseShortOptions(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
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
      );
    }
    const { argument } = binding;
    if (argument.kind === 'flag' || argument.kind === 'count') {
      storeSwitch(
        argument,
        `-${short}`,
        definition,
        path,
        binding.state,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
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
        );
        return index + 1;
      }
      throw commandError(
        ErrorKind.NoEquals,
        `an attached value is required for '-${short}<VALUE>'`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
      );
    }
    const consumed = consumeOptionValues(
      argument,
      argv,
      index,
      hasAttachedValue ? attached : undefined,
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
      );
    } else {
      storeRawValues(
        argument,
        consumed.values,
        `-${short}`,
        definition,
        path,
        binding.state,
      );
    }
    return consumed.nextIndex;
  }
  return index + 1;
}

interface ConsumedOptionValues {
  readonly values: readonly string[];
  readonly nextIndex: number;
}

function consumeOptionValues(
  argument: ArgumentDefinition,
  argv: readonly string[],
  optionIndex: number,
  inlineValue: string | undefined,
  definition: CommandDefinition,
  path: readonly string[],
  display: string,
  inheritedArguments: readonly ArgumentDefinition[],
): ConsumedOptionValues {
  const values: string[] = [];
  let rawCount = 0;
  let nextIndex = optionIndex + 1;

  const append = (raw: string): void => {
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
      );
    }
    values.push(...parts);
    rawCount += 1;
  };

  if (inlineValue !== undefined) {
    append(inlineValue);
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
          ) !== undefined
      )
    ) {
      break;
    }
    append(raw);
    nextIndex += 1;
  }

  if (values.length < argument.minValues) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${display}' requires at least ${argument.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
    );
  }
  return { values, nextIndex };
}

function splitRawValue(argument: ArgumentDefinition, raw: string): readonly string[] {
  return splitArgumentValue(argument, raw);
}

function storePositionalValue(
  argument: ArgumentDefinition,
  raw: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
): void {
  const values = splitRawValue(argument, raw);
  const currentCount = state.valueCounts[argument.name] ?? 0;
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
    );
  }
  storeRawValues(argument, values, raw, definition, path, state);
}

function storeRawValues(
  argument: ArgumentDefinition,
  rawValues: readonly string[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  redactRaw = false,
): void {
  storeParsedValues(
    argument,
    rawValues.map((raw) =>
      parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        argument.parser,
        redactRaw,
      )
    ),
    display,
    definition,
    path,
    state,
  );
}

function storeParsedValues(
  argument: ArgumentDefinition,
  values: readonly unknown[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
): void {
  const collectsValues = argument.repeatable
    || argument.trailingVarArg
    || argument.maxValues !== 1;
  if (
    argument.env !== undefined
    && state.provided.has(argument.name)
    && !state.cliProvided.has(argument.name)
  ) {
    state.values[argument.name] = collectsValues ? [] : undefined;
    state.provided.delete(argument.name);
    delete state.valueCounts[argument.name];
  }
  if (
    argument.kind === 'option'
    && !argument.repeatable
    && state.cliProvided.has(argument.name)
  ) {
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${display}' cannot be used more than once`,
      definition,
      path,
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
  state.cliProvided.add(argument.name);
}

function storeSwitch(
  argument: ArgumentDefinition,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
  explicitValue?: boolean,
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
  if (
    argument.env !== undefined
    && state.provided.has(argument.name)
    && !state.cliProvided.has(argument.name)
  ) {
    state.values[argument.name] = argument.defaultValue;
    state.provided.delete(argument.name);
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
    state.values[argument.name] = typeof current === 'number' ? current + 1 : 1;
  } else {
    throw new Error(`Action '${argument.action}' is not a switch action`);
  }
  state.provided.add(argument.name);
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
  const missing = definition.arguments
    .filter((argument) => argument.presence === 'required' && !state.provided.has(argument.name))
    .map(displayArgument);
  if (missing.length > 0) {
    throw commandError(
      ErrorKind.MissingRequiredArgument,
      `the following required arguments were not provided: ${missing.join(', ')}`,
      definition,
      path,
      inheritedArguments,
    );
  }
  const tooShort = definition.arguments.find(
    (argument) =>
      (argument.kind === 'option' || argument.kind === 'positional')
      && state.provided.has(argument.name)
      && (state.valueCounts[argument.name] ?? 0) < argument.minValues,
  );
  if (tooShort !== undefined) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${displayArgument(tooShort)}' requires at least ${tooShort.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
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
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${displayArgument(subcommandConflict)}' cannot be used with subcommand '${state.subcommand.name}'`,
      definition,
      path,
      inheritedArguments,
    );
  }
}
