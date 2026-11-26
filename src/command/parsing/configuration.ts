import {
  ArgumentAction,
  type ArgumentDefinition,
} from '../../argument/index.js';
import { configEntryFile } from '../../configuration/origin.js';
import {
  validateConfigShape,
  type CommandConfig,
  type ConfigValue,
} from '../../configuration/shape.js';
import { prepareConfigValue } from '../../configuration/value.js';
import { commandError } from '../../help/diagnostics.js';
import { parsers } from '../../parser/index.js';
import { ErrorKind } from '../../result/error.js';
import {
  readEnv,
  type Environment,
} from '../environment.js';
import type { CommandDefinition } from '../schema.js';
import {
  environmentPolicy,
  hasCommandLineInput,
  recordSuppliedArgument,
  suppliedArgument,
} from './argument-state.js';
import { availableArgumentBindings } from './state.js';
import type {
  GlobalBinding,
  ParseState,
} from './types.js';
import {
  parseWith,
  splitRawValue,
  storeRawValues,
} from './values.js';

function configSubcommand(
  definition: CommandDefinition,
  name: string,
): CommandDefinition | undefined {
  return definition.subcommands.find(
    (child) => child.name === name,
  );
}

export function validateConfigForCommand(
  definition: CommandDefinition,
  config: CommandConfig | undefined,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): void {
  if (config === undefined) {
    return;
  }
  const values = config.values;
  if (values !== undefined) {
    const bindings = availableArgumentBindings(definition, state, inheritedGlobals);
    for (const name of Object.keys(values)) {
      if (!bindings.some(({ argument }) => argument.name === name)) {
        throw commandError(
          ErrorKind.UnknownArgument,
          `unknown config argument '${name}' for command '${path.join(' ')}'`,
          definition,
          path,
          inheritedGlobals.map(({ argument }) => argument),
        );
      }
    }
  }
  if (config.subcommands !== undefined) {
    for (const [name, childConfig,] of Object.entries(config.subcommands)) {
      if (configSubcommand(definition, name) === undefined) {
        throw commandError(
          ErrorKind.InvalidSubcommand,
          `unknown config subcommand '${name}' for command '${path.join(' ')}'`,
          definition,
          path,
          inheritedGlobals.map(({ argument }) => argument),
        );
      }
      // Structural validation for every configured branch happens up front;
      // argument validation is intentionally deferred to the selected branch.
      validateConfigShape(childConfig, ['config', ...path.slice(1), 'subcommands', name]);
    }
  }
}

function configArgumentValue(
  value: ConfigValue,
  argument: ArgumentDefinition,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  const prepared = prepareConfigValue(argument, value);
  if (prepared.kind === 'switch') {
    state.values[argument.name] = argument.color && readEnv(state.session.env, 'NO_COLOR') !== undefined
      ? false
      : prepared.value;
    recordSuppliedArgument(state, argument.name, 'config');
    if (argument.color) {
      state.session.colorMode = state.values[argument.name] === true
        ? 'always'
        : 'never';
    }
    return;
  }
  if (prepared.kind === 'error') {
    switch (prepared.reason) {
      case 'boolean':
        throw new TypeError(`Config value for '${display}' must be a boolean`);
      case 'count':
        throw new TypeError(`Config value for '${display}' must be a nonnegative integer`);
      case 'strings':
        throw new TypeError(`Config value for '${display}' must be a string or string array`);
      case 'max':
        throw commandError(
          ErrorKind.TooManyValues,
          `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
          definition,
          path,
          inheritedArguments,
          { argumentName: argument.name },
        );
      case 'occurrences':
        throw commandError(
          ErrorKind.TooFewValues,
          `argument '${display}' requires complete occurrences of ${argument.minValues} to ${argument.maxValues} value(s)`,
          definition,
          path,
          inheritedArguments,
          { argumentName: argument.name },
        );
    }
  }
  storeRawValues(
    argument,
    prepared.values,
    display,
    definition,
    path,
    state,
    'config',
    undefined,
    undefined,
    inheritedArguments,
  );
}

export function applyConfigValues(
  definition: CommandDefinition,
  config: CommandConfig | undefined,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): void {
  if (config?.values === undefined) {
    return;
  }
  const inheritedArguments = inheritedGlobals.map(({ argument }) => argument);
  for (const [name, value,] of Object.entries(config.values)) {
    const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
      ({ argument }) => argument.name === name,
    );
    const source = binding?.state.argumentStates.get(name)?.source;
    if (
      binding === undefined
      || hasCommandLineInput(binding.state, name)
      || source === 'env'
      || source === 'config'
      || hasEnvironmentValue(state.session.env, binding.argument)
      || isOverriddenTarget(binding.definition, binding.state, name)
    ) {
      continue;
    }
    configArgumentValue(
      value,
      binding.argument,
      `config:${name}`,
      definition,
      path,
      binding.state,
      inheritedArguments,
    );
    const file = binding.argument.sensitive ? undefined : configEntryFile(config, name);
    const supplied = suppliedArgument(binding.state, name);
    if (file !== undefined && supplied !== undefined) {
      binding.state.argumentStates.set(name, { ...supplied, configFile: file });
    }
  }
}

function hasEnvironmentValue(env: Environment, argument: ArgumentDefinition): boolean {
  return argument.env !== undefined && readEnv(env, argument.env) !== undefined;
}

function isOverriddenTarget(
  definition: CommandDefinition,
  state: ParseState,
  name: string,
): boolean {
  return definition.overrides.some(
    ({ source, target }) => target === name && hasCommandLineInput(state, source),
  );
}

export function applyEnvironmentFallbacks(
  definition: CommandDefinition,
  state: ParseState,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
  overriddenTargets: ReadonlySet<string>,
): void {
  for (const argument of definition.arguments) {
    if (
      argument.env === undefined
      || hasCommandLineInput(state, argument.name)
      || overriddenTargets.has(argument.name)
    ) {
      continue;
    }
    const raw = readEnv(state.session.env, argument.env);
    if (raw === undefined) {
      continue;
    }
    if (argument.kind === 'flag') {
      state.values[argument.name] = argument.color
        ? false
        : argument.action === ArgumentAction.SetTrue;
      if (argument.color) {
        state.session.colorMode = 'never';
        state.argumentStates.set(argument.name, environmentPolicy);
      } else {
        recordSuppliedArgument(state, argument.name, 'env');
      }
      continue;
    }
    const display = `env:${argument.env}`;
    if (argument.kind === 'count') {
      const count = parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        parsers.integer,
        'env',
        undefined,
        inheritedArguments,
      );
      if (typeof count !== 'number' || count < 0) {
        throw commandError(
          ErrorKind.InvalidValue,
          `invalid value for '${display}'`,
          definition,
          path,
          inheritedArguments,
          { argumentName: argument.name },
        );
      }
      state.values[argument.name] = count;
      recordSuppliedArgument(state, argument.name, 'env');
      continue;
    }

    const values = splitRawValue(argument, raw);
    const delimiterCanExpandSingle = argument.repeatable && argument.maxValues === 1;
    if (
      !delimiterCanExpandSingle
      && argument.maxValues !== null
      && values.length > argument.maxValues
    ) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
        definition,
        path,
        inheritedArguments,
        { argumentName: argument.name },
      );
    }
    storeRawValues(
      argument,
      values,
      display,
      definition,
      path,
      state,
      'env',
      undefined,
      undefined,
      inheritedArguments,
    );
  }
}
