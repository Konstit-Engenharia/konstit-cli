import type { Environment } from '../../command/environment.js';
import { expandArgumentFiles } from '../../command/parsing/argument-files.js';
import { getCommandDefinition } from '../../command/store.js';
import type { CommandType } from '../../command/types.js';
import { validateConfigShape } from '../../configuration/shape.js';
import {
  completeArgument,
  filterAndDedupe,
  freezeResult,
  namedCandidates,
  subcommandCandidates,
} from './candidates.js';
import {
  advanceDefaultSubcommands,
  createScanState,
  currentPositional,
  finalizeRelations,
  findValueTarget,
  resolvePendingWordBoundary,
  scanWords,
} from './scan.js';
import type {
  DynamicCompletionCandidate,
  DynamicCompletionOptions,
  DynamicCompletionResult,
} from './types.js';

/**
 * Resolves one completion request without generating or invoking a shell
 * script. argv excludes the executable and includes the incomplete word.
 */
export function resolveDynamicCompletion(
  configuredCommand: CommandType,
  argv: readonly string[],
  options: DynamicCompletionOptions = {},
): Promise<DynamicCompletionResult> {
  return resolveCompletion(configuredCommand, argv, options, options.env ?? Bun.env);
}

/** Resolves a completion request with an explicit environment snapshot. */
export async function resolveCompletion(
  configuredCommand: CommandType,
  argv: readonly string[],
  options: DynamicCompletionOptions,
  env: Environment,
): Promise<DynamicCompletionResult> {
  const cursor = options.cursor ?? (argv.length === 0 ? 0 : argv.length - 1);
  validateCursor(cursor, argv.length);
  validateConfigShape(options.config);

  const input = Object.freeze([...argv]);
  const currentWord = input[cursor] ?? '';
  const filter = options.filter ?? true;
  const definition = getCommandDefinition(configuredCommand);
  const precedingWords = input.slice(0, cursor);
  const state = createScanState(definition, env, options.config);
  scanWords(state, options.argumentFiles === true ? expandArgumentFiles(definition, precedingWords).tokens : precedingWords);
  resolvePendingWordBoundary(state, currentWord);

  const target = findValueTarget(state, currentWord);
  if (target !== undefined) {
    finalizeRelations(state);
    return completeArgument(
      state,
      target,
      input,
      cursor,
      filter,
    );
  }

  const candidates: DynamicCompletionCandidate[] = [];
  const commandPath = state.active.commandPath;
  if (state.active.argvState.kind !== 'literal' && (currentWord.length === 0 || currentWord.startsWith('-'))) {
    candidates.push(...namedCandidates(state));
  }
  if (state.active.argvState.kind !== 'literal' && !currentWord.startsWith('-')) {
    candidates.push(...subcommandCandidates(state));
  }

  advanceDefaultSubcommands(state, currentWord, true);
  const implicitTarget = commandPath === state.active.commandPath ? undefined : findValueTarget(state, currentWord);
  finalizeRelations(state);
  if (implicitTarget !== undefined && implicitTarget.argument.kind !== 'positional') {
    return completeArgument(state, implicitTarget, input, cursor, filter);
  }
  const positional = !currentWord.startsWith('-') ? currentPositional(state) : implicitTarget?.argument;
  if (positional !== undefined) {
    const positionalResult = await completeArgument(
      state,
      implicitTarget ?? { argument: positional, current: currentWord, outputPrefix: '' },
      input,
      cursor,
      filter,
    );
    return freezeResult({
      ...positionalResult,
      candidates: filterAndDedupe([...candidates, ...positionalResult.candidates], currentWord, filter),
    });
  }

  return freezeResult({
    candidates: filterAndDedupe(candidates, currentWord, filter),
    commandPath,
    current: currentWord,
  });
}

function validateCursor(cursor: number, argvLength: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > argvLength) {
    throw new RangeError('The completion cursor must be an argv index or argv.length');
  }
}
