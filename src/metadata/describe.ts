import type { ArgumentDefinition } from '../argument/index.js';
import type { CommandDefinition } from '../command/schema.js';
import { getCommandDefinition } from '../command/store.js';
import type { CommandType } from '../command/types.js';
import { resolveExampleCommand } from '../help/usage.js';
import type { ValueParser } from '../parser/index.js';
import { describeRelations } from './describe-relations.js';
import type {
  ArgumentMetadata,
  CommandMetadata,
  CommandMetadataOptions,
  MetadataValue,
  ParserMetadata,
} from './types.js';
import { toMetadataValue } from './value.js';

/**
 * Exports a command's public schema as immutable data.
 *
 * The returned object deliberately omits handlers, parsers' `parse` methods,
 * and dynamic completion callbacks. Defaults are copied only when they can be
 * represented by {@link MetadataValue}. Composite defaults are copied
 * all-or-nothing: an unsupported property, array element, sparse array slot,
 * or cycle omits the complete default instead of shifting or partially
 * rewriting its value.
 */
export function describeCommand(
  command: CommandType,
  options: CommandMetadataOptions = {},
): CommandMetadata {
  const definition = getCommandDefinition(command);
  return describeDefinition(definition, [definition.name], options.includeHidden === true, []);
}

function describeDefinition(
  definition: CommandDefinition,
  path: readonly string[],
  includeHidden: boolean,
  inheritedGlobals: readonly ArgumentDefinition[],
): CommandMetadata {
  const argumentsToDescribe = definition.arguments.filter(
    ({ hidden }) => includeHidden || !hidden,
  );
  const visibleArgumentNames = new Set(argumentsToDescribe.map(({ name }) => name));
  const relations = describeRelations(definition, visibleArgumentNames, includeHidden);
  const parserDefinitions = argumentsToDescribe.map((argument) => describeArgument(argument, includeHidden));
  const inheritedDefinitions = inheritedGlobals.filter(
    ({ hidden }) => includeHidden || !hidden,
  );
  const inheritedParserDefinitions = inheritedDefinitions.map((argument) => describeArgument(argument, includeHidden));
  const childGlobals = uniqueArguments([
    ...inheritedGlobals,
    ...definition.arguments.filter(({ global }) => global),
  ]);
  const subcommands = definition.subcommands
    .filter(({ hidden }) => includeHidden || !hidden)
    .map((subcommand) => describeDefinition(subcommand, [...path, subcommand.name], includeHidden, childGlobals));
  const invocation = path.join(' ');
  const examples = definition.examples?.map((example) =>
    Object.freeze({ command: resolveExampleCommand(example, invocation), description: example.description })
  );

  return Object.freeze({
    name: definition.name,
    path: Object.freeze([...path]),
    ...(definition.deprecated === undefined ? {} : { deprecated: definition.deprecated }),
    ...(definition.deprecatedAliases === undefined
      ? {}
      : {
        deprecatedAliases: copyStringMap(
          definition.deprecatedAliases,
          new Set(
            definition.aliases
              .filter(({ visible }) => includeHidden || visible)
              .map(({ name }) => name),
          ),
        ),
      }),
    aliases: Object.freeze(
      definition.aliases
        .filter(({ visible }) => includeHidden || visible)
        .map(({ name, visible }) => Object.freeze({ name, visible })),
    ),
    ...(definition.about === undefined ? {} : { about: definition.about }),
    ...(definition.longAbout === undefined ? {} : { longAbout: definition.longAbout }),
    ...(definition.author === undefined ? {} : { author: definition.author }),
    ...(definition.beforeHelp === undefined ? {} : { beforeHelp: definition.beforeHelp }),
    ...(definition.afterHelp === undefined ? {} : { afterHelp: definition.afterHelp }),
    ...(examples === undefined ? {} : { examples: Object.freeze(examples) }),
    ...(definition.overrideUsage === undefined ? {} : { overrideUsage: definition.overrideUsage }),
    ...(definition.overrideHelp === undefined ? {} : { overrideHelp: definition.overrideHelp }),
    ...(definition.version === undefined ? {} : { version: definition.version }),
    arguments: Object.freeze(parserDefinitions),
    inheritedArguments: Object.freeze(inheritedParserDefinitions),
    subcommands: Object.freeze(subcommands),
    ...relations,
    subcommandRequired: definition.subcommandRequired,
    argsConflictWithSubcommands: definition.argsConflictWithSubcommands,
    argsOverrideSelf: definition.argsOverrideSelf,
    argRequiredElseHelp: definition.argRequiredElseHelp,
    inferSubcommands: definition.inferSubcommands,
    disableHelpSubcommand: definition.disableHelpSubcommand,
    disableHelpFlag: definition.disableHelpFlag,
    disableVersionFlag: definition.disableVersionFlag,
    hidden: definition.hidden,
  });
}

function describeArgument(argument: ArgumentDefinition, includeHidden: boolean): ArgumentMetadata {
  const hasDefaultValue = argument.presence === 'default';
  const defaultValue = hasDefaultValue && !argument.sensitive
    ? toMetadataValue(argument.defaultValue)
    : undefined;
  const defaultValues = argument.sensitive || argument.defaultValues === undefined
    ? undefined
    : toMetadataValue(argument.defaultValues) as readonly MetadataValue[] | undefined;
  const defaultMissingValue = argument.hasDefaultMissingValue && !argument.sensitive
    ? toMetadataValue(argument.defaultMissingValue)
    : undefined;
  const parser = argument.sensitive || argument.parser === undefined ? undefined : describeParser(argument.parser, includeHidden);
  return Object.freeze({
    name: argument.name,
    kind: argument.kind,
    action: argument.action,
    color: argument.color,
    ...(argument.short === undefined ? {} : { short: argument.short }),
    ...(argument.long === undefined ? {} : { long: argument.long }),
    ...(argument.negativeLong === undefined ? {} : { negativeLong: argument.negativeLong }),
    aliases: Object.freeze([...argument.aliases]),
    ...(argument.deprecated === undefined ? {} : { deprecated: argument.deprecated }),
    ...(argument.deprecatedAliases === undefined
      ? {}
      : { deprecatedAliases: copyStringMap(argument.deprecatedAliases) }),
    ...(argument.help === undefined ? {} : { help: argument.help }),
    ...(argument.helpHeading === undefined ? {} : { helpHeading: argument.helpHeading }),
    ...(argument.valueName === undefined ? {} : { valueName: argument.valueName }),
    presence: argument.presence,
    hasDefaultValue,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(defaultValues === undefined ? {} : { defaultValues }),
    ...(defaultMissingValue === undefined ? {} : { defaultMissingValue }),
    hasDefaultMissingValue: argument.hasDefaultMissingValue,
    repeatable: argument.repeatable,
    ...(argument.unique === true ? { unique: true as const } : {}),
    minValues: argument.minValues,
    maxValues: argument.maxValues,
    arity: Object.freeze({ min: argument.minValues, max: argument.maxValues }),
    ...(argument.valueDelimiter === undefined ? {} : { valueDelimiter: argument.valueDelimiter }),
    ...(argument.valueTerminator === undefined ? {} : { valueTerminator: argument.valueTerminator }),
    requireEquals: argument.requireEquals,
    allowHyphenValues: argument.allowHyphenValues,
    allowNegativeNumbers: argument.allowNegativeNumbers,
    trailingVarArg: argument.trailingVarArg,
    global: argument.global,
    hidden: argument.hidden,
    ...(argument.sensitive ? { sensitive: true as const } : {}),
    ...(argument.env === undefined ? {} : { env: argument.env }),
    ...(argument.completionHint === undefined ? {} : { completionHint: argument.completionHint }),
    hasDynamicCompletion: argument.completion !== undefined,
    ...(parser === undefined ? {} : { parser }),
  });
}

function uniqueArguments(argumentsToMerge: readonly ArgumentDefinition[]): readonly ArgumentDefinition[] {
  const names = new Set<string>();
  const result: ArgumentDefinition[] = [];
  for (const argument of argumentsToMerge) {
    if (!names.has(argument.name)) {
      names.add(argument.name);
      result.push(argument);
    }
  }
  return result;
}

function describeParser(parser: ValueParser<unknown>, includeHidden: boolean): ParserMetadata {
  return Object.freeze({
    label: parser.label,
    ...(parser.completions === undefined
      ? {}
      : { completions: Object.freeze([...parser.completions]) }),
    ...(parser.completionHint === undefined ? {} : { completionHint: parser.completionHint }),
    ...(parser.choices === undefined ? {} : {
      choices: Object.freeze(
        parser.choices
          .filter(({ hide }) => includeHidden || hide !== true)
          .map(({ value, aliases, describe, hide }) =>
            Object.freeze({
              value,
              ...(aliases === undefined ? {} : { aliases: Object.freeze([...aliases]) }),
              ...(describe === undefined ? {} : { describe }),
              ...(hide === undefined ? {} : { hide }),
            })
          ),
      ),
    }),
    ...(parser.ignoreCase === undefined ? {} : { ignoreCase: parser.ignoreCase }),
  });
}

function copyStringMap(
  values: Readonly<Record<string, string>>,
  allowedKeys?: ReadonlySet<string>,
): Readonly<Record<string, string>> {
  const copy: Record<string, string> = {};
  for (const key of Object.keys(values).sort()) {
    if (allowedKeys !== undefined && !allowedKeys.has(key)) {
      continue;
    }
    const value = values[key];
    if (typeof value === 'string') {
      copy[key] = value;
    }
  }
  return Object.freeze(copy);
}
