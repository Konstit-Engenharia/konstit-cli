import {
  validateConfigShape,
  type CommandConfig,
  type ParseOptions,
} from '../../configuration/shape.js';
import {
  commandError,
  suggestToken,
  suggestTokenCandidates,
} from '../../help/diagnostics.js';
import { createHelpDisplay } from '../../help/render.js';
import {
  collectDeprecation,
  getWarnings,
  setWarnings,
} from '../../result/deprecation.js';
import {
  CliError,
  DisplayKind,
  ErrorKind,
  type ParseOutcome,
  type ParseResult,
} from '../../result/error.js';
import {
  setValueSources,
  type TrackedValueSource,
} from '../../result/value-source.js';
import type { CommandDefinition } from '../schema.js';
import {
  hasCommandLineInput,
  suppliedArgument,
} from './argument-state.js';
import {
  applyConfigValues,
  applyEnvironmentFallbacks,
  validateConfigForCommand,
} from './configuration.js';
import {
  parseLongOption,
  parseShortOptions,
} from './options.js';
import {
  commandWords,
  literalWords,
  recognizeWord,
  type WordState,
} from './recognition.js';
import {
  applyConditionalDefaults,
  applyOverrides,
} from './relations.js';
import {
  acceptsOptionLookingPositional,
  currentPositional,
  deprecatedAliasMessage,
  initializeValues,
  refreshInheritedSources,
  trackedValueSource,
  validateGlobalArguments,
} from './state.js';
import {
  hasExactSubcommand,
  renderSubcommandHelp,
  resolveSubcommand,
} from './subcommands.js';
import {
  DisplayRequest,
  type CollectingParseSession,
  type ColorMode,
  type CompleteParseSession,
  type GlobalBinding,
  type ParseState,
  type RunningParseSession,
} from './types.js';
import {
  reportValidationIssue,
  storePositionalValue,
  validateParsedValues,
} from './values.js';

export type { ColorMode } from './types.js';

export const outputColorModes = new WeakMap<object, ColorMode>();

export function parseConfigured<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  defaultColor: boolean,
  options: ParseOptions = {},
): ParseOutcome<Value> {
  validateConfigShape(options.config);
  const session: CollectingParseSession = {
    defaultColor,
    env: options.env ?? Bun.env,
    warnings: [],
    validation: { phase: 'collecting', validators: [] },
  };
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
    const completed = runDeferredValidators(session);
    const outcome = { ok: true, type: 'value', value } as const;
    if (completed.colorMode !== undefined) {
      outputColorModes.set(outcome, completed.colorMode);
    }
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

function deferValidator(session: CollectingParseSession, validate: () => void): void {
  session.validation.validators.push(validate);
}

function runDeferredValidators(session: CollectingParseSession): CompleteParseSession {
  const running: RunningParseSession = {
    ...session,
    validation: {
      phase: 'running',
      validators: session.validation.validators,
    },
  };
  for (const validate of running.validation.validators) {
    validate();
  }
  return {
    ...running,
    validation: { phase: 'complete' },
  };
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

function parseDefinition(
  definition: CommandDefinition,
  argv: string[],
  argvOffset: number,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
  session: CollectingParseSession,
  config: CommandConfig | undefined,
  hideStandardFlags = false,
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
    argumentStates: new Map(),
    session,
    hideStandardFlags,
    positionalIndex: 0,
  };
  const positionals = definition.arguments.filter(({ kind }) => kind === 'positional');
  initializeValues(definition, state);
  validateGlobalArguments(definition, inheritedGlobals);
  validateConfigForCommand(definition, config, path, state, inheritedGlobals);
  const localGlobals = definition.arguments
    .filter(({ global }) => global)
    .map((argument) => ({ argument, definition, state }));
  const globals = [...inheritedGlobals, ...localGlobals];

  let index = 0;
  let wordState: WordState = commandWords;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }

    const positionalArgument = currentPositional(positionals, state);
    if (positionalArgument?.literal === true) {
      wordState = literalWords;
    }
    if (
      wordState.kind === 'command'
      && !definition.disableHelpFlag
      && (token === '--help' || token === '-h')
    ) {
      throw new DisplayRequest(createHelpDisplay(
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
        { hideStandardFlags },
      ));
    }
    if (
      wordState.kind === 'command'
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
    const consumeAsPositional = wordState.kind === 'command'
      && positionalArgument !== undefined
      && acceptsOptionLookingPositional(
        positionalArgument,
        token,
        definition,
        state,
        inheritedGlobals,
      );
    const kind = recognizeWord(wordState, token, consumeAsPositional);
    if (kind === 'end-options') {
      wordState = literalWords;
      index += 1;
      continue;
    }
    if (kind === 'long-option') {
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
    if (kind === 'short-options') {
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

    if (kind === 'command-word') {
      if (
        token === 'help'
        && definition.subcommands.length > 0
        && !definition.disableHelpSubcommand
        && !hasExactSubcommand(definition, token)
      ) {
        throw new DisplayRequest(renderSubcommandHelp(
          definition,
          argv.slice(index + 1),
          argvOffset + index + 1,
          path,
          inheritedGlobals,
          hideStandardFlags,
        ));
      }
      const child = resolveSubcommand(
        definition,
        token,
        path,
        inheritedGlobals,
        argvOffset + index,
        positionalArgument?.sensitive === true,
      );
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
            hideStandardFlags || definition.hideStandardFlagsInSubcommandHelp,
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
      inheritedGlobals.map(({ argument }) => argument),
    );
    const count = suppliedArgument(state, positionalArgument.name)?.valueCount ?? 0;
    if (
      !positionalArgument.repeatable
      && positionalArgument.maxValues !== null
      && count >= positionalArgument.maxValues
    ) {
      state.positionalIndex += 1;
    }
    if (positionalArgument.trailingVarArg) {
      wordState = literalWords;
    }
    index += 1;
  }

  // Capture CLI presence before environment fallbacks and overrides can change it.
  const conflictingArgument = definition.argsConflictWithSubcommands && state.subcommand !== undefined
    ? definition.arguments.find((argument) => !argument.global && hasCommandLineInput(state, argument.name))
    : undefined;
  const subcommandConflict = conflictingArgument === undefined ? undefined : {
    argument: conflictingArgument,
    tokenIndex: suppliedArgument(state, conflictingArgument.name)?.tokenIndex,
  };
  const inheritedArguments = inheritedGlobals.map(({ argument }) => argument);
  applyEnvironmentFallbacks(
    definition,
    state,
    path,
    inheritedArguments,
  );
  applyConfigValues(definition, config, path, state, inheritedGlobals);
  applyConditionalDefaults(definition, state, session.env);
  applyOverrides(definition, state, session.env);
  refreshInheritedSources(state.subcommand, localGlobals);
  validateParsedValues(
    definition,
    path,
    state,
    inheritedArguments,
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
  const sources = new Map<string, TrackedValueSource>();
  for (const [name, argumentState,] of state.argumentStates) {
    const source = trackedValueSource(argumentState);
    if (source !== undefined) {
      sources.set(name, source);
    }
  }
  for (const { argument, state: inheritedState } of inheritedGlobals) {
    const source = trackedValueSource(inheritedState.argumentStates.get(argument.name));
    if (source !== undefined) {
      sources.set(argument.name, source);
    }
  }
  setValueSources(result, sources);
  const validate = definition.validate;
  if (validate !== undefined) {
    // Ancestor configuration can update inherited value sources after a child is parsed.
    deferValidator(session, () => {
      const issue = validate(result as never);
      if (issue !== undefined) {
        reportValidationIssue(issue, definition, path, state, inheritedArguments);
      }
    });
  }
  return result;
}
