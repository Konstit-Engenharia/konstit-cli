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
import { getCommandDefinition } from '../store.js';
import { validateBuiltInCollisions } from '../validation/definition.js';
import {
  expandArgumentFiles,
  locateArgumentFileError,
} from './argument-files.js';
import {
  hasCommandLineInput,
  suppliedArgument,
} from './argument-state.js';
import {
  applyConfigValues,
  applyEnvironmentFallbacks,
  applyPromptValues,
  validateConfigForCommand,
} from './configuration.js';
import {
  parseLongOption,
  parseShortOptions,
} from './options.js';
import {
  argumentLongNames,
  commandWords,
  literalWords,
  parseLongOptionToken,
  parseShortOptionCluster,
  recognizeWord,
  type WordState,
} from './recognition.js';
import {
  applyValueRelations,
  collectOverrideTargets,
} from './relations.js';
import {
  acceptsOptionLookingPositional,
  availableArgumentBindings,
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
export const jsonOutputModes = new WeakMap<object, boolean>();
export const externalCommandDefinitions = new WeakMap<object, ReadonlyMap<string, CommandDefinition>>();

export function parseConfigured<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  defaultColor: boolean,
  options: ParseOptions = {},
  promptValues?: Readonly<Record<string, string>>,
): ParseOutcome<Value> {
  validateConfigShape(options.config);
  const expanded = options.argumentFiles === true ? expandArgumentFiles(definition, argv) : undefined;
  const session: CollectingParseSession = {
    defaultColor,
    env: options.env ?? Bun.env,
    ...(promptValues === undefined ? {} : { promptValues }),
    warnings: [],
    validation: { phase: 'collecting', validators: [] },
  };
  try {
    const value = parseDefinition(
      definition,
      expanded?.tokens ?? [...argv],
      0,
      [definition.name],
      [],
      session,
      options.config,
    ) as Value;
    const completed = runDeferredValidators(session);
    const outcome = { ok: true, type: 'value', value } as const;
    if (session.externalCommands !== undefined) {
      externalCommandDefinitions.set(value as object, session.externalCommands);
    }
    if (completed.colorMode !== undefined) {
      outputColorModes.set(outcome, completed.colorMode);
    }
    if (session.jsonRequested === true) {
      jsonOutputModes.set(outcome, true);
    }
    setWarnings(outcome, session.warnings);
    return outcome;
  } catch (error) {
    const failure = error instanceof CliError && expanded !== undefined
      ? locateArgumentFileError(error, expanded.origins)
      : error;
    if (session.colorMode !== undefined) {
      const target = failure instanceof DisplayRequest ? failure.outcome : failure;
      if (typeof target === 'object' && target !== null) {
        outputColorModes.set(target, session.colorMode);
      }
    }
    if (failure instanceof DisplayRequest) {
      return failure.outcome;
    }
    if (failure instanceof CliError) {
      if (session.externalCommands !== undefined) {
        externalCommandDefinitions.set(failure, session.externalCommands);
      }
      setWarnings(failure, session.warnings);
    }
    throw failure;
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
  promptValues?: Readonly<Record<string, string>>,
): ParseResult<Value> {
  try {
    return parseConfigured<Value>(definition, argv, defaultColor, options, promptValues);
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

  const defaultChild = definition.defaultSubcommand === undefined
    ? undefined
    : definition.subcommands.find(({ name }) => name === definition.defaultSubcommand);
  function selectChild(child: CommandDefinition, start: number, spelling?: string): void {
    const childPath = [...path, child.name];
    collectDeprecation(
      session.warnings,
      'command',
      child.name,
      child.deprecated,
      childPath,
    );
    if (spelling !== undefined) {
      collectDeprecation(session.warnings, 'alias', spelling, deprecatedAliasMessage(child.deprecatedAliases, spelling), childPath);
    }
    state.subcommand = Object.freeze({
      name: child.name,
      args: parseDefinition(
        child,
        argv.slice(start),
        argvOffset + start,
        childPath,
        globals,
        session,
        config?.subcommands?.[child.name],
        hideStandardFlags || definition.hideStandardFlagsInSubcommandHelp,
      ),
    });
  }

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
      && definition.enableJsonFlag
      && token === '--json'
    ) {
      session.jsonRequested = true;
      index += 1;
      continue;
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
      if (defaultChild !== undefined && positionalArgument === undefined) {
        selectChild(defaultChild, index);
        break;
      }
      wordState = literalWords;
      if (positionalArgument?.valueTerminator !== token) {
        index += 1;
        continue;
      }
    }
    if (kind === 'long-option') {
      if (defaultChild !== undefined && !hasOptionBinding(token, kind, definition, state, inheritedGlobals)) {
        selectChild(defaultChild, index);
        break;
      }
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
      if (defaultChild !== undefined && !hasOptionBinding(token, kind, definition, state, inheritedGlobals)) {
        selectChild(defaultChild, index);
        break;
      }
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
      let child = resolveSubcommand(
        definition,
        token,
        path,
        inheritedGlobals,
        argvOffset + index,
        positionalArgument?.sensitive === true,
      );
      if (
        child === undefined
        && positionalArgument === undefined
        && definition.externalSubcommand !== undefined
      ) {
        const external = definition.externalSubcommand(token, argv.slice(index + 1));
        if (external !== undefined) {
          const externalDefinition = getCommandDefinition(external);
          if (definition.subcommands.some(({ name }) => name === externalDefinition.name)) {
            throw new TypeError(
              `External subcommand '${token}' resolved to declared subcommand '${externalDefinition.name}'`,
            );
          }
          validateBuiltInCollisions(externalDefinition, globals.map(({ argument }) => argument));
          child = externalDefinition;
          session.externalCommands ??= new Map();
          session.externalCommands.set(
            [...path, child.name].join('\u0000'),
            child,
          );
        }
      }
      if (child !== undefined) {
        selectChild(child, index + 1, token);
        break;
      }
    }

    if (positionalArgument === undefined) {
      const suggestions = suggestTokenCandidates(
        token,
        definition,
        inheritedGlobals.map(({ argument }) => argument),
      );
      if (
        defaultChild?.arguments.some(({ kind: argumentKind }) => argumentKind === 'positional') === true
        && wordState.kind === 'command'
        && !suggestions.some((candidate) => hasExactSubcommand(definition, candidate))
      ) {
        selectChild(defaultChild, index);
        break;
      }
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
    const { joinWith } = positionalArgument;
    storePositionalValue(
      positionalArgument,
      joinWith === undefined ? token : argv.slice(index).join(joinWith),
      argvOffset + index,
      definition,
      path,
      state,
      inheritedGlobals.map(({ argument }) => argument),
    );
    if (joinWith !== undefined) {
      break;
    }
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
  if (state.subcommand === undefined && defaultChild !== undefined) {
    selectChild(defaultChild, argv.length);
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
  const overriddenTargets = collectOverrideTargets(definition, state);
  applyEnvironmentFallbacks(
    definition,
    state,
    path,
    inheritedArguments,
    overriddenTargets,
  );
  applyConfigValues(definition, config, path, state, inheritedGlobals);
  applyPromptValues(definition, session.promptValues, path, state, inheritedGlobals);
  applyValueRelations(definition, state, session.env, overriddenTargets);
  refreshInheritedSources(state.subcommand, localGlobals);
  validateParsedValues(
    definition,
    path,
    state,
    inheritedArguments,
    subcommandConflict,
  );
  if (
    definition.subcommands.length > 0
    || definition.externalSubcommand !== undefined
  ) {
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

function hasOptionBinding(
  token: string,
  kind: 'long-option' | 'short-options',
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): boolean {
  const bindings = availableArgumentBindings(definition, state, inheritedGlobals);
  if (kind === 'long-option') {
    const { name } = parseLongOptionToken(token);
    return bindings.some(({ argument }) => argumentLongNames(argument).includes(name));
  }
  for (const short of parseShortOptionCluster(token)) {
    const binding = bindings.find(({ argument }) => argument.short === short);
    if (binding === undefined) {
      return false;
    }
    if (binding.argument.kind === 'option') {
      return true;
    }
  }
  return true;
}
