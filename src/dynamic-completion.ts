import {
  ArgumentAction,
  type ArgumentDefinition,
} from './argument.js';
import {
  getCommandDefinition,
  type CommandDefinition,
  type CommandType,
} from './command.js';
import {
  defaultArgument,
  environmentPolicy,
  hasCommandLineInput,
  recordSuppliedArgument,
  restoreArgumentDefault,
  suppliedArgument,
  type ArgumentValues,
} from './command/argument-state.js';
import {
  writeOutput,
  type OutputWriter,
} from './command/output.js';
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
  type ArgvState,
  type OptionValueState,
} from './command/recognition.js';
import {
  applyConditionalDefaults,
  applyOverrides,
  type RelationState,
} from './command/relations.js';
import type { CompletionValueHint } from './parser.js';

/** A completion returned by a dynamic provider. */
export interface DynamicCompletionCandidate {
  /** The text offered as a completion. */
  readonly value: string;
  /** An optional label displayed by shells that support candidate descriptions. */
  readonly description?: string;
}

/** A completion supplied as plain text or as a value with a description. */
export type DynamicCompletionCandidateInput =
  | string
  | DynamicCompletionCandidate;

/** Parsed values and defaults keyed by argument name. */
export type DynamicCompletionValues = Readonly<Record<string, unknown>>;
/** Unparsed values keyed by argument name, in the order they were collected. */
export type DynamicCompletionRawValues = Readonly<
  Record<string, readonly string[]>
>;

/** Data available to an argument completion provider. */
export interface DynamicCompletionContext<
  out Values extends DynamicCompletionValues = DynamicCompletionValues,
> {
  /** All words supplied to the resolver, excluding the executable. */
  readonly argv: readonly string[];
  /** Index of the word being completed. */
  readonly cursor: number;
  /** The value fragment being completed, without an inline option prefix. */
  readonly current: string;
  /** Canonical command names from the root to the active command. */
  readonly commandPath: readonly string[];
  /** The normalized definition of the active command. */
  readonly command: CommandDefinition;
  /** The normalized definition of the argument whose value is being completed. */
  readonly argument: ArgumentDefinition;
  /** Defaults and successfully parsed words visible at the active command. */
  readonly values: Values;
  /** Raw values collected before the current word. */
  readonly rawValues: DynamicCompletionRawValues;
}

/** Candidates yielded synchronously or asynchronously by a value completer. */
export type DynamicCompletionIterable =
  | Iterable<DynamicCompletionCandidateInput>
  | AsyncIterable<DynamicCompletionCandidateInput>;

/** A synchronous, asynchronous, or async-iterable value completer. */
export type DynamicCompletionProvider<
  in Values extends DynamicCompletionValues = DynamicCompletionValues,
> = (
  context: DynamicCompletionContext<Values>,
) => DynamicCompletionIterable | PromiseLike<DynamicCompletionIterable>;

/** Settings for resolving completions at a given word. */
export interface DynamicCompletionOptions {
  /**
   * Index of the word being completed. It can equal argv.length to represent
   * a new empty word. The default is the final argv word, or zero for [].
   */
  readonly cursor?: number;
  /** Applies prefix filtering to provider and static values. The default is true. */
  readonly filter?: boolean;
}

/** The candidates and context resolved for one completion request. */
export interface DynamicCompletionResult {
  /** The suggestions to offer for the current word. */
  readonly candidates: readonly DynamicCompletionCandidate[];
  /** Canonical command names from the root to the active command. */
  readonly commandPath: readonly string[];
  /** The word or value fragment used to resolve candidates. */
  readonly current: string;
  /** The argument being completed, when the word can contain an argument value. */
  readonly argument?: ArgumentDefinition;
  /** The file or directory hint available for value completion. */
  readonly valueHint?: CompletionValueHint;
}

/** Internal inputs used by Command.run for one shell completion request. */
export interface DynamicCompletionRequestOptions {
  /** Arguments after the executable, including the incomplete word. */
  readonly argv?: readonly string[];
  /** Index of the incomplete word. Defaults to the final argv item. */
  readonly cursor?: number;
  readonly stdout?: OutputWriter;
}

interface CompletionEnabledArgument extends ArgumentDefinition {
  readonly completion?: DynamicCompletionProvider;
}

interface ScanState extends ArgumentValues {
  command: CommandDefinition;
  commandPath: string[];
  inheritedGlobals: ArgumentDefinition[];
  readonly owners: Map<string, CommandDefinition>;
  readonly scopes: Map<CommandDefinition, RelationState>;
  positionalIndex: number;
  argvState: ArgvState;
  readonly rawValues: Record<string, string[]>;
}

interface ValueTarget {
  readonly argument: ArgumentDefinition;
  readonly current: string;
  readonly outputPrefix: string;
}

/**
 * Resolves one completion request without generating or invoking a shell
 * script. argv excludes the executable and includes the incomplete word.
 */
export async function resolveDynamicCompletion(
  configuredCommand: CommandType,
  argv: readonly string[],
  options: DynamicCompletionOptions = {},
): Promise<DynamicCompletionResult> {
  const cursor = options.cursor ?? (argv.length === 0 ? 0 : argv.length - 1);
  validateCursor(cursor, argv.length);

  const input = Object.freeze([...argv]);
  const currentWord = input[cursor] ?? '';
  const filter = options.filter ?? true;
  const state = createScanState(getCommandDefinition(configuredCommand));
  scanWords(state, input.slice(0, cursor));
  finalizeRelations(state);

  const target = findValueTarget(state, currentWord);
  if (target !== undefined) {
    return completeArgument(
      state,
      target,
      input,
      cursor,
      filter,
    );
  }

  const candidates: DynamicCompletionCandidate[] = [];
  if (state.argvState.kind !== 'literal' && (currentWord.length === 0 || currentWord.startsWith('-'))) {
    candidates.push(...namedCandidates(state));
  }
  if (state.argvState.kind !== 'literal' && !currentWord.startsWith('-')) {
    candidates.push(...subcommandCandidates(state));
    const positional = currentPositional(state);
    if (positional !== undefined) {
      const positionalResult = await completeArgument(
        state,
        { argument: positional, current: currentWord, outputPrefix: '' },
        input,
        cursor,
        filter,
      );
      candidates.push(...positionalResult.candidates);
      return freezeResult({
        candidates: filterAndDedupe(candidates, currentWord, filter),
        commandPath: state.commandPath,
        current: currentWord,
        argument: positional,
        ...(positionalResult.valueHint === undefined
          ? {}
          : { valueHint: positionalResult.valueHint }),
      });
    }
  }

  return freezeResult({
    candidates: filterAndDedupe(candidates, currentWord, filter),
    commandPath: state.commandPath,
    current: currentWord,
  });
}

/** Resolves and writes the shell request detected by Command.run. */
export async function runDynamicCompletionRequest(
  configuredCommand: CommandType,
  options: DynamicCompletionRequestOptions = {},
): Promise<number> {
  const result = await resolveDynamicCompletion(
    configuredCommand,
    options.argv ?? Bun.argv.slice(2),
    options.cursor === undefined ? {} : { cursor: options.cursor },
  );
  if (result.candidates.length > 0) {
    const output = `${
      result.candidates.map(({ value, description }) => `${encodeProtocolField(value)}\t${encodeProtocolField(description ?? '')}`).join(
        '\n',
      )
    }\n`;
    await writeOutput('stdout', output, options.stdout);
  }
  return 0;
}

function validateCursor(cursor: number, argvLength: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > argvLength) {
    throw new RangeError('The completion cursor must be an argv index or argv.length');
  }
}

function createScanState(root: CommandDefinition): ScanState {
  const state: ScanState = {
    command: root,
    commandPath: [root.name],
    inheritedGlobals: [],
    owners: new Map(),
    scopes: new Map(),
    positionalIndex: 0,
    argvState: commandWords,
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

function finalizeRelations(state: ScanState): void {
  for (const [definition, scope,] of state.scopes) {
    // Globals can be supplied after a child is selected. Resolve the parent's
    // rules using those final values and its saved, unshadowed local values.
    for (const { name, global } of definition.arguments) {
      if (global) {
        copyArgument(state, scope, name);
      }
    }
    applyConditionalDefaults(definition, scope);
    applyOverrides(definition, scope);
    for (const { name } of definition.arguments) {
      if (state.owners.get(name) === definition) {
        copyArgument(scope, state, name);
      }
    }
  }
  applyConditionalDefaults(state.command, state);
  applyOverrides(state.command, state);
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
      const disabled = Bun.env.NO_COLOR !== undefined;
      state.values[argument.name] = !disabled
        && process.stdout.isTTY === true
        && Bun.env.TERM !== 'dumb';
      state.argumentStates.set(argument.name, disabled ? environmentPolicy : defaultArgument);
    } else {
      restoreArgumentDefault(state, argument);
    }

    const environmentValue = argument.env === undefined
      ? undefined
      : Bun.env[argument.env];
    if (environmentValue !== undefined) {
      if (argument.kind === 'flag') {
        state.values[argument.name] = argument.color
          ? false
          : argument.action === ArgumentAction.SetTrue;
        recordSuppliedArgument(state, argument.name, 'env');
      } else if (argument.kind === 'count') {
        const count = Number(environmentValue);
        if (Number.isSafeInteger(count) && count >= 0) {
          state.values[argument.name] = count;
          recordSuppliedArgument(state, argument.name, 'env');
        }
      } else {
        storeArgumentValues(
          argument,
          splitValue(argument, environmentValue),
          state,
          'env',
        );
      }
    }
  }
}

function scanWords(state: ScanState, words: readonly string[]): void {
  const isSubcommand = (word: string): boolean => resolveSubcommand(state.command, word) !== undefined;
  for (const word of words) {
    if (word === undefined) {
      break;
    }

    let argvState = state.argvState;
    if (argvState.kind === 'option-values') {
      const action = recognizeOptionValue(argvState, word, isSubcommand);
      if (action === 'take-value') {
        consumePending(state, argvState, word);
        continue;
      }
      if (argvState.consumed === 0) {
        storeDefaultMissing(argvState.argument, state);
      }
      state.argvState = commandWords;
      argvState = commandWords;
      if (action === 'take-terminator') {
        continue;
      }
    }

    const consumeAsPositional = argvState.kind === 'command' && acceptsOptionLookingPositional(state, word);
    const kind = recognizeWord(argvState, word, consumeAsPositional);
    if (kind === 'end-options') {
      state.argvState = literalWords;
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
      const child = resolveSubcommand(state.command, word);
      if (child !== undefined) {
        enterSubcommand(state, child);
        continue;
      }
    }

    const positional = currentPositional(state);
    if (positional !== undefined) {
      if (word === positional.valueTerminator) {
        state.positionalIndex += 1;
      } else {
        const count = storeArgumentValues(positional, splitValue(positional, word), state);
        if (
          !positional.repeatable
          && positional.maxValues !== null
          && count >= positional.maxValues
        ) {
          state.positionalIndex += 1;
        }
        if (positional.trailingVarArg) {
          state.argvState = literalWords;
        }
      }
    }
  }
}

function activeArguments(state: ScanState): readonly ArgumentDefinition[] {
  return [...state.command.arguments, ...state.inheritedGlobals];
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
    state.argvState = optionState;
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
  beginArgumentInput(argument, state, 'cli', true);
  storeCompletedValues(argument, argument.hasDefaultMissingValue ? [argument.defaultMissingValue] : [], state, 'cli');
}

function consumePending(
  state: ScanState,
  pending: OptionValueState,
  word: string,
): void {
  const values = splitValue(pending.argument, word);
  storeArgumentValues(pending.argument, values, state, 'cli', pending.consumed === 0);
  pending.consumed += values.length;
  if (!optionAcceptsMoreValues(pending)) {
    state.argvState = commandWords;
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
      || (!state.command.disableHelpFlag && token === '--help')
      || (
        !state.command.disableVersionFlag
        && state.command.version !== undefined
        && token === '--version'
      );
  }
  const short = token[1];
  return short !== undefined
    && (
      activeShortArgument(state, short) !== undefined
      || (!state.command.disableHelpFlag && token === '-h')
      || (
        !state.command.disableVersionFlag
        && state.command.version !== undefined
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
  input: 'cli' | 'env' = 'cli',
  occurrenceStart = true,
): number {
  beginArgumentInput(argument, state, input, occurrenceStart);
  const storedRaw = state.rawValues[argument.name] ?? [];
  storedRaw.push(...rawValues);
  state.rawValues[argument.name] = storedRaw;

  const parsed: unknown[] = [];
  for (const raw of rawValues) {
    try {
      parsed.push(argument.parser?.parse(raw) ?? raw);
    } catch {
      // Completion must continue when a partial value cannot be parsed yet.
    }
  }
  if (parsed.length > 0) {
    storeCompletedValues(argument, parsed, state, input);
  }
  return storedRaw.length;
}

function beginArgumentInput(
  argument: ArgumentDefinition,
  state: ScanState,
  input: 'cli' | 'env',
  occurrenceStart: boolean,
): void {
  if (input === 'env' || !hasCommandLineInput(state, argument.name) || (occurrenceStart && shouldOverrideSelf(argument, state))) {
    state.argumentStates.set(argument.name, { kind: 'unparsed', input });
    state.rawValues[argument.name] = [];
    state.values[argument.name] = collectsValues(argument) ? [] : undefined;
  }
}

function storeCompletedValues(
  argument: ArgumentDefinition,
  parsed: readonly unknown[],
  state: ScanState,
  input: 'cli' | 'env',
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
  const colorDisabled = argument.color && Bun.env.NO_COLOR !== undefined;
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
  const parent = state.command;
  state.scopes.set(parent, {
    values: { ...state.values },
    argumentStates: new Map(state.argumentStates),
  });
  state.inheritedGlobals = [
    ...state.inheritedGlobals,
    ...parent.arguments.filter(({ global }) => global),
  ];
  for (const argument of parent.arguments.filter(({ global }) => global)) {
    state.owners.set(argument.name, parent);
  }
  state.command = child;
  state.commandPath.push(child.name);
  state.positionalIndex = 0;
  for (const argument of child.arguments) {
    state.owners.set(argument.name, child);
  }
  initializeArguments(child.arguments, state);
}

function currentPositional(state: ScanState): ArgumentDefinition | undefined {
  return state.command.arguments.filter(
    ({ kind }) => kind === 'positional',
  )[state.positionalIndex];
}

function findValueTarget(
  state: ScanState,
  currentWord: string,
): ValueTarget | undefined {
  const argvState = state.argvState;
  if (argvState.kind === 'option-values') {
    const action = recognizeOptionValue(argvState, currentWord, (word) => resolveSubcommand(state.command, word) !== undefined);
    if (action === 'take-value') {
      return valueTarget(argvState.argument, currentWord, '');
    }
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

async function completeArgument(
  state: ScanState,
  target: ValueTarget,
  argv: readonly string[],
  cursor: number,
  filter: boolean,
): Promise<DynamicCompletionResult> {
  const context: DynamicCompletionContext = Object.freeze({
    argv,
    cursor,
    current: target.current,
    commandPath: Object.freeze([...state.commandPath]),
    command: state.command,
    argument: target.argument,
    values: freezeValues(state.values),
    rawValues: freezeRawValues(state.rawValues),
  });
  const provider = (target.argument as CompletionEnabledArgument).completion;
  const inputs = provider === undefined
    ? parserCompletionCandidates(target.argument)
    : await collectProvider(provider, context);
  const candidates = normalizeCandidates(inputs).map((candidate) =>
    Object.freeze({
      ...candidate,
      value: `${target.outputPrefix}${candidate.value}`,
    })
  );
  const hint = target.argument.completionHint
    ?? target.argument.parser?.completionHint;

  return freezeResult({
    candidates: filterAndDedupe(
      candidates,
      `${target.outputPrefix}${target.current}`,
      filter,
      provider === undefined && target.argument.parser?.ignoreCase === true,
    ),
    commandPath: state.commandPath,
    current: target.current,
    argument: target.argument,
    ...(hint === undefined ? {} : { valueHint: hint }),
  });
}

function parserCompletionCandidates(
  argument: ArgumentDefinition,
): readonly DynamicCompletionCandidateInput[] {
  const parser = argument.parser;
  const choices = parser?.choices ?? [];
  const normalize = (value: string): string =>
    parser?.ignoreCase === true
      ? value.toLowerCase()
      : value;
  const hiddenSpellings = new Set(
    choices
      .filter(({ hide }) => hide === true)
      .flatMap(({ value, aliases }) => [value, ...(aliases ?? [])])
      .map(normalize),
  );
  const aliases = new Set(
    choices.flatMap(({ aliases: choiceAliases }) => choiceAliases ?? []).map(normalize),
  );
  const descriptions = new Map(
    choices
      .filter(({ hide }) => hide !== true)
      .map(({ value, describe }) => [value, describe] as const),
  );
  const values = new Map<string, DynamicCompletionCandidate>();
  for (const value of parser?.completions ?? []) {
    const normalized = normalize(value);
    if (hiddenSpellings.has(normalized) || aliases.has(normalized)) {
      continue;
    }
    if (!values.has(value)) {
      const description = descriptions.get(value);
      values.set(value, {
        value,
        ...(description === undefined ? {} : { description }),
      });
    }
  }
  for (const choice of choices) {
    if (choice.hide === true || values.has(choice.value)) {
      continue;
    }
    values.set(choice.value, {
      value: choice.value,
      ...(choice.describe === undefined ? {} : { description: choice.describe }),
    });
  }
  return [...values.values()];
}

async function collectProvider(
  provider: DynamicCompletionProvider,
  context: DynamicCompletionContext,
): Promise<readonly DynamicCompletionCandidateInput[]> {
  const result = await provider(context);
  if (typeof result === 'string' || result === null || typeof result !== 'object') {
    throw new TypeError('A completion provider must return an iterable of candidates');
  }
  const candidates: DynamicCompletionCandidateInput[] = [];
  if (Symbol.asyncIterator in result) {
    for await (const candidate of result) {
      candidates.push(candidate);
    }
  } else if (Symbol.iterator in result) {
    for (const candidate of result) {
      candidates.push(candidate);
    }
  } else {
    throw new TypeError('A completion provider must return an iterable of candidates');
  }
  return candidates;
}

function normalizeCandidates(
  candidates: readonly DynamicCompletionCandidateInput[],
): readonly DynamicCompletionCandidate[] {
  return candidates.map((candidate) => {
    const normalized = typeof candidate === 'string'
      ? { value: candidate }
      : candidate;
    if (
      normalized.value.length === 0
      || normalized.value.includes('\0')
      || normalized.value.includes('\n')
      || normalized.value.includes('\r')
      || normalized.value.includes('\t')
    ) {
      throw new TypeError(
        'A completion candidate must be a non-empty single-line value without tabs',
      );
    }
    return Object.freeze({
      value: normalized.value,
      ...(normalized.description === undefined
        ? {}
        : { description: normalized.description }),
    });
  });
}

function namedCandidates(state: ScanState): readonly DynamicCompletionCandidate[] {
  const candidates = activeArguments(state)
    .filter(({ hidden, kind }) => !hidden && kind !== 'positional')
    .flatMap((argument) =>
      [
        ...(argument.short === undefined ? [] : [`-${argument.short}`]),
        ...(argument.long === undefined ? [] : [`--${argument.long}`]),
        ...(argument.negativeLong === undefined ? [] : [`--${argument.negativeLong}`]),
        ...argument.aliases.map((alias) => `--${alias}`),
      ].map((value) => ({
        value,
        ...(argument.help === undefined ? {} : { description: argument.help }),
      }))
    );
  if (!state.command.disableHelpFlag) {
    candidates.push({ value: '-h', description: 'Print help' });
    candidates.push({ value: '--help', description: 'Print help' });
  }
  if (state.command.version !== undefined && !state.command.disableVersionFlag) {
    candidates.push({ value: '-V', description: 'Print version' });
    candidates.push({ value: '--version', description: 'Print version' });
  }
  return candidates;
}

function subcommandCandidates(
  state: ScanState,
): readonly DynamicCompletionCandidate[] {
  return state.command.subcommands
    .filter(({ hidden }) => !hidden)
    .flatMap((child) =>
      [
        child.name,
        ...child.aliases.filter(({ visible }) => visible).map(({ name }) => name),
      ].map((value) => ({
        value,
        ...(child.about === undefined ? {} : { description: child.about }),
      }))
    );
}

function filterAndDedupe(
  candidates: readonly DynamicCompletionCandidate[],
  current: string,
  filter: boolean,
  ignoreCase = false,
): readonly DynamicCompletionCandidate[] {
  const seen = new Set<string>();
  const normalizedCurrent = ignoreCase ? current.toLowerCase() : current;
  return Object.freeze(
    candidates.filter(({ value }) => {
      const normalizedValue = ignoreCase ? value.toLowerCase() : value;
      if (filter && !normalizedValue.startsWith(normalizedCurrent)) {
        return false;
      }
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    }).map((candidate) => Object.freeze({ ...candidate })),
  );
}

function freezeValues(
  values: Readonly<Record<string, unknown>>,
): DynamicCompletionValues {
  return Object.freeze(Object.fromEntries(
    Object.entries(values).map(([name, value,]) => [
      name,
      Array.isArray(value) ? Object.freeze([...value]) : value,
    ]),
  ));
}

function freezeRawValues(
  values: Readonly<Record<string, readonly string[]>>,
): DynamicCompletionRawValues {
  return Object.freeze(Object.fromEntries(
    Object.entries(values).map(([name, value,]) => [name, Object.freeze([...value])]),
  ));
}

function freezeResult(result: DynamicCompletionResult): DynamicCompletionResult {
  return Object.freeze({
    ...result,
    candidates: Object.freeze([...result.candidates]),
    commandPath: Object.freeze([...result.commandPath]),
  });
}

function encodeProtocolField(value: string): string {
  return Buffer.from(value).toString('hex');
}
