import {
  ArgumentAction,
  type ArgumentDefinition,
} from '../../argument/index.js';
import {
  readEnv,
  type Environment,
} from '../../command/environment.js';
import {
  defaultArgument,
  environmentPolicy,
  hasCommandLineInput,
  recordSuppliedArgument,
  restoreArgumentDefault,
  suppliedArgument,
  type ArgumentValues,
} from '../../command/parsing/argument-state.js';
import {
  argumentLongNames,
  commandWords,
  isNegativeNumberToken,
  literalWords,
  matchSubcommand,
  optionAcceptsMoreValues,
  parseLongOptionToken,
  parseShortOptionCluster,
  recognizeOptionValue,
  recognizeWord,
  splitArgumentValue,
  type OptionValueState,
} from '../../command/parsing/recognition.js';
import {
  applyConditionalDefaults,
  applyOverrides,
} from '../../command/parsing/relations.js';
import type { CommandDefinition } from '../../command/schema.js';
import type {
  CommandConfig,
  ConfigValue,
} from '../../configuration/shape.js';
import { prepareConfigValue } from '../../configuration/value.js';
import type {
  ScanState,
  ValueTarget,
} from './types.js';

export function createScanState(
  root: CommandDefinition,
  env: Environment,
  config: CommandConfig | undefined,
): ScanState {
  const state: ScanState = {
    active: {
      command: root,
      commandPath: [root.name],
      inheritedGlobals: [],
      positionalIndex: 0,
      argvState: commandWords,
      config,
    },
    env,
    owners: new Map(),
    scopes: new Map(),
    values: {},
    argumentStates: new Map(),
    rawValues: {},
  };
  for (const argument of root.arguments) {
    state.owners.set(argument.name, root);
  }
  initializeArguments(root.arguments, state);
  return state;
}

export function finalizeRelations(state: ScanState): void {
  finalizeScope(
    state.active.command,
    state,
    state,
    state.active.config,
    state.active.inheritedGlobals,
  );
  for (const [definition, scope,] of [...state.scopes].reverse()) {
    // Globals can be supplied after a child is selected. Resolve the parent's
    // rules using those final values and its saved, unshadowed local values.
    const globals = [
      ...scope.inheritedGlobals,
      ...definition.arguments.filter(({ global }) => global),
    ];
    for (const argument of globals) {
      if (isVisibleArgument(state, argument)) {
        copyArgument(state, scope, argument.name);
      }
    }
    finalizeScope(definition, scope, state, scope.config, scope.inheritedGlobals);
    for (const argument of scope.inheritedGlobals) {
      if (isVisibleArgument(state, argument)) {
        copyArgument(scope, state, argument.name);
      }
    }
    for (const { name } of definition.arguments) {
      if (state.owners.get(name) === definition) {
        copyArgument(scope, state, name);
      }
    }
  }
}

function isVisibleArgument(state: ScanState, argument: ArgumentDefinition): boolean {
  return state.owners.get(argument.name)?.arguments.includes(argument) === true;
}

function finalizeScope(
  definition: CommandDefinition,
  target: ArgumentValues,
  state: ScanState,
  config: CommandConfig | undefined,
  inheritedGlobals: readonly ArgumentDefinition[],
): void {
  const overriddenTargets = new Set(
    definition.overrides
      .filter(({ source }) => hasCommandLineInput(target, source))
      .map(({ target: name }) => name),
  );
  for (const argument of definition.arguments) {
    if (
      argument.env === undefined
      || hasCommandLineInput(target, argument.name)
      || overriddenTargets.has(argument.name)
    ) {
      continue;
    }
    const raw = readEnv(state.env, argument.env);
    if (raw !== undefined) {
      const visibleRawValues = state.owners.get(argument.name) === definition ? state.rawValues : undefined;
      applyEnvironmentValue(argument, raw, target, visibleRawValues);
    }
  }
  applyConfigValues(definition, config, target, state, inheritedGlobals, overriddenTargets);
  applyConditionalDefaults(definition, target, state.env);
  applyOverrides(definition, target, state.env);
}

function applyEnvironmentValue(
  argument: ArgumentDefinition,
  raw: string,
  target: ArgumentValues,
  visibleRawValues: ScanState['rawValues'] | undefined,
): void {
  if (argument.kind === 'flag') {
    if (argument.color) {
      target.values[argument.name] = false;
      target.argumentStates.set(argument.name, environmentPolicy);
    } else {
      target.values[argument.name] = argument.action === ArgumentAction.SetTrue;
      recordSuppliedArgument(target, argument.name, 'env');
    }
    return;
  }
  if (argument.kind === 'count') {
    const count = Number(raw);
    if (Number.isSafeInteger(count) && count >= 0) {
      target.values[argument.name] = count;
      recordSuppliedArgument(target, argument.name, 'env');
    }
    return;
  }

  const values = splitValue(argument, raw);
  target.argumentStates.set(argument.name, { kind: 'unparsed', input: 'env' });
  if (visibleRawValues !== undefined) {
    visibleRawValues[argument.name] = [...values];
  }
  target.values[argument.name] = collectsValues(argument) ? [] : undefined;
  const parsed = parseCompletionValues(argument, values);
  if (parsed.length > 0) {
    storeCompletedValues(argument, parsed, target, 'env');
  }
}

function applyConfigValues(
  definition: CommandDefinition,
  config: CommandConfig | undefined,
  target: ArgumentValues,
  state: ScanState,
  inheritedGlobals: readonly ArgumentDefinition[],
  overriddenTargets: ReadonlySet<string>,
): void {
  if (config?.values === undefined) {
    return;
  }
  for (const [name, value,] of Object.entries(config.values)) {
    const localArgument = definition.arguments.find(({ name: argumentName }) => argumentName === name);
    const argument = localArgument
      ?? inheritedGlobals.find(({ name: argumentName }) => argumentName === name);
    if (
      argument === undefined
      || hasCommandLineInput(target, name)
      || target.argumentStates.get(name)?.source === 'env'
      || target.argumentStates.get(name)?.source === 'config'
      || hasEnvironmentValue(state.env, argument)
      || overriddenTargets.has(name)
    ) {
      continue;
    }
    const visible = localArgument === undefined
      ? isVisibleArgument(state, argument)
      : state.owners.get(name) === definition;
    applyConfigValue(argument, value, target, state, visible);
  }
}

function hasEnvironmentValue(env: Environment, argument: ArgumentDefinition): boolean {
  return argument.env !== undefined && readEnv(env, argument.env) !== undefined;
}

function applyConfigValue(
  argument: ArgumentDefinition,
  value: ConfigValue,
  target: ArgumentValues,
  state: ScanState,
  visibleRawValues: boolean,
): void {
  const prepared = prepareConfigValue(argument, value);
  if (prepared.kind === 'error') {
    return;
  }
  if (prepared.kind === 'switch') {
    target.values[argument.name] = prepared.value;
    recordSuppliedArgument(target, argument.name, 'config');
    return;
  }
  target.values[argument.name] = collectsValues(argument) ? [] : undefined;
  if (visibleRawValues) {
    state.rawValues[argument.name] = [...prepared.values];
  }
  storeCompletedValues(argument, parseCompletionValues(argument, prepared.values), target, 'config');
}

function copyArgument(from: ArgumentValues, to: ArgumentValues, name: string): void {
  to.values[name] = from.values[name];
  const argument = from.argumentStates.get(name);
  if (argument === undefined) {
    to.argumentStates.delete(name);
  } else {
    to.argumentStates.set(name, argument);
  }
}

function initializeArguments(
  argumentsToInitialize: readonly ArgumentDefinition[],
  state: ScanState,
): void {
  for (const argument of argumentsToInitialize) {
    delete state.rawValues[argument.name];
    if (argument.color) {
      const disabled = readEnv(state.env, 'NO_COLOR') !== undefined;
      state.values[argument.name] = !disabled
        && process.stdout.isTTY === true
        && readEnv(state.env, 'TERM') !== 'dumb';
      state.argumentStates.set(argument.name, disabled ? environmentPolicy : defaultArgument);
    } else {
      restoreArgumentDefault(state, argument);
    }
  }
}

export function scanWords(state: ScanState, words: readonly string[]): void {
  const isSubcommand = (word: string): boolean => resolveSubcommand(state.active.command, word) !== undefined;
  for (const word of words) {
    if (word === undefined) {
      break;
    }

    let argvState = state.active.argvState;
    if (argvState.kind === 'option-values') {
      const action = recognizeOptionValue(argvState, word, isSubcommand);
      if (action === 'take-value') {
        consumePending(state, argvState, word);
        continue;
      }
      finishPendingOption(state, argvState);
      argvState = commandWords;
      if (action === 'take-terminator') {
        continue;
      }
    }

    const consumeAsPositional = argvState.kind === 'command' && acceptsOptionLookingPositional(state, word);
    const kind = recognizeWord(argvState, word, consumeAsPositional);
    if (kind === 'end-options') {
      state.active.argvState = literalWords;
      continue;
    }
    if (kind === 'long-option') {
      scanLongOption(state, word);
      continue;
    }
    if (kind === 'short-options') {
      scanShortOptions(state, word);
      continue;
    }

    if (kind === 'command-word') {
      const child = resolveSubcommand(state.active.command, word);
      if (child !== undefined) {
        enterSubcommand(state, child);
        continue;
      }
    }

    const positional = currentPositional(state);
    if (positional !== undefined) {
      if (word === positional.valueTerminator) {
        state.active.positionalIndex += 1;
      } else {
        const count = storeArgumentValues(positional, splitValue(positional, word), state);
        if (
          !positional.repeatable
          && positional.maxValues !== null
          && count >= positional.maxValues
        ) {
          state.active.positionalIndex += 1;
        }
        if (positional.trailingVarArg) {
          state.active.argvState = literalWords;
        }
      }
    }
  }
}

/** Resolves the pending option state at the boundary before the cursor word. */
export function resolvePendingWordBoundary(state: ScanState, currentWord: string): void {
  const pending = state.active.argvState;
  if (pending.kind !== 'option-values') {
    return;
  }
  const action = recognizeOptionValue(
    pending,
    currentWord,
    (word) => resolveSubcommand(state.active.command, word) !== undefined,
  );
  if (action === 'take-value') {
    return;
  }
  finishPendingOption(state, pending);
}

function finishPendingOption(state: ScanState, pending: OptionValueState): void {
  if (pending.consumed === 0) {
    storeDefaultMissing(pending.argument, state);
  }
  state.active.argvState = commandWords;
}

export function activeArguments(state: ScanState): readonly ArgumentDefinition[] {
  return [...state.active.command.arguments, ...state.active.inheritedGlobals];
}

function activeNamedArgument(
  state: ScanState,
  long: string,
): ArgumentDefinition | undefined {
  return activeArguments(state).find(
    (argument) =>
      argument.kind !== 'positional'
      && argumentLongNames(argument).includes(long),
  );
}

function activeShortArgument(
  state: ScanState,
  short: string,
): ArgumentDefinition | undefined {
  return activeArguments(state).find(
    (argument) => argument.kind !== 'positional' && argument.short === short,
  );
}

function scanLongOption(state: ScanState, word: string): void {
  const { name, inlineValue } = parseLongOptionToken(word);
  const argument = activeNamedArgument(state, name);
  if (argument === undefined) {
    return;
  }
  if (argument.kind === 'flag' || argument.kind === 'count') {
    storeSwitch(argument, state, argument.negativeLong === name ? false : undefined);
    return;
  }

  if (inlineValue === undefined && argument.requireEquals) {
    storeDefaultMissing(argument, state);
    return;
  }
  const inlineValues = inlineValue === undefined
    ? []
    : splitArgumentValue(argument, inlineValue);
  if (inlineValues.length > 0) {
    storeArgumentValues(argument, inlineValues, state);
  }
  const consumed = inlineValues.length;
  setPending(state, argument, consumed);
}

function scanShortOptions(state: ScanState, word: string): void {
  const cluster = parseShortOptionCluster(word);
  for (const [index, short,] of cluster.entries()) {
    const argument = activeShortArgument(state, short);
    if (argument === undefined) {
      return;
    }
    if (argument.kind === 'flag' || argument.kind === 'count') {
      storeSwitch(argument, state);
      continue;
    }

    const inlineSource = cluster.slice(index + 1).join('');
    const hasInlineValue = inlineSource.length > 0;
    let inline = inlineSource;
    if (inline.startsWith('=')) {
      inline = inline.slice(1);
    }
    if (!hasInlineValue && argument.requireEquals) {
      storeDefaultMissing(argument, state);
      return;
    }
    const inlineValues = hasInlineValue ? splitValue(argument, inline) : [];
    if (inlineValues.length > 0) {
      storeArgumentValues(argument, inlineValues, state);
    }
    const consumed = inlineValues.length;
    setPending(state, argument, consumed);
    return;
  }
}

function setPending(
  state: ScanState,
  argument: ArgumentDefinition,
  consumed: number,
): void {
  const optionState: OptionValueState = { kind: 'option-values', argument, consumed };
  if (optionAcceptsMoreValues(optionState)) {
    state.active.argvState = optionState;
  } else if (consumed === 0) {
    storeDefaultMissing(argument, state);
  }
}

function storeDefaultMissing(
  argument: ArgumentDefinition,
  state: ScanState,
): void {
  if (!argument.hasDefaultMissingValue && argument.minValues > 0) {
    return;
  }
  beginArgumentInput(argument, state, true);
  storeCompletedValues(argument, argument.hasDefaultMissingValue ? [argument.defaultMissingValue] : [], state, 'cli');
}

function consumePending(
  state: ScanState,
  pending: OptionValueState,
  word: string,
): void {
  const values = splitValue(pending.argument, word);
  storeArgumentValues(pending.argument, values, state, pending.consumed === 0);
  pending.consumed += values.length;
  if (!optionAcceptsMoreValues(pending)) {
    state.active.argvState = commandWords;
  }
}

function acceptsOptionLookingPositional(state: ScanState, token: string): boolean {
  const argument = currentPositional(state);
  if (
    argument === undefined
    || token === '--'
    || token === '-'
    || !token.startsWith('-')
    || hasDeclaredOption(state, token)
  ) {
    return false;
  }
  return argument.allowHyphenValues
    || (argument.allowNegativeNumbers && isNegativeNumberToken(token));
}

function hasDeclaredOption(state: ScanState, token: string): boolean {
  if (token.startsWith('--')) {
    const equalsIndex = token.indexOf('=');
    const name = token.slice(2, equalsIndex < 0 ? undefined : equalsIndex);
    return activeNamedArgument(state, name) !== undefined
      || (!state.active.command.disableHelpFlag && token === '--help')
      || (
        !state.active.command.disableVersionFlag
        && state.active.command.version !== undefined
        && token === '--version'
      );
  }
  const short = token[1];
  return short !== undefined
    && (
      activeShortArgument(state, short) !== undefined
      || (!state.active.command.disableHelpFlag && token === '-h')
      || (
        !state.active.command.disableVersionFlag
        && state.active.command.version !== undefined
        && token === '-V'
      )
    );
}

function splitValue(
  argument: ArgumentDefinition,
  raw: string,
): readonly string[] {
  return splitArgumentValue(argument, raw);
}

function storeArgumentValues(
  argument: ArgumentDefinition,
  rawValues: readonly string[],
  state: ScanState,
  occurrenceStart = true,
): number {
  beginArgumentInput(argument, state, occurrenceStart);
  const storedRaw = state.rawValues[argument.name] ?? [];
  storedRaw.push(...rawValues);
  state.rawValues[argument.name] = storedRaw;

  const parsed = parseCompletionValues(argument, rawValues);
  if (parsed.length > 0) {
    storeCompletedValues(argument, parsed, state, 'cli');
  }
  return storedRaw.length;
}

function parseCompletionValues(argument: ArgumentDefinition, rawValues: readonly string[]): unknown[] {
  const parsed: unknown[] = [];
  for (const raw of rawValues) {
    try {
      const value = argument.parser === undefined ? raw : argument.parser.parse(raw);
      if (value !== undefined) {
        parsed.push(value);
      }
    } catch {
      // Completion must continue when a partial value cannot be parsed yet.
    }
  }
  return parsed;
}

function beginArgumentInput(
  argument: ArgumentDefinition,
  state: ScanState,
  occurrenceStart: boolean,
): void {
  if (!hasCommandLineInput(state, argument.name) || (occurrenceStart && shouldOverrideSelf(argument, state))) {
    state.argumentStates.set(argument.name, { kind: 'unparsed', input: 'cli' });
    state.rawValues[argument.name] = [];
    state.values[argument.name] = collectsValues(argument) ? [] : undefined;
  }
}

function storeCompletedValues(
  argument: ArgumentDefinition,
  parsed: readonly unknown[],
  state: ArgumentValues,
  input: 'cli' | 'env' | 'config',
): void {
  if (parsed.length > 0) {
    if (collectsValues(argument)) {
      const current = state.values[argument.name];
      state.values[argument.name] = [...(Array.isArray(current) ? current : []), ...parsed];
    } else {
      state.values[argument.name] = parsed.at(-1);
    }
  }
  const previousCount = suppliedArgument(state, argument.name)?.valueCount ?? 0;
  recordSuppliedArgument(state, argument.name, input, { valueCount: previousCount + parsed.length });
}

function shouldOverrideSelf(
  argument: ArgumentDefinition,
  state: ScanState,
): boolean {
  return argument.kind === 'option'
    && !argument.repeatable
    && state.owners.get(argument.name)?.argsOverrideSelf === true;
}

function collectsValues(argument: ArgumentDefinition): boolean {
  return argument.repeatable
    || argument.trailingVarArg
    || argument.maxValues === null
    || argument.maxValues !== 1;
}

function storeSwitch(
  argument: ArgumentDefinition,
  state: ScanState,
  explicitValue?: boolean,
): void {
  const firstCliValue = !hasCommandLineInput(state, argument.name);
  const colorDisabled = argument.color && readEnv(state.env, 'NO_COLOR') !== undefined;
  if (argument.kind === 'flag') {
    const value = explicitValue ?? argument.action !== 'setFalse';
    state.values[argument.name] = colorDisabled ? false : value;
  } else {
    const current = state.values[argument.name];
    state.values[argument.name] = !firstCliValue && typeof current === 'number'
      ? current + 1
      : 1;
  }
  recordSuppliedArgument(state, argument.name, 'cli', { source: colorDisabled ? 'env' : 'cli' });
}

function resolveSubcommand(
  definition: CommandDefinition,
  token: string,
): CommandDefinition | undefined {
  const match = matchSubcommand(definition, token);
  return match.kind === 'exact' || match.kind === 'unique'
    ? match.command
    : undefined;
}

function enterSubcommand(state: ScanState, child: CommandDefinition): void {
  const parent = state.active;
  state.scopes.set(parent.command, {
    values: { ...state.values },
    argumentStates: new Map(state.argumentStates),
    config: parent.config,
    inheritedGlobals: parent.inheritedGlobals,
  });
  state.active = {
    command: child,
    commandPath: [...parent.commandPath, child.name],
    inheritedGlobals: [...parent.inheritedGlobals, ...parent.command.arguments.filter(({ global }) => global)],
    positionalIndex: 0,
    argvState: commandWords,
    config: parent.config?.subcommands?.[child.name],
  };
  for (const argument of child.arguments) {
    state.owners.set(argument.name, child);
  }
  initializeArguments(child.arguments, state);
}

export function currentPositional(state: ScanState): ArgumentDefinition | undefined {
  return state.active.command.arguments.filter(
    ({ kind }) => kind === 'positional',
  )[state.active.positionalIndex];
}

export function findValueTarget(
  state: ScanState,
  currentWord: string,
): ValueTarget | undefined {
  const argvState = state.active.argvState;
  if (argvState.kind === 'option-values') {
    return valueTarget(argvState.argument, currentWord, '');
  }
  if (argvState.kind === 'literal') {
    return currentPositionalTarget(state, currentWord);
  }
  if (acceptsOptionLookingPositional(state, currentWord)) {
    return currentPositionalTarget(state, currentWord);
  }

  if (currentWord.startsWith('--')) {
    const equalsIndex = currentWord.indexOf('=');
    if (equalsIndex >= 0) {
      const argument = activeNamedArgument(state, currentWord.slice(2, equalsIndex));
      if (argument?.kind === 'option') {
        return valueTarget(
          argument,
          currentWord.slice(equalsIndex + 1),
          currentWord.slice(0, equalsIndex + 1),
        );
      }
    }
    return undefined;
  }

  if (currentWord.startsWith('-') && currentWord !== '-') {
    const cluster = currentWord.slice(1);
    for (let index = 0; index < cluster.length; index += 1) {
      const short = cluster.charAt(index);
      const argument = activeShortArgument(state, short);
      if (argument === undefined) {
        break;
      }
      if (argument.kind !== 'option') {
        continue;
      }
      const prefixEnd = cluster[index + 1] === '=' ? index + 3 : index + 2;
      const outputPrefix = currentWord.slice(0, prefixEnd);
      return valueTarget(argument, currentWord.slice(prefixEnd), outputPrefix);
    }
    return undefined;
  }

  return undefined;
}

function currentPositionalTarget(
  state: ScanState,
  currentWord: string,
): ValueTarget | undefined {
  const argument = currentPositional(state);
  return argument === undefined ? undefined : valueTarget(argument, currentWord, '');
}

function valueTarget(
  argument: ArgumentDefinition,
  current: string,
  outputPrefix: string,
): ValueTarget {
  if (argument.valueDelimiter === undefined) {
    return { argument, current, outputPrefix };
  }
  const delimiterIndex = current.lastIndexOf(argument.valueDelimiter);
  if (delimiterIndex < 0) {
    return { argument, current, outputPrefix };
  }
  return {
    argument,
    current: current.slice(delimiterIndex + argument.valueDelimiter.length),
    outputPrefix: `${outputPrefix}${current.slice(0, delimiterIndex + 1)}`,
  };
}
