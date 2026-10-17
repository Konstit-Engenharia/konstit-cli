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
  argumentLongNames,
  isNegativeNumberToken,
  matchSubcommand,
  parseLongOptionToken,
  parseShortOptionCluster,
  splitArgumentValue,
  stopsOptionValueCollection,
} from './command/recognition.js';
import type { CompletionValueHint } from './parser.js';

/** A completion returned by a dynamic provider. */
export interface DynamicCompletionCandidate {
  readonly value: string;
  readonly description?: string;
}

export type DynamicCompletionCandidateInput =
  | string
  | DynamicCompletionCandidate;

export type DynamicCompletionValues = Readonly<Record<string, unknown>>;
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
  readonly command: CommandDefinition;
  readonly argument: ArgumentDefinition;
  /** Defaults and successfully parsed words visible at the active command. */
  readonly values: Values;
  /** Raw values collected before the current word. */
  readonly rawValues: DynamicCompletionRawValues;
}

export type DynamicCompletionIterable =
  | Iterable<DynamicCompletionCandidateInput>
  | AsyncIterable<DynamicCompletionCandidateInput>;

/** A synchronous, asynchronous, or async-iterable value completer. */
export type DynamicCompletionProvider<
  in Values extends DynamicCompletionValues = DynamicCompletionValues,
> = (
  context: DynamicCompletionContext<Values>,
) => DynamicCompletionIterable | PromiseLike<DynamicCompletionIterable>;

export interface DynamicCompletionOptions {
  /**
   * Index of the word being completed. It can equal argv.length to represent
   * a new empty word. The default is the final argv word, or zero for [].
   */
  readonly cursor?: number;
  /** Applies prefix filtering to provider and static values. The default is true. */
  readonly filter?: boolean;
}

export interface DynamicCompletionResult {
  readonly candidates: readonly DynamicCompletionCandidate[];
  readonly commandPath: readonly string[];
  readonly current: string;
  readonly argument?: ArgumentDefinition;
  readonly valueHint?: CompletionValueHint;
}

/** Internal inputs used by Command.run for one shell completion request. */
export interface DynamicCompletionRequestOptions {
  /** Arguments after the executable, including the incomplete word. */
  readonly argv?: readonly string[];
  /** Index of the incomplete word. Defaults to the final argv item. */
  readonly cursor?: number;
  readonly stdout?: (output: string) => void;
}

interface CompletionEnabledArgument extends ArgumentDefinition {
  readonly completion?: DynamicCompletionProvider;
}

interface PendingValue {
  readonly argument: ArgumentDefinition;
  consumed: number;
}

interface ScanState {
  command: CommandDefinition;
  commandPath: string[];
  inheritedGlobals: ArgumentDefinition[];
  positionalIndex: number;
  optionsEnabled: boolean;
  pending: PendingValue | undefined;
  readonly values: Record<string, unknown>;
  readonly rawValues: Record<string, string[]>;
  readonly cliProvided: Set<string>;
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
  if (state.optionsEnabled && (currentWord.length === 0 || currentWord.startsWith('-'))) {
    candidates.push(...namedCandidates(state));
  }
  if (state.optionsEnabled && !currentWord.startsWith('-')) {
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
    (options.stdout ?? ((text: string) => process.stdout.write(text)))(output);
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
    positionalIndex: 0,
    optionsEnabled: true,
    pending: undefined,
    values: {},
    rawValues: {},
    cliProvided: new Set(),
  };
  initializeArguments(root.arguments, state);
  return state;
}

function initializeArguments(
  argumentsToInitialize: readonly ArgumentDefinition[],
  state: ScanState,
): void {
  for (const argument of argumentsToInitialize) {
    if (argument.color) {
      state.values[argument.name] = Bun.env.NO_COLOR === undefined
        && process.stdout.isTTY === true
        && Bun.env.TERM !== 'dumb';
    } else if (argument.repeatable || argument.trailingVarArg) {
      state.values[argument.name] = [];
    } else if (argument.presence === 'default') {
      state.values[argument.name] = argument.defaultValue;
    } else {
      state.values[argument.name] = undefined;
    }

    const environmentValue = argument.env === undefined
      ? undefined
      : Bun.env[argument.env];
    if (environmentValue !== undefined) {
      if (argument.kind === 'flag') {
        state.values[argument.name] = argument.color
          ? false
          : argument.action === ArgumentAction.SetTrue;
      } else if (argument.kind === 'count') {
        const count = Number(environmentValue);
        if (Number.isSafeInteger(count) && count >= 0) {
          state.values[argument.name] = count;
        }
      } else {
        storeArgumentValues(
          argument,
          splitValue(argument, environmentValue),
          state,
          false,
        );
      }
    }
  }
}

function scanWords(state: ScanState, words: readonly string[]): void {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) {
      break;
    }

    if (state.pending !== undefined) {
      if (word === state.pending.argument.valueTerminator) {
        applyDefaultMissing(state.pending, state);
        state.pending = undefined;
        index += 1;
        continue;
      }
      if (!stopsValueCollection(state, state.pending.argument, word)) {
        consumePending(state, state.pending, word);
        index += 1;
        continue;
      }
      applyDefaultMissing(state.pending, state);
      state.pending = undefined;
    }

    if (state.optionsEnabled && word === '--') {
      state.optionsEnabled = false;
      index += 1;
      continue;
    }
    const consumeAsPositional = state.optionsEnabled
      && acceptsOptionLookingPositional(state, word);
    if (
      state.optionsEnabled
      && !consumeAsPositional
      && word.startsWith('--')
      && word.length > 2
    ) {
      scanLongOption(state, word);
      index += 1;
      continue;
    }
    if (
      state.optionsEnabled
      && !consumeAsPositional
      && word.startsWith('-')
      && word !== '-'
    ) {
      scanShortOptions(state, word);
      index += 1;
      continue;
    }

    if (state.optionsEnabled && !consumeAsPositional) {
      const child = resolveSubcommand(state.command, word);
      if (child !== undefined) {
        enterSubcommand(state, child);
        index += 1;
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
          state.optionsEnabled = false;
        }
      }
    }
    index += 1;
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
  for (let index = 0; index < cluster.length; index += 1) {
    const short = cluster[index];
    if (short === undefined) {
      break;
    }
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
  if (argument.maxValues === null || consumed < argument.maxValues) {
    state.pending = { argument, consumed };
  } else {
    state.pending = undefined;
  }
}

function applyDefaultMissing(pending: PendingValue, state: ScanState): void {
  if (pending.consumed === 0) {
    storeDefaultMissing(pending.argument, state);
  }
}

function storeDefaultMissing(
  argument: ArgumentDefinition,
  state: ScanState,
): void {
  if (!argument.hasDefaultMissingValue) {
    return;
  }
  if (!state.cliProvided.has(argument.name)) {
    state.cliProvided.add(argument.name);
    state.rawValues[argument.name] = [];
    state.values[argument.name] = collectsValues(argument) ? [] : undefined;
  }
  if (collectsValues(argument)) {
    const current = state.values[argument.name];
    state.values[argument.name] = [
      ...(Array.isArray(current) ? current : []),
      argument.defaultMissingValue,
    ];
  } else {
    state.values[argument.name] = argument.defaultMissingValue;
  }
}

function consumePending(
  state: ScanState,
  pending: PendingValue,
  word: string,
): void {
  const values = splitValue(pending.argument, word);
  storeArgumentValues(pending.argument, values, state);
  pending.consumed += values.length;
  if (
    pending.argument.maxValues !== null
    && pending.consumed >= pending.argument.maxValues
  ) {
    state.pending = undefined;
  }
}

function stopsValueCollection(
  state: ScanState,
  argument: ArgumentDefinition,
  word: string,
): boolean {
  if (stopsOptionValueCollection(argument, word)) {
    return true;
  }
  return state.optionsEnabled
    && argument.minValues <= (state.pending?.consumed ?? 0)
    && resolveSubcommand(state.command, word) !== undefined;
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
  cliProvided = true,
): number {
  if (cliProvided && !state.cliProvided.has(argument.name)) {
    state.cliProvided.add(argument.name);
    state.rawValues[argument.name] = [];
    state.values[argument.name] = collectsValues(argument) ? [] : undefined;
  }
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
  if (parsed.length === 0) {
    return storedRaw.length;
  }

  if (collectsValues(argument)) {
    const current = state.values[argument.name];
    state.values[argument.name] = [
      ...(Array.isArray(current) ? current : []),
      ...parsed,
    ];
  } else {
    state.values[argument.name] = parsed.at(-1);
  }
  return storedRaw.length;
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
  const firstCliValue = !state.cliProvided.has(argument.name);
  state.cliProvided.add(argument.name);
  if (argument.kind === 'flag') {
    const value = explicitValue ?? argument.action !== 'setFalse';
    state.values[argument.name] = argument.color && Bun.env.NO_COLOR !== undefined
      ? false
      : value;
  } else {
    const current = state.values[argument.name];
    state.values[argument.name] = !firstCliValue && typeof current === 'number'
      ? current + 1
      : 1;
  }
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
  state.inheritedGlobals = [
    ...state.inheritedGlobals,
    ...state.command.arguments.filter(({ global }) => global),
  ];
  state.command = child;
  state.commandPath.push(child.name);
  state.positionalIndex = 0;
  state.pending = undefined;
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
  if (
    state.pending !== undefined
    && !stopsValueCollection(state, state.pending.argument, currentWord)
  ) {
    return valueTarget(state.pending.argument, currentWord, '');
  }
  if (!state.optionsEnabled) {
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
      const short = cluster[index];
      if (short === undefined) {
        break;
      }
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
    ? target.argument.parser?.completions ?? []
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
    ),
    commandPath: state.commandPath,
    current: target.current,
    argument: target.argument,
    ...(hint === undefined ? {} : { valueHint: hint }),
  });
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
): readonly DynamicCompletionCandidate[] {
  const seen = new Set<string>();
  return Object.freeze(
    candidates.filter(({ value }) => {
      if (filter && !value.startsWith(current)) {
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
