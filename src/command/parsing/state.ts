import type { ArgumentDefinition } from '../../argument/index.js';
import {
  updateValueSource,
  type TrackedValueSource,
} from '../../result/value-source.js';
import { readEnv } from '../environment.js';
import type { CommandDefinition } from '../schema.js';
import {
  defaultArgument,
  environmentPolicy,
  restoreArgumentDefault,
  type ArgumentState,
} from './argument-state.js';
import {
  argumentLongNames,
  isNegativeNumberToken,
} from './recognition.js';
import type {
  GlobalBinding,
  ParseState,
} from './types.js';

export function deprecatedAliasMessage(
  aliases: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  return aliases !== undefined && Object.hasOwn(aliases, name)
    ? aliases[name]
    : undefined;
}

export function trackedValueSource(state: ArgumentState | undefined): TrackedValueSource | undefined {
  return state?.kind === 'supplied' && state.configFile !== undefined
    ? { file: state.configFile }
    : state?.source;
}

export function refreshInheritedSources(
  subcommand: ParseState['subcommand'],
  globals: readonly GlobalBinding[],
): void {
  if (subcommand === undefined) {
    return;
  }
  for (const { argument, state } of globals) {
    updateValueSource(
      subcommand.args,
      argument.name,
      trackedValueSource(state.argumentStates.get(argument.name)),
    );
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

export function initializeValues(
  definition: CommandDefinition,
  state: ParseState,
): void {
  for (const argument of definition.arguments) {
    if (argument.color) {
      const disabled = readEnv(state.session.env, 'NO_COLOR') !== undefined;
      state.values[argument.name] = disabled ? false : state.session.defaultColor;
      state.argumentStates.set(argument.name, disabled ? environmentPolicy : defaultArgument);
      state.session.colorMode = disabled ? 'never' : 'auto';
    } else {
      restoreArgumentDefault(state, argument);
    }
  }
}

export function acceptsOptionLookingPositional(
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

export function currentPositional(
  positionals: readonly ArgumentDefinition[],
  state: ParseState,
): ArgumentDefinition | undefined {
  return positionals[state.positionalIndex];
}

export function availableArgumentBindings(
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): readonly GlobalBinding[] {
  return [
    ...definition.arguments.map((argument) => ({ argument, definition, state })),
    ...inheritedGlobals,
  ];
}

export function validateGlobalArguments(
  definition: CommandDefinition,
  inheritedGlobals: readonly GlobalBinding[],
): void {
  for (const local of definition.arguments) {
    for (const { argument: global } of inheritedGlobals) {
      const localLongs = argumentLongNames(local);
      const globalLongs = argumentLongNames(global);
      if (
        local.name === global.name
        || (local.color && global.color)
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
