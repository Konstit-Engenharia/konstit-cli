import { readFile } from 'node:fs/promises';
import type { ArgumentDefinition } from './argument.js';
import type { CommandType } from './command.js';
import {
  validateConfigShape,
  type CommandConfig,
} from './command/config.js';
import type { CommandDefinition } from './command/schema.js';
import { getCommandDefinition } from './command/store.js';

type ValueSchema =
  & { readonly description?: string; }
  & (
    | { readonly type: 'boolean'; }
    | { readonly type: 'integer'; readonly minimum: 0; readonly maximum: number; }
    | {
      readonly anyOf: readonly [
        { readonly type: 'string'; },
        { readonly type: 'array'; readonly items: { readonly type: 'string'; }; },
      ];
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
    default:
      return { ...annotations, anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] };
  }
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
  return config as CommandConfig;
}
