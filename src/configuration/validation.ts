import type { ArgumentDefinition } from '../argument/index.js';
import type { CommandDefinition } from '../command/schema.js';
import { getCommandDefinition } from '../command/store.js';
import type { CommandType } from '../command/types.js';
import {
  validateConfigShape,
  type CommandConfig,
} from './shape.js';
import { prepareConfigValue } from './value.js';

/** The category of one issue found while validating a command configuration. */
export type ConfigValidationIssueKind =
  | 'unknown-argument'
  | 'unknown-subcommand'
  | 'invalid-value'
  | 'too-few-values'
  | 'too-many-values';

/** A machine-readable issue associated with one config path. */
export interface ConfigValidationIssue {
  readonly kind: ConfigValidationIssueKind;
  readonly path: readonly string[];
  readonly commandPath: readonly string[];
  readonly argumentName?: string;
  readonly message: string;
}

/** The result of validating every branch represented by a command config tree. */
export interface ConfigValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ConfigValidationIssue[];
}

interface ConfigValidationContext {
  readonly definition: CommandDefinition;
  readonly config: CommandConfig | undefined;
  readonly commandPath: readonly string[];
  readonly inheritedArguments: readonly ArgumentDefinition[];
  readonly path: readonly string[];
}

function freezeIssue(issue: ConfigValidationIssue): ConfigValidationIssue {
  return Object.freeze({
    ...issue,
    path: Object.freeze([...issue.path]),
    commandPath: Object.freeze([...issue.commandPath]),
  });
}

function createIssue(
  kind: ConfigValidationIssueKind,
  path: readonly string[],
  commandPath: readonly string[],
  message: string,
  argumentName?: string,
): ConfigValidationIssue {
  return freezeIssue({
    kind,
    path,
    commandPath,
    ...(argumentName === undefined ? {} : { argumentName }),
    message,
  });
}

function argumentFor(
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[],
  name: string,
): ArgumentDefinition | undefined {
  return [...inheritedArguments, ...definition.arguments].find((argument) => argument.name === name);
}

function validateArgumentValue(
  argument: ArgumentDefinition,
  value: unknown,
  path: readonly string[],
  commandPath: readonly string[],
): ConfigValidationIssue | undefined {
  const prepared = prepareConfigValue(argument, value);
  if (prepared.kind === 'error') {
    const reason = prepared.reason;
    if (reason === 'max') {
      return createIssue(
        'too-many-values',
        path,
        commandPath,
        `Config argument '${argument.name}' accepts at most ${argument.maxValues} value(s)`,
        argument.name,
      );
    }
    if (reason === 'occurrences') {
      return createIssue(
        'too-few-values',
        path,
        commandPath,
        `Config argument '${argument.name}' requires complete occurrences of ${argument.minValues} to ${argument.maxValues} value(s)`,
        argument.name,
      );
    }
    const message = reason === 'boolean'
      ? `Config value for '${argument.name}' must be a boolean`
      : reason === 'count'
      ? `Config value for '${argument.name}' must be a nonnegative integer`
      : `Config value for '${argument.name}' must be a string or string array`;
    return createIssue('invalid-value', path, commandPath, message, argument.name);
  }
  if (prepared.kind === 'switch') {
    return undefined;
  }
  const values = prepared.values;
  const parser = argument.parser as NonNullable<ArgumentDefinition['parser']>;
  for (const raw of values) {
    try {
      const parsed = parser.parse(raw);
      if (parsed === undefined) {
        throw new TypeError('a value parser returned undefined');
      }
    } catch (error) {
      const detail = argument.sensitive
        ? 'contains an invalid value'
        : `contains an invalid value: ${error instanceof Error ? error.message : String(error)}`;
      return createIssue(
        'invalid-value',
        path,
        commandPath,
        `Config argument '${argument.name}' ${detail}`,
        argument.name,
      );
    }
  }
  if (values.length < argument.minValues) {
    return createIssue(
      'too-few-values',
      path,
      commandPath,
      `Config argument '${argument.name}' requires at least ${argument.minValues} value(s)`,
      argument.name,
    );
  }
  return undefined;
}

function validateConfigNode(
  context: ConfigValidationContext,
  issues: ConfigValidationIssue[],
): void {
  const values = context.config?.values;
  if (values !== undefined) {
    for (const [name, value,] of Object.entries(values)) {
      const argument = argumentFor(context.definition, context.inheritedArguments, name);
      const path = [...context.path, 'values', name];
      if (argument === undefined) {
        issues.push(createIssue(
          'unknown-argument',
          path,
          context.commandPath,
          `Unknown config argument '${name}' for command '${context.commandPath.join(' ')}'`,
          name,
        ));
        continue;
      }
      const validationIssue = validateArgumentValue(argument, value, path, context.commandPath);
      if (validationIssue !== undefined) {
        issues.push(validationIssue);
      }
    }
  }

  const subcommands = context.config?.subcommands;
  if (subcommands === undefined) {
    return;
  }
  const childGlobals = [
    ...context.inheritedArguments,
    ...context.definition.arguments,
  ].filter(({ global }) => global);
  for (const [name, childConfig,] of Object.entries(subcommands)) {
    const child = context.definition.subcommands.find((candidate) => candidate.name === name);
    const childPath = [...context.path, 'subcommands', name];
    const childCommandPath = [...context.commandPath, name];
    if (child === undefined) {
      issues.push(createIssue(
        'unknown-subcommand',
        childPath,
        context.commandPath,
        `Unknown config subcommand '${name}' for command '${context.commandPath.join(' ')}'`,
      ));
      continue;
    }
    validateConfigNode(
      {
        definition: child,
        config: childConfig,
        commandPath: childCommandPath,
        inheritedArguments: childGlobals,
        path: childPath,
      },
      issues,
    );
  }
}

/** Validates values and keys across every configured command branch. */
export function validateConfig(
  cli: CommandType,
  config: CommandConfig | undefined,
): ConfigValidationResult {
  validateConfigShape(config);
  const definition = getCommandDefinition(cli);
  const issues: ConfigValidationIssue[] = [];
  validateConfigNode(
    {
      definition,
      config,
      commandPath: [definition.name],
      inheritedArguments: [],
      path: ['config'],
    },
    issues,
  );
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
  });
}
