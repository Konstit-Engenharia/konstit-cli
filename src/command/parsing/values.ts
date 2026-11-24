import {
  ArgumentAction,
  type ArgumentDefinition,
} from '../../argument/index.js';
import { commandError } from '../../help/diagnostics.js';
import { createHelpDisplay } from '../../help/render.js';
import {
  displayArgument,
  positionalValueName,
} from '../../help/usage.js';
import {
  DisplayKind,
  ErrorKind,
} from '../../result/error.js';
import { readEnv } from '../environment.js';
import type { CommandDefinition } from '../schema.js';
import type { CommandValidationIssue } from '../types.js';
import {
  recordSuppliedArgument,
  suppliedArgument,
  suppliedArgumentNames,
  type InputSource,
} from './argument-state.js';
import { splitArgumentValue } from './recognition.js';
import { validateRelations } from './relations.js';
import {
  DisplayRequest,
  type ParseState,
  type SubcommandConflict,
} from './types.js';

export function splitRawValue(argument: ArgumentDefinition, raw: string): readonly string[] {
  return splitArgumentValue(argument, raw);
}

export function storePositionalValue(
  argument: ArgumentDefinition,
  raw: string,
  tokenIndex: number,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  const values = splitRawValue(argument, raw);
  const previous = suppliedArgument(state, argument.name);
  const currentCount = previous?.source === 'cli' ? previous.valueCount : 0;
  if (
    !argument.repeatable
    && argument.maxValues !== null
    && currentCount + values.length > argument.maxValues
  ) {
    throw commandError(
      ErrorKind.TooManyValues,
      `argument '${displayArgument(argument)}' accepts at most ${argument.maxValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: argument.name,
        tokenIndex,
      },
    );
  }
  storeRawValues(
    argument,
    values,
    argument.name,
    definition,
    path,
    state,
    'cli',
    values.map(() => tokenIndex),
    tokenIndex,
    inheritedArguments,
  );
}

export function storeRawValues(
  argument: ArgumentDefinition,
  rawValues: readonly string[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  source: InputSource = 'cli',
  tokenIndices?: readonly number[],
  tokenIndex?: number,
  inheritedArguments: readonly ArgumentDefinition[] = [],
  argsOverrideSelf = definition.argsOverrideSelf,
): void {
  storeParsedValues(
    argument,
    rawValues.map((raw, index) =>
      parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        argument.parser,
        source,
        tokenIndices?.[index],
        inheritedArguments,
      )
    ),
    display,
    definition,
    path,
    state,
    source,
    tokenIndex ?? tokenIndices?.[0],
    inheritedArguments,
    argsOverrideSelf,
  );
}

export function storeParsedValues(
  argument: ArgumentDefinition,
  values: readonly unknown[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  source: InputSource = 'cli',
  tokenIndex?: number,
  inheritedArguments: readonly ArgumentDefinition[] = [],
  argsOverrideSelf = definition.argsOverrideSelf,
): void {
  const collectsValues = argument.repeatable
    || argument.trailingVarArg
    || argument.maxValues !== 1;
  const previous = state.argumentStates.get(argument.name);
  const replaceSource = previous?.source !== undefined && previous.source !== source;
  const repeatedOption = argument.kind === 'option'
    && !argument.repeatable
    && source === 'cli'
    && previous?.kind === 'supplied'
    && previous.input === 'cli';
  if (repeatedOption && !argsOverrideSelf) {
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${display}' cannot be used more than once`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: argument.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }

  if (replaceSource || repeatedOption) {
    state.values[argument.name] = collectsValues ? [] : undefined;
    state.argumentStates.delete(argument.name);
  }

  if (collectsValues) {
    const current = state.values[argument.name];
    if (current === undefined) {
      state.values[argument.name] = [...values];
    } else if (Array.isArray(current)) {
      current.push(...values);
    } else {
      throw new Error(`Internal parser state for '${argument.name}' is not an array`);
    }
  } else if (values.length > 0) {
    state.values[argument.name] = values[0];
  }
  const previousCount = suppliedArgument(state, argument.name)?.valueCount ?? 0;
  recordSuppliedArgument(state, argument.name, source, {
    valueCount: previousCount + values.length,
    tokenIndex: source === 'cli' ? tokenIndex : undefined,
  });
}

export function storeSwitch(
  argument: ArgumentDefinition,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
  explicitValue?: boolean,
  tokenIndex?: number,
  argsOverrideSelf = definition.argsOverrideSelf,
): void {
  if (
    argument.action === ArgumentAction.Help
    || argument.action === ArgumentAction.HelpShort
    || argument.action === ArgumentAction.HelpLong
  ) {
    throw new DisplayRequest(createHelpDisplay(
      definition,
      path,
      inheritedArguments,
      { includeLongAbout: argument.action !== ArgumentAction.HelpShort, hideStandardFlags: state.hideStandardFlags },
    ));
  }
  if (argument.action === ArgumentAction.Version) {
    if (definition.version === undefined) {
      throw new TypeError(
        `Command '${path.join(' ')}' must define a version for '${display}'`,
      );
    }
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Version,
      output: `${definition.name} ${definition.version}\n`,
    });
  }
  const previous = suppliedArgument(state, argument.name);
  const repeated = previous?.input === 'cli';
  const colorDisabled = argument.color && readEnv(state.session.env, 'NO_COLOR') !== undefined;
  if (
    argument.action === ArgumentAction.SetTrue
    || argument.action === ArgumentAction.SetFalse
  ) {
    const nextValue = explicitValue ?? argument.action === ArgumentAction.SetTrue;
    const pairedColorConflict = argument.color
      && (colorDisabled || state.values[argument.name] !== nextValue);
    if (repeated && (!argsOverrideSelf || pairedColorConflict)) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `argument '${display}' cannot be used more than once`,
        definition,
        path,
        inheritedArguments,
        {
          argumentName: argument.name,
          ...(tokenIndex === undefined ? {} : { tokenIndex }),
        },
      );
    }
    state.values[argument.name] = colorDisabled ? false : nextValue;
    if (argument.color) {
      state.session.colorMode = state.values[argument.name] === true
        ? 'always'
        : 'never';
    }
  } else if (argument.action === ArgumentAction.Count) {
    const current = state.values[argument.name];
    state.values[argument.name] = previous?.source === 'cli' && typeof current === 'number'
      ? current + 1
      : 1;
  } else {
    throw new Error(`Action '${argument.action}' is not a switch action`);
  }
  recordSuppliedArgument(state, argument.name, 'cli', { source: colorDisabled ? 'env' : 'cli', tokenIndex });
}

export function parseWith(
  argument: ArgumentDefinition,
  raw: string,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  overrideParser = argument.parser,
  source: InputSource = 'cli',
  tokenIndex?: number,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): unknown {
  if (overrideParser === undefined) {
    throw new Error(`Argument '${argument.name}' has no value parser`);
  }
  try {
    const parsed = overrideParser.parse(raw);
    if (parsed === undefined) {
      throw new TypeError('a value parser returned undefined');
    }
    return parsed;
  } catch (cause) {
    const label = source === 'cli' && argument.kind === 'positional'
      ? `<${positionalValueName(argument)}>`
      : `'${display}'`;
    throw commandError(
      ErrorKind.InvalidValue,
      source !== 'cli' || argument.sensitive
        ? `invalid value for ${label}`
        : `invalid value '${raw}' for ${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: argument.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
}

export function reportValidationIssue(
  issue: CommandValidationIssue,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  if (
    issue === null
    || typeof issue !== 'object'
    || typeof issue.argumentName !== 'string'
    || typeof issue.message !== 'string'
    || (issue.relatedArguments !== undefined && !Array.isArray(issue.relatedArguments))
  ) {
    throw new TypeError(`Validator for '${path.join(' ')}' must return a validation issue or undefined`);
  }
  const { argumentName, message, relatedArguments = [] } = issue;
  const resolveArgument = (name: string): ArgumentDefinition => {
    const argument = definition.arguments.find((candidate) => candidate.name === name);
    if (argument === undefined) {
      throw new TypeError(`Validator for '${path.join(' ')}' referenced an unknown argument`);
    }
    return argument;
  };
  const argument = resolveArgument(argumentName);
  const related = Array.from(relatedArguments, resolveArgument);
  const hideDetail = argument.sensitive || related.some((candidate) => candidate.sensitive);
  const supplied = suppliedArgument(state, argumentName);
  const tokenIndex = supplied?.source === 'cli' ? supplied.tokenIndex : undefined;
  const label = `invalid value for '${displayArgument(argument)}'`;
  throw commandError(
    ErrorKind.InvalidValue,
    hideDetail ? label : `${label}: ${message}`,
    definition,
    path,
    inheritedArguments,
    { argumentName, relatedArguments, ...(tokenIndex === undefined ? {} : { tokenIndex }) },
  );
}

export function validateParsedValues(
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
  subcommandConflict: SubcommandConflict | undefined,
): void {
  const missingArguments = definition.arguments.filter(
    (argument) => argument.presence === 'required' && suppliedArgument(state, argument.name) === undefined,
  );
  const firstMissing = missingArguments[0];
  if (firstMissing !== undefined) {
    const missing = missingArguments.map(displayArgument);
    throw commandError(
      ErrorKind.MissingRequiredArgument,
      `the following required arguments were not provided: ${missing.join(', ')}`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: firstMissing.name,
        relatedArguments: missingArguments.slice(1).map(({ name }) => name),
      },
    );
  }
  const tooShort = definition.arguments.find((argument) => {
    const supplied = suppliedArgument(state, argument.name);
    return (argument.kind === 'option' || argument.kind === 'positional')
      && supplied !== undefined
      && supplied.valueCount < argument.minValues;
  });
  if (tooShort !== undefined) {
    const tokenIndex = suppliedArgument(state, tooShort.name)?.tokenIndex;
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${displayArgument(tooShort)}' requires at least ${tooShort.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: tooShort.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
  const incompleteRepeatable = definition.arguments.find((argument) => {
    const supplied = suppliedArgument(state, argument.name);
    if (
      !argument.repeatable
      || supplied === undefined
      || argument.minValues === 0
      || argument.maxValues === null
    ) {
      return false;
    }
    const count = supplied.valueCount;
    return Math.ceil(count / argument.maxValues)
      > Math.floor(count / argument.minValues);
  });
  if (incompleteRepeatable !== undefined) {
    const tokenIndex = suppliedArgument(state, incompleteRepeatable.name)?.tokenIndex;
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${
        displayArgument(incompleteRepeatable)
      }' requires complete occurrences of ${incompleteRepeatable.minValues} to ${incompleteRepeatable.maxValues} value(s)`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: incompleteRepeatable.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
  if (
    definition.argRequiredElseHelp
    && suppliedArgumentNames(state).next().done === true
    && state.subcommand === undefined
  ) {
    throw new DisplayRequest(createHelpDisplay(
      definition,
      path,
      inheritedArguments,
      { hideStandardFlags: state.hideStandardFlags },
    ));
  }
  if (definition.subcommandRequired && state.subcommand === undefined) {
    throw commandError(
      ErrorKind.MissingSubcommand,
      'a subcommand is required but one was not provided',
      definition,
      path,
      inheritedArguments,
    );
  }
  validateRelations(definition, path, state, inheritedArguments);
  if (subcommandConflict !== undefined && state.subcommand !== undefined) {
    const { argument, tokenIndex } = subcommandConflict;
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${displayArgument(argument)}' cannot be used with subcommand '${state.subcommand.name}'`,
      definition,
      path,
      inheritedArguments,
      {
        argumentName: argument.name,
        ...(tokenIndex === undefined ? {} : { tokenIndex }),
      },
    );
  }
}
