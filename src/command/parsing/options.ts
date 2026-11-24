import type { ArgumentDefinition } from '../../argument/index.js';
import {
  commandError,
  suggestToken,
  suggestTokenCandidates,
} from '../../help/diagnostics.js';
import { collectDeprecation } from '../../result/deprecation.js';
import { ErrorKind } from '../../result/error.js';
import type { CommandDefinition } from '../schema.js';
import {
  argumentLongNames,
  optionAcceptsMoreValues,
  parseLongOptionToken,
  parseShortOptionCluster,
  recognizeOptionValue,
  type OptionValueState,
} from './recognition.js';
import {
  availableArgumentBindings,
  deprecatedAliasMessage,
} from './state.js';
import { resolveSubcommandWithArguments } from './subcommands.js';
import type {
  GlobalBinding,
  ParseState,
} from './types.js';
import {
  splitRawValue,
  storeParsedValues,
  storeRawValues,
  storeSwitch,
} from './values.js';

export function parseLongOption(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
  argvOffset: number,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const { name, inlineValue } = parseLongOptionToken(token);
  const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
    ({ argument }) => argumentLongNames(argument).includes(name),
  );
  if (binding === undefined || binding.argument.kind === 'positional') {
    const suggestions = suggestTokenCandidates(
      `--${name}`,
      definition,
      inheritedGlobals.map(({ argument }) => argument),
    );
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
      {
        tokenIndex: argvOffset + index,
        suggestions,
      },
    );
  }
  const { argument, definition: argumentDefinition } = binding;
  collectDeprecation(
    state.session.warnings,
    'argument',
    argument.name,
    argument.deprecated,
    path,
    argument.name,
  );
  if (argument.aliases.includes(name)) {
    collectDeprecation(
      state.session.warnings,
      'alias',
      name,
      deprecatedAliasMessage(argument.deprecatedAliases, name),
      path,
      argument.name,
    );
  }
  if (argument.kind === 'flag' || argument.kind === 'count') {
    if (inlineValue !== undefined) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '--${name}' does not accept a value`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
        { argumentName: argument.name, tokenIndex: argvOffset + index },
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
      argvOffset + index,
      argumentDefinition.argsOverrideSelf,
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
        'cli',
        argvOffset + index,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
        argumentDefinition.argsOverrideSelf,
      );
      return index + 1;
    }
    throw commandError(
      ErrorKind.NoEquals,
      `an equals sign is required for '--${name}=<VALUE>'`,
      definition,
      path,
      inheritedGlobals.map(({ argument }) => argument),
      {
        argumentName: argument.name,
        tokenIndex: argvOffset + index,
      },
    );
  }
  const consumed = consumeOptionValues(
    argument,
    argv,
    index,
    inlineValue,
    argvOffset,
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
      'cli',
      argvOffset + index,
      inheritedGlobals.map(({ argument: inherited }) => inherited),
      argumentDefinition.argsOverrideSelf,
    );
  } else {
    storeRawValues(
      argument,
      consumed.values,
      `--${name}`,
      definition,
      path,
      binding.state,
      false,
      'cli',
      consumed.valueIndices,
      argvOffset + index,
      inheritedGlobals.map(({ argument: inherited }) => inherited),
      argumentDefinition.argsOverrideSelf,
    );
  }
  return consumed.nextIndex;
}

export function parseShortOptions(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
  argvOffset: number,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const cluster = parseShortOptionCluster(token);
  for (const [clusterIndex, short,] of cluster.entries()) {
    const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
      ({ argument }) => argument.short === short,
    );
    if (binding === undefined || binding.argument.kind === 'positional') {
      const suggestions = suggestTokenCandidates(
        `-${short}`,
        definition,
        inheritedGlobals.map(({ argument }) => argument),
      );
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
        {
          tokenIndex: argvOffset + index,
          suggestions,
        },
      );
    }
    const { argument, definition: argumentDefinition } = binding;
    collectDeprecation(
      state.session.warnings,
      'argument',
      argument.name,
      argument.deprecated,
      path,
      argument.name,
    );
    if (argument.kind === 'flag' || argument.kind === 'count') {
      storeSwitch(
        argument,
        `-${short}`,
        definition,
        path,
        binding.state,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
        undefined,
        argvOffset + index,
        argumentDefinition.argsOverrideSelf,
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
          'cli',
          argvOffset + index,
          inheritedGlobals.map(({ argument: inherited }) => inherited),
          argumentDefinition.argsOverrideSelf,
        );
        return index + 1;
      }
      throw commandError(
        ErrorKind.NoEquals,
        `an attached value is required for '-${short}<VALUE>'`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
        {
          argumentName: argument.name,
          tokenIndex: argvOffset + index,
        },
      );
    }
    const consumed = consumeOptionValues(
      argument,
      argv,
      index,
      hasAttachedValue ? attached : undefined,
      argvOffset,
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
        'cli',
        argvOffset + index,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
        argumentDefinition.argsOverrideSelf,
      );
    } else {
      storeRawValues(
        argument,
        consumed.values,
        `-${short}`,
        definition,
        path,
        binding.state,
        false,
        'cli',
        consumed.valueIndices,
        argvOffset + index,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
        argumentDefinition.argsOverrideSelf,
      );
    }
    return consumed.nextIndex;
  }
  return index + 1;
}

interface ConsumedOptionValues {
  readonly values: readonly string[];
  readonly valueIndices: readonly number[];
  readonly nextIndex: number;
}

function consumeOptionValues(
  argument: ArgumentDefinition,
  argv: readonly string[],
  optionIndex: number,
  inlineValue: string | undefined,
  argvOffset: number,
  definition: CommandDefinition,
  path: readonly string[],
  display: string,
  inheritedArguments: readonly ArgumentDefinition[],
): ConsumedOptionValues {
  const values: string[] = [];
  const valueIndices: number[] = [];
  const optionState: OptionValueState = { kind: 'option-values', argument, consumed: 0 };
  let nextIndex = optionIndex + 1;
  const isSubcommand = (word: string): boolean =>
    resolveSubcommandWithArguments(
      definition,
      word,
      path,
      inheritedArguments,
      argvOffset + nextIndex,
      argument.sensitive,
    ) !== undefined;

  const append = (raw: string, rawIndex: number): void => {
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
        {
          argumentName: argument.name,
          tokenIndex: argvOffset + rawIndex,
        },
      );
    }
    values.push(...parts);
    valueIndices.push(...parts.map(() => argvOffset + rawIndex));
    optionState.consumed = values.length;
  };

  if (inlineValue !== undefined) {
    append(inlineValue, optionIndex);
  }
  while (optionAcceptsMoreValues(optionState)) {
    const raw = argv[nextIndex];
    if (raw === undefined) {
      break;
    }
    const action = recognizeOptionValue(optionState, raw, isSubcommand);
    if (action === 'take-terminator') {
      nextIndex += 1;
      break;
    }
    if (action === 'resume-command') {
      break;
    }
    append(raw, nextIndex);
    nextIndex += 1;
  }

  if (values.length < argument.minValues) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${display}' requires at least ${argument.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: argument.name,
        tokenIndex: argvOffset + optionIndex,
      },
    );
  }
  return { values, valueIndices, nextIndex };
}
