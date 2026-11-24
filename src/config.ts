import { readFile } from 'node:fs/promises';
import type { ArgumentDefinition } from './argument.js';
import type { CommandType } from './command.js';
import { setLoadedConfigFile } from './command/config-origin.js';
import { prepareConfigValue } from './command/config-value.js';
import {
  validateConfigShape,
  type CommandConfig,
} from './command/config.js';
import type { CommandDefinition } from './command/schema.js';
import { getCommandDefinition } from './command/store.js';
import { isAuthoritativeEnumParser } from './parser.js';

interface StringSchema {
  readonly type: 'string';
  readonly enum?: readonly string[];
}

interface ArraySchema {
  readonly type: 'array';
  readonly items: StringSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

type ValueSchema =
  & { readonly description?: string; }
  & (
    | { readonly type: 'boolean'; }
    | { readonly type: 'integer'; readonly minimum: 0; readonly maximum: number; }
    | {
      readonly anyOf: readonly (StringSchema | ArraySchema)[];
    }
  );

interface ObjectSchema<Properties> {
  readonly type: 'object';
  readonly properties: Properties;
  readonly additionalProperties: false;
}

interface CommandSchema extends
  ObjectSchema<{
    readonly values: ObjectSchema<Readonly<Record<string, ValueSchema>>>;
    readonly subcommands: ObjectSchema<Readonly<Record<string, CommandSchema>>>;
  }> {
  readonly description?: string;
}

/** A draft 2020-12 JSON Schema for a command's configuration tree. */
export interface CommandConfigSchema extends CommandSchema {
  readonly $schema: 'https://json-schema.org/draft/2020-12/schema';
  readonly title: string;
  readonly properties: CommandSchema['properties'] & { readonly $schema: { readonly type: 'string'; }; };
}

function objectSchema<Properties>(properties: Properties): ObjectSchema<Properties> {
  return { type: 'object', properties, additionalProperties: false };
}

function valueSchema(argument: ArgumentDefinition): ValueSchema {
  const annotations = argument.help === undefined ? {} : { description: argument.help };
  switch (argument.kind) {
    case 'flag':
      return { ...annotations, type: 'boolean' };
    case 'count':
      return { ...annotations, type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
    default: {
      const choices = argument.parser?.choices;
      const enumValues = argument.sensitive
          || argument.valueDelimiter !== undefined
          || argument.parser === undefined
          || !isAuthoritativeEnumParser(argument.parser)
          || argument.parser.ignoreCase === true
          || choices === undefined
          || choices.some(({ hide }) => hide === true)
        ? undefined
        : choices.flatMap(({ value, aliases }) => [value, ...(aliases ?? [])]);
      const stringSchema: StringSchema = enumValues === undefined
        ? { type: 'string' }
        : { type: 'string', enum: [...enumValues] };
      const arraySchema: ArraySchema = {
        type: 'array',
        items: stringSchema,
        ...arrayAritySchema(argument),
      };
      return {
        ...annotations,
        anyOf: [
          ...(supportsScalarConfigValue(argument) ? [stringSchema] : []),
          arraySchema,
        ],
      };
    }
  }
}

function supportsScalarConfigValue(argument: ArgumentDefinition): boolean {
  return argument.maxValues !== 0
    && (argument.valueDelimiter !== undefined || argument.minValues <= 1);
}

function arrayAritySchema(
  argument: ArgumentDefinition,
): Pick<ArraySchema, 'minItems' | 'maxItems'> {
  // Repeated occurrences can be partitioned in several valid ways, so JSON
  // Schema cannot express their complete occurrence arithmetic faithfully.
  if (argument.valueDelimiter !== undefined) {
    return {};
  }
  if (argument.repeatable) {
    return {
      minItems: argument.minValues,
      ...(argument.maxValues === 0 ? { maxItems: 0 } : {}),
    };
  }
  const minItems = argument.minValues;
  const maxItems = argument.maxValues;
  return {
    minItems,
    ...(maxItems === null ? {} : { maxItems }),
  };
}

function commandSchema(definition: CommandDefinition, inheritedGlobals: readonly ArgumentDefinition[]): CommandSchema {
  const args = [...inheritedGlobals, ...definition.arguments];
  const childGlobals = args.filter(({ global }) => global);
  return {
    ...objectSchema({
      values: objectSchema(Object.fromEntries(args.map((argument) => [argument.name, valueSchema(argument)]))),
      subcommands: objectSchema(Object.fromEntries(
        definition.subcommands.map((child) => [child.name, commandSchema(child, childGlobals)]),
      )),
    }),
    ...(definition.about === undefined ? {} : { description: definition.about }),
  };
}

/** Generates JSON Schema for canonical config keys and their raw JSON value types. */
export function generateConfigSchema(cli: CommandType): CommandConfigSchema {
  const definition = getCommandDefinition(cli);
  const schema = commandSchema(definition, []);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: `${definition.name} configuration`,
    ...schema,
    properties: { $schema: { type: 'string' }, ...schema.properties },
  };
}

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

/** Reads and validates a UTF-8 JSON command configuration file. */
export async function loadConfig(path: string | URL): Promise<CommandConfig> {
  const filename = JSON.stringify(String(path));
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read config file ${filename}. ${String(cause)}`, { cause });
  }

  let config: unknown;
  try {
    config = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (cause) {
    throw new SyntaxError(`Invalid JSON in config file ${filename}. ${String(cause)}`, { cause });
  }

  try {
    validateConfigShape(config);
  } catch (cause) {
    throw new TypeError(`Invalid config file ${filename}. ${String(cause)}`, { cause });
  }
  const typedConfig = config as CommandConfig;
  setLoadedConfigFile(typedConfig, String(path));
  return typedConfig;
}
