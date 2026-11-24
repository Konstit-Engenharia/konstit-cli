import type { ArgumentDefinition } from '../argument/index.js';
import type { CommandDefinition } from '../command/schema.js';
import { getCommandDefinition } from '../command/store.js';
import type { CommandType } from '../command/types.js';
import { isAuthoritativeEnumParser } from '../parser/index.js';

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
