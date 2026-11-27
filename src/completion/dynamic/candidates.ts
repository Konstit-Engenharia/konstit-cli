import type { ArgumentDefinition } from '../../argument/types.js';
import {
  builtinOptions,
  defaultOptions,
} from '../default-subcommand.js';
import {
  activeArguments,
  currentPositional,
} from './scan.js';
import type {
  DynamicCompletionCandidate,
  DynamicCompletionCandidateInput,
  DynamicCompletionContext,
  DynamicCompletionProvider,
  DynamicCompletionRawValues,
  DynamicCompletionResult,
  DynamicCompletionValues,
  ScanState,
  ValueTarget,
} from './types.js';

interface CompletionEnabledArgument extends ArgumentDefinition {
  readonly completion?: DynamicCompletionProvider;
}

export async function completeArgument(
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
    commandPath: Object.freeze([...state.active.commandPath]),
    command: state.active.command,
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
    commandPath: state.active.commandPath,
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

export function namedCandidates(state: ScanState): readonly DynamicCompletionCandidate[] {
  const args = activeArguments(state);
  const candidates = args
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
  return [
    ...candidates,
    ...builtinOptions(state.active.command),
    ...defaultOptions(state.active.command, args, currentPositional(state))
      .map(({ value, description }) => ({ value, ...(description === undefined ? {} : { description }) })),
  ];
}

export function subcommandCandidates(
  state: ScanState,
): readonly DynamicCompletionCandidate[] {
  return state.active.command.subcommands
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

export function filterAndDedupe(
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

export function freezeResult(result: DynamicCompletionResult): DynamicCompletionResult {
  return Object.freeze({
    ...result,
    candidates: Object.freeze([...result.candidates]),
    commandPath: Object.freeze([...result.commandPath]),
  });
}
