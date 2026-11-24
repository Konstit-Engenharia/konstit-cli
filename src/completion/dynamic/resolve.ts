import type { Environment } from '../../command/environment.js';
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
  const state = createScanState(getCommandDefinition(configuredCommand), env, options.config);
  scanWords(state, input.slice(0, cursor));
  resolvePendingWordBoundary(state, currentWord);
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
  if (state.active.argvState.kind !== 'literal' && (currentWord.length === 0 || currentWord.startsWith('-'))) {
    candidates.push(...namedCandidates(state));
  }
  if (state.active.argvState.kind !== 'literal' && !currentWord.startsWith('-')) {
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
        commandPath: state.active.commandPath,
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
    commandPath: state.active.commandPath,
    current: currentWord,
  });
}

function validateCursor(cursor: number, argvLength: number): void {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > argvLength) {
    throw new RangeError('The completion cursor must be an argv index or argv.length');
  }
}
