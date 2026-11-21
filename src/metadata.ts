import type { ArgumentDefinition } from './argument.js';
import {
  getCommandDefinition,
  type CommandDefinition,
  type CommandType,
} from './command.js';
import {
  renderEqualsValueCount,
  renderPositionalCount,
  renderValueCount,
} from './command/syntax.js';
import type {
  CompletionValueHint,
  EnumValue,
  ValueParser,
} from './parser.js';

/** Values that can be copied into public command metadata without callbacks. */
export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly MetadataValue[]
  | {
    /** Each string-keyed property must also be representable as metadata. */
    readonly [key: string]: MetadataValue;
  };

/** The static portion of a value parser exposed by command metadata. */
export interface ParserMetadata {
  /** The parser's default value placeholder in usage and help. */
  readonly label: string;
  /** Raw input strings offered as completions. */
  readonly completions?: readonly string[];
  /** The file or directory fallback for value completion. */
  readonly completionHint?: CompletionValueHint;
  /** The canonical enum choices and their accepted aliases. */
  readonly choices?: readonly EnumValue[];
  /** Whether enum values and aliases are matched case-insensitively. */
  readonly ignoreCase?: boolean;
}

/** Minimum and maximum values consumed by one argument. A null maximum is unbounded. */
export interface ArgumentArityMetadata {
  /** The minimum number of values accepted per occurrence. */
  readonly min: number;
  /** The maximum number of values accepted per occurrence, or null if unbounded. */
  readonly max: number | null;
}

/** A parseable command argument with executable callbacks removed. */
export interface ArgumentMetadata {
  /** The key used for this argument in parsed values. */
  readonly name: string;
  /** Whether the argument is an option, positional, flag, or counter. */
  readonly kind: ArgumentDefinition['kind'];
  /** What the parser does when the argument is supplied. */
  readonly action: ArgumentDefinition['action'];
  /** Whether the flag controls automatic color selection. */
  readonly color: boolean;
  /** The short spelling without its leading hyphen. */
  readonly short?: string;
  /** The long spelling without its leading hyphens. */
  readonly long?: string;
  /** The long spelling that disables a color flag, without leading hyphens. */
  readonly negativeLong?: string;
  /** Additional long spellings without leading hyphens. */
  readonly aliases: readonly string[];
  /** The warning message emitted when the argument is supplied explicitly. */
  readonly deprecated?: string;
  /** Warning messages keyed by deprecated long alias. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** The description shown in help. */
  readonly help?: string;
  /** The value placeholder shown in usage and help. */
  readonly valueName?: string;
  /** The argument's requiredness or default status. */
  readonly presence: ArgumentDefinition['presence'];
  /** Whether the argument's presence mode is `default`, even if its value cannot be copied. */
  readonly hasDefaultValue: boolean;
  /** The scalar fallback when the argument is absent, if representable as metadata. */
  readonly defaultValue?: MetadataValue;
  /** The collection fallback when the argument is absent, if representable as metadata. */
  readonly defaultValues?: readonly MetadataValue[];
  /** The fallback for an option used without a value, if representable as metadata. */
  readonly defaultMissingValue?: MetadataValue;
  /** Whether a missing-value fallback was configured, even if its value cannot be copied. */
  readonly hasDefaultMissingValue: boolean;
  /** Whether values are collected across repeated occurrences. */
  readonly repeatable: boolean;
  /** The minimum number of values accepted per occurrence. */
  readonly minValues: number;
  /** The maximum number of values accepted per occurrence, or null if unbounded. */
  readonly maxValues: number | null;
  /** The minimum and maximum accepted value counts. */
  readonly arity: ArgumentArityMetadata;
  /** The delimiter used to split raw values before parsing. */
  readonly valueDelimiter?: string;
  /** The token that ends value collection for the argument. */
  readonly valueTerminator?: string;
  /** Whether the option requires `--option=value` syntax. */
  readonly requireEquals: boolean;
  /** Whether values may begin with a hyphen. */
  readonly allowHyphenValues: boolean;
  /** Whether negative numeric tokens are accepted as values. */
  readonly allowNegativeNumbers: boolean;
  /** Whether this positional can capture trailing tokens that look like options. */
  readonly trailingVarArg: boolean;
  /** Whether the argument is inherited by descendant commands. */
  readonly global: boolean;
  /** Whether the argument is omitted from help and completion. */
  readonly hidden: boolean;
  /** The environment variable used as a fallback. */
  readonly env?: string;
  /** The argument's explicit file or directory completion hint. */
  readonly completionHint?: CompletionValueHint;
  /** Whether the argument has a dynamic value completer. */
  readonly hasDynamicCompletion: boolean;
  /** The static information for this argument's value parser. */
  readonly parser?: ParserMetadata;
}

/** A command alias with no reference to the command's executable definition. */
export interface CommandAliasMetadata {
  /** The alternative spelling accepted by the parser. */
  readonly name: string;
  /** Whether the alias appears in help and completion. */
  readonly visible: boolean;
}

/** A directional relation between two arguments, such as a dependency or override. */
export interface RequirementMetadata {
  /** The argument that triggers the relation. */
  readonly source: string;
  /** The argument affected by the relation. */
  readonly target: string;
}

/** A requirement that compares either the source or target to an expected value. */
export interface ConditionalRequirementMetadata extends RequirementMetadata {
  /** The comparison value, omitted if it cannot be represented as metadata. */
  readonly expected?: MetadataValue;
}

/** A comparison between a parsed argument and a configured value. */
export interface ValueConditionMetadata {
  /** The name of the argument being compared. */
  readonly source: string;
  /** The expected value, omitted if it cannot be represented as metadata. */
  readonly expected?: MetadataValue;
}

/** A requirement triggered by matching any or all of a set of value conditions. */
export interface ConditionalSetRequirementMetadata {
  /** The argument required when the conditions match. */
  readonly target: string;
  /** The conditions evaluated for the target. */
  readonly conditions: readonly ValueConditionMetadata[];
  /** Whether any condition or every condition must match. */
  readonly match: 'any' | 'all';
}

/** A requirement that can be waived by supplying alternative arguments. */
export interface RequiredUnlessMetadata {
  /** The argument required when the alternatives do not satisfy the rule. */
  readonly target: string;
  /** The arguments whose presence can waive the requirement. */
  readonly alternatives: readonly string[];
}

/** An argument group and its presence, dependency, and conflict rules. */
export interface GroupMetadata {
  /** The group name used in diagnostics. */
  readonly name: string;
  /** The names of arguments in the group. */
  readonly members: readonly string[];
  /** Whether at least one group member must be present. */
  readonly required: boolean;
  /** Whether multiple group members may be present together. */
  readonly multiple: boolean;
  /** Arguments required when a group member is present. */
  readonly requires: readonly string[];
  /** Arguments that cannot be combined with a group member. */
  readonly conflicts: readonly string[];
}

/** Options shared by metadata export and documentation renderers. */
export interface CommandMetadataOptions {
  /** Includes hidden arguments, aliases, and subcommands in the result. */
  readonly includeHidden?: boolean;
}

/** A conditional fallback, with unsupported values omitted from metadata. */
export interface ConditionalDefaultMetadata {
  /** The argument that triggers the fallback. */
  readonly source: string;
  /** The argument that receives the fallback. */
  readonly target: string;
  /** Whether the rule compares the source to a configured value. */
  readonly hasEquals: boolean;
  /** The comparison value if configured and representable as metadata. */
  readonly equals?: MetadataValue;
  /** The fallback value if representable as metadata. */
  readonly value?: MetadataValue;
}

/** An immutable, callback-free description of one command and its descendants. */
export interface CommandMetadata {
  /** The canonical command name. */
  readonly name: string;
  /** Canonical command names from the root to this command. */
  readonly path: readonly string[];
  /** The warning message emitted when the command is invoked. */
  readonly deprecated?: string;
  /** Warning messages keyed by deprecated alias. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** Alternative spellings accepted by the parser. */
  readonly aliases: readonly CommandAliasMetadata[];
  /** The short description shown in help and completion. */
  readonly about?: string;
  /** The extended description shown in full help. */
  readonly longAbout?: string;
  /** The author line shown in help. */
  readonly author?: string;
  /** Text placed before the generated help content. */
  readonly beforeHelp?: string;
  /** Text placed after the generated help content. */
  readonly afterHelp?: string;
  /** Text that replaces the generated usage line. */
  readonly overrideUsage?: string;
  /** Text that replaces the generated help output. */
  readonly overrideHelp?: string;
  /** The text displayed for a version request. */
  readonly version?: string;
  /** Arguments declared directly on this command. */
  readonly arguments: readonly ArgumentMetadata[];
  /** Global arguments inherited from ancestor commands, in canonical order. */
  readonly inheritedArguments: readonly ArgumentMetadata[];
  /** The child commands included in this description. */
  readonly subcommands: readonly CommandMetadata[];
  /** Dependencies triggered by the presence of a source argument. */
  readonly requirements: readonly RequirementMetadata[];
  /** Dependencies triggered by a matching source value. */
  readonly conditionalRequirements: readonly ConditionalRequirementMetadata[];
  /** Each provided source requires its target to match the expected value. */
  readonly requiresValue: readonly ConditionalRequirementMetadata[];
  /** Fallbacks triggered by another argument's presence or value. */
  readonly defaultIf: readonly ConditionalDefaultMetadata[];
  /** Dependencies triggered by matching any or all value conditions. */
  readonly conditionalSetRequirements: readonly ConditionalSetRequirementMetadata[];
  /** Requirements waived when any alternative is present. */
  readonly requiredUnless: readonly RequiredUnlessMetadata[];
  /** Requirements waived when all alternatives are present. */
  readonly requiredUnlessAll: readonly RequiredUnlessMetadata[];
  /** Arguments that conflict with every other supplied argument. */
  readonly exclusiveArguments: readonly string[];
  /** Relations that clear a target when its source is explicitly provided. */
  readonly overrides: readonly RequirementMetadata[];
  /** Sets of mutually exclusive arguments. */
  readonly conflicts: readonly (readonly string[])[];
  /** Named argument groups declared on this command. */
  readonly groups: readonly GroupMetadata[];
  /** Whether invoking the command requires selecting a subcommand. */
  readonly subcommandRequired: boolean;
  /** Whether CLI-supplied local arguments conflict with a selected subcommand. */
  readonly argsConflictWithSubcommands: boolean;
  /** Whether later occurrences of non-repeatable options and ordinary flags replace earlier values. */
  readonly argsOverrideSelf: boolean;
  /** Whether an invocation with no argument or subcommand displays help. */
  readonly argRequiredElseHelp: boolean;
  /** Whether unambiguous subcommand and alias prefixes are accepted. */
  readonly inferSubcommands: boolean;
  /** Whether the generated `help` subcommand is disabled. */
  readonly disableHelpSubcommand: boolean;
  /** Whether the generated `-h` and `--help` flags are disabled. */
  readonly disableHelpFlag: boolean;
  /** Whether the generated `-V` and `--version` flags are disabled. */
  readonly disableVersionFlag: boolean;
  /** Whether the command is omitted from parent help and completion. */
  readonly hidden: boolean;
}

/** Options for Markdown documentation. */
export interface MarkdownOptions extends CommandMetadataOptions {
  /** The main heading. Defaults to the command name. */
  readonly title?: string;
}

/** Options for a man page rendered with standard roff macros. */
export interface ManPageOptions extends CommandMetadataOptions {
  /** The title in the page header. Defaults to the command name. */
  readonly title?: string;
  /** The manual section. Defaults to `1` for executable commands. */
  readonly section?: string;
  /** The date printed in the page header. */
  readonly date?: string;
  /** The project or version printed in the page header. */
  readonly source?: string;
  /** The manual name printed in the page header. */
  readonly manual?: string;
}

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
  const defaultValue = hasDefaultValue
    ? toMetadataValue(argument.defaultValue)
    : undefined;
  const defaultValues = argument.defaultValues === undefined
    ? undefined
    : toMetadataValue(argument.defaultValues) as readonly MetadataValue[] | undefined;
  const defaultMissingValue = argument.hasDefaultMissingValue
    ? toMetadataValue(argument.defaultMissingValue)
    : undefined;
  const parser = argument.parser === undefined ? undefined : describeParser(argument.parser, includeHidden);
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
    ...(argument.valueName === undefined ? {} : { valueName: argument.valueName }),
    presence: argument.presence,
    hasDefaultValue,
    ...(defaultValue === undefined ? {} : { defaultValue }),
    ...(defaultValues === undefined ? {} : { defaultValues }),
    ...(defaultMissingValue === undefined ? {} : { defaultMissingValue }),
    hasDefaultMissingValue: argument.hasDefaultMissingValue,
    repeatable: argument.repeatable,
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

function describeRelations(
  definition: CommandDefinition,
  visibleArguments: ReadonlySet<string>,
  includeHidden: boolean,
): Pick<
  CommandMetadata,
  | 'requirements'
  | 'conditionalRequirements'
  | 'requiresValue'
  | 'defaultIf'
  | 'conditionalSetRequirements'
  | 'requiredUnless'
  | 'requiredUnlessAll'
  | 'exclusiveArguments'
  | 'overrides'
  | 'conflicts'
  | 'groups'
> {
  const isVisible = (name: string): boolean => includeHidden || visibleArguments.has(name);
  const requirements = definition.requirements
    .filter(({ source, target }) => isVisible(source) && isVisible(target))
    .map(({ source, target }) => Object.freeze({ source, target }));
  const defaultIf = definition.defaultIf
    .filter(({ source, target }) => isVisible(source) && isVisible(target))
    .map(({ source, target, hasEquals, equals, value }) => {
      const safeEquals = hasEquals ? toMetadataValue(equals) : undefined;
      const safeValue = toMetadataValue(value);
      return Object.freeze({
        source,
        target,
        hasEquals,
        ...(safeEquals === undefined ? {} : { equals: safeEquals }),
        ...(safeValue === undefined ? {} : { value: safeValue }),
      });
    });
  function describeExpectedValues(rules: CommandDefinition['conditionalRequirements']): readonly ConditionalRequirementMetadata[] {
    return Object.freeze(
      rules
        .filter(({ source, target }) => isVisible(source) && isVisible(target))
        .map(({ source, target, expected }) => {
          const safeExpected = toMetadataValue(expected);
          return Object.freeze({
            source,
            target,
            ...(safeExpected === undefined ? {} : { expected: safeExpected }),
          });
        }),
    );
  }
  const conditionalSetRequirements = definition.conditionalSetRequirements
    .map(({ target, conditions, match }) => {
      if (!isVisible(target) || conditions.some(({ source }) => !isVisible(source))) {
        return undefined;
      }
      return Object.freeze({
        target,
        conditions: Object.freeze(
          conditions.map(({ source, expected }) => {
            const safeExpected = toMetadataValue(expected);
            return Object.freeze({
              source,
              ...(safeExpected === undefined ? {} : { expected: safeExpected }),
            });
          }),
        ),
        match,
      });
    })
    .filter((relation): relation is NonNullable<typeof relation> => relation !== undefined);
  const requiredUnless = describeRequiredUnless(
    definition.requiredUnless,
    isVisible,
  );
  const requiredUnlessAll = describeRequiredUnless(
    definition.requiredUnlessAll,
    isVisible,
  );
  const exclusiveArguments = definition.exclusiveArguments.every(isVisible)
    ? definition.exclusiveArguments
    : [];
  const overrides = definition.overrides
    .filter(({ source, target }) => isVisible(source) && isVisible(target))
    .map(({ source, target }) => Object.freeze({ source, target }));
  const conflicts = definition.conflicts
    .filter((conflict) => conflict.every(isVisible))
    .map((conflict) => Object.freeze([...conflict]));
  const groups = definition.groups
    .map((group) => {
      if (
        !group.members.every(isVisible)
        || !group.requires.every(isVisible)
        || !group.conflicts.every(isVisible)
      ) {
        return undefined;
      }
      return Object.freeze({
        name: group.name,
        members: Object.freeze([...group.members]),
        required: group.required,
        multiple: group.multiple,
        requires: Object.freeze([...group.requires]),
        conflicts: Object.freeze([...group.conflicts]),
      });
    })
    .filter((group): group is NonNullable<typeof group> => group !== undefined);
  return {
    requirements: Object.freeze(requirements),
    defaultIf: Object.freeze(defaultIf),
    conditionalRequirements: describeExpectedValues(definition.conditionalRequirements),
    requiresValue: describeExpectedValues(definition.requiresValue),
    conditionalSetRequirements: Object.freeze(conditionalSetRequirements),
    requiredUnless: Object.freeze(requiredUnless),
    requiredUnlessAll: Object.freeze(requiredUnlessAll),
    exclusiveArguments: Object.freeze([...exclusiveArguments]),
    overrides: Object.freeze(overrides),
    conflicts: Object.freeze(conflicts),
    groups: Object.freeze(groups),
  };
}

function describeRequiredUnless(
  relations: readonly { readonly target: string; readonly alternatives: readonly string[]; }[],
  isVisible: (name: string) => boolean,
): readonly RequiredUnlessMetadata[] {
  return relations.flatMap(({ target, alternatives }) => {
    return isVisible(target) && alternatives.length > 0 && alternatives.every(isVisible)
      ? [Object.freeze({
        target,
        alternatives: Object.freeze([...alternatives]),
      })]
      : [];
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

function toMetadataValue(
  value: unknown,
  active = new WeakSet<object>(),
): MetadataValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (value instanceof RegExp) {
    return `/${value.source}/${value.flags}`;
  }
  if (typeof value !== 'object' || active.has(value)) {
    return undefined;
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const values: MetadataValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return undefined;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !('value' in descriptor)) {
          return undefined;
        }
        const safeItem = toMetadataValue(descriptor.value, active);
        if (safeItem === undefined) {
          return undefined;
        }
        values.push(safeItem);
      }
      return Object.freeze(values);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const copy: Record<string, MetadataValue> = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        return undefined;
      }
      const safeValue = toMetadataValue(descriptor.value, active);
      if (safeValue === undefined) {
        return undefined;
      }
      copy[key] = safeValue;
    }
    return Object.freeze(copy);
  } finally {
    active.delete(value);
  }
}

/** Renders a command description as Markdown suitable for README or site docs. */
export function renderMarkdown(
  command: CommandType,
  options: MarkdownOptions = {},
): string {
  const metadata = describeCommand(command, options);
  const lines = [`# ${markdownInline(options.title ?? metadata.name)}`];
  appendMarkdownCommand(metadata, lines, 2, true);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function appendMarkdownCommand(
  command: CommandMetadata,
  lines: string[],
  headingLevel: number,
  root: boolean,
): void {
  if (command.about !== undefined) {
    lines.push('', markdownText(command.about));
  }
  if (command.deprecated !== undefined) {
    lines.push('', `> **Deprecated:** ${markdownText(command.deprecated)}`);
  }
  if (command.author !== undefined || command.version !== undefined) {
    lines.push(
      '',
      markdownText([
        ...(command.author === undefined ? [] : [`Author: ${command.author}`]),
        ...(command.version === undefined ? [] : [`Version: ${command.version}`]),
      ].join(' · ')),
    );
  }
  if (command.beforeHelp !== undefined) {
    lines.push('', markdownText(command.beforeHelp));
  }
  lines.push('', markdownHeading(headingLevel, 'Usage'), '', markdownInline(command.overrideUsage ?? usageText(command)));
  appendMarkdownArguments(command, lines, headingLevel);
  appendMarkdownCommands(command, lines, headingLevel);
  appendMarkdownRelations(command, lines, headingLevel);
  if (command.longAbout !== undefined) {
    lines.push('', markdownHeading(headingLevel, 'Description'), '', markdownText(command.longAbout));
  }
  if (command.overrideHelp !== undefined) {
    lines.push('', markdownHeading(headingLevel, 'Help'), '', markdownText(command.overrideHelp));
  }
  if (command.afterHelp !== undefined) {
    lines.push('', markdownText(command.afterHelp));
  }
  if (!root) {
    lines.push('', markdownText(`Command path: ${command.path.join(' ')}`));
  }
  for (const child of command.subcommands) {
    lines.push('', markdownHeading(Math.min(6, headingLevel), `Command ${markdownInline(child.path.join(' '))}`));
    appendMarkdownCommand(child, lines, Math.min(6, headingLevel + 1), false);
  }
}

function appendMarkdownArguments(
  command: CommandMetadata,
  lines: string[],
  headingLevel: number,
): void {
  const positionals = command.arguments.filter(({ kind }) => kind === 'positional');
  const options = [
    ...command.inheritedArguments,
    ...command.arguments.filter(({ kind }) => kind !== 'positional'),
  ];
  if (positionals.length > 0) {
    lines.push('', markdownHeading(headingLevel, 'Arguments'));
    for (const argument of positionals) {
      lines.push(`- ${markdownInline(argumentDisplay(argument))} — ${markdownText(argumentDescription(argument))}`);
    }
  }
  if (options.length > 0) {
    lines.push('', markdownHeading(headingLevel, 'Options'));
    for (const argument of options) {
      lines.push(`- ${markdownInline(argumentDisplay(argument))} — ${markdownText(argumentDescription(argument))}`);
    }
  }
}

function appendMarkdownCommands(
  command: CommandMetadata,
  lines: string[],
  headingLevel: number,
): void {
  if (command.subcommands.length === 0) {
    return;
  }
  lines.push('', markdownHeading(headingLevel, 'Commands'));
  for (const child of command.subcommands) {
    const aliases = child.aliases.map(({ name }) => markdownInline(name));
    const aliasText = aliases.length === 0 ? '' : ` (aliases: ${aliases.join(', ')})`;
    lines.push(`- ${markdownInline(child.path.join(' '))}${aliasText} — ${markdownText(child.about ?? '')}`);
  }
}

function appendMarkdownRelations(
  command: CommandMetadata,
  lines: string[],
  headingLevel: number,
): void {
  const relationLines = relationDescriptions(command);
  if (relationLines.length === 0) {
    return;
  }
  lines.push('', markdownHeading(headingLevel, 'Relations'), ...relationLines.map((line) => `- ${line}`));
}

function relationDescriptions(command: CommandMetadata): readonly string[] {
  const lines: string[] = [];
  if (command.argsOverrideSelf) {
    lines.push('Later occurrences replace earlier values for non-repeatable options and ordinary flags');
  }
  for (const { source, target, hasEquals, equals, value } of command.defaultIf) {
    const condition = hasEquals
      ? `${markdownInline(source)} = ${formatMarkdownValue(equals)}`
      : `${markdownInline(source)} is explicitly provided`;
    lines.push(`${markdownInline(target)} defaults to ${formatMarkdownValue(value)} when ${condition}`);
  }
  for (const { source, target } of command.requirements) {
    lines.push(`${markdownInline(source)} requires ${markdownInline(target)}`);
  }
  for (const { source, target, expected } of command.conditionalRequirements) {
    lines.push(`${markdownInline(source)} = ${formatMarkdownValue(expected)} requires ${markdownInline(target)}`);
  }
  for (const { source, target, expected } of command.requiresValue) {
    lines.push(`${markdownInline(source)} requires ${markdownInline(target)} = ${formatMarkdownValue(expected)}`);
  }
  for (const { target, conditions, match } of command.conditionalSetRequirements) {
    const conditionText = conditions
      .map(({ source, expected }) => `${markdownInline(source)} = ${formatMarkdownValue(expected)}`)
      .join(match === 'all' ? ' and ' : ' or ');
    lines.push(`${conditionText} requires ${markdownInline(target)}`);
  }
  for (const { target, alternatives } of [...command.requiredUnless, ...command.requiredUnlessAll]) {
    lines.push(`${markdownInline(target)} is required unless ${alternatives.map(markdownInline).join(', ')}`);
  }
  for (const names of command.conflicts) {
    lines.push(`${names.map(markdownInline).join(', ')} conflict`);
  }
  if (command.exclusiveArguments.length > 0) {
    lines.push(`exclusive: ${command.exclusiveArguments.map(markdownInline).join(', ')}`);
  }
  for (const { source, target } of command.overrides) {
    lines.push(`${markdownInline(source)} overrides ${markdownInline(target)}`);
  }
  for (const group of command.groups) {
    lines.push(`group ${markdownInline(group.name)}: ${group.members.map(markdownInline).join(', ')}`);
  }
  return lines;
}

/** Renders a command description as a safe, section-1 roff man page. */
export function renderManPage(
  command: CommandType,
  options: ManPageOptions = {},
): string {
  const metadata = describeCommand(command, options);
  const title = options.title ?? metadata.name;
  const headerFields = [
    roffQuote(title.toUpperCase()),
    roffQuote(options.section ?? '1'),
  ];
  if (options.date !== undefined || options.source !== undefined || options.manual !== undefined) {
    headerFields.push(roffQuote(options.date ?? ''));
    if (options.source !== undefined || options.manual !== undefined) {
      headerFields.push(roffQuote(options.source ?? ''));
      if (options.manual !== undefined) {
        headerFields.push(roffQuote(options.manual));
      }
    }
  }
  const header = `.TH ${headerFields.join(' ')}`;
  const lines = [header];
  appendManCommand(metadata, lines, true);
  return `${lines.join('\n')}\n`;
}

function appendManCommand(
  command: CommandMetadata,
  lines: string[],
  root: boolean,
): void {
  lines.push('.SH NAME', `${roffText(command.path.join(' '))} \\- ${roffText(command.about ?? 'command-line interface')}`);
  lines.push('.SH SYNOPSIS', `.B ${roffText(command.overrideUsage ?? usageText(command))}`);
  if (command.deprecated !== undefined) {
    lines.push('.PP', `.B Deprecated: ${roffText(command.deprecated)}`);
  }
  if (command.longAbout !== undefined) {
    lines.push('.SH DESCRIPTION', roffText(command.longAbout));
  }
  appendManArguments(command, lines);
  appendManCommands(command, lines);
  appendManRelations(command, lines);
  if (command.author !== undefined || command.version !== undefined) {
    lines.push(
      '.SH INFO',
      roffText([
        ...(command.author === undefined ? [] : [`Author: ${command.author}`]),
        ...(command.version === undefined ? [] : [`Version: ${command.version}`]),
      ].join('\n')),
    );
  }
  if (command.beforeHelp !== undefined) {
    lines.push('.PP', roffText(command.beforeHelp));
  }
  if (command.overrideHelp !== undefined) {
    lines.push('.SH HELP', roffText(command.overrideHelp));
  }
  if (command.afterHelp !== undefined) {
    lines.push('.PP', roffText(command.afterHelp));
  }
  if (!root) {
    lines.push('.PP', `Command path: ${roffText(command.path.join(' '))}`);
  }
  for (const child of command.subcommands) {
    lines.push('.SH COMMAND', `.B ${roffText(child.path.join(' '))}`);
    appendManCommand(child, lines, false);
  }
}

function appendManArguments(command: CommandMetadata, lines: string[]): void {
  const positionals = command.arguments.filter(({ kind }) => kind === 'positional');
  const options = [
    ...command.inheritedArguments,
    ...command.arguments.filter(({ kind }) => kind !== 'positional'),
  ];
  if (positionals.length > 0) {
    lines.push('.SH ARGUMENTS');
    appendManArgumentEntries(positionals, lines);
  }
  if (options.length > 0) {
    lines.push('.SH OPTIONS');
    appendManArgumentEntries(options, lines);
  }
}

function appendManArgumentEntries(
  argumentsToRender: readonly ArgumentMetadata[],
  lines: string[],
): void {
  for (const argument of argumentsToRender) {
    lines.push('.TP', `.B ${roffText(argumentDisplay(argument))}`, roffText(argumentDescription(argument)));
  }
}

function appendManCommands(command: CommandMetadata, lines: string[]): void {
  if (command.subcommands.length === 0) {
    return;
  }
  lines.push('.SH COMMANDS');
  for (const child of command.subcommands) {
    const aliases = child.aliases.map(({ name }) => name);
    const aliasText = aliases.length === 0 ? '' : ` (aliases: ${aliases.join(', ')})`;
    lines.push('.TP', `.B ${roffText(child.path.join(' '))}`, roffText(`${child.about ?? ''}${aliasText}`));
  }
}

function appendManRelations(command: CommandMetadata, lines: string[]): void {
  const relations = relationDescriptions(command);
  if (relations.length === 0) {
    return;
  }
  lines.push('.SH RELATIONS');
  for (const relation of relations) {
    lines.push('.TP', roffText(relation));
  }
}

function usageText(command: CommandMetadata): string {
  const allArguments = [...command.inheritedArguments, ...command.arguments];
  const requiredOptions = allArguments.filter(
    ({ kind, presence }) => kind !== 'positional' && presence === 'required',
  );
  const optionalOptions = allArguments.some(
    ({ kind, presence }) => kind !== 'positional' && presence !== 'required',
  );
  const positionals = command.arguments
    .filter(({ kind }) => kind === 'positional')
    .map((argument) => argumentSyntax(argument));
  return [
    command.path.join(' '),
    ...(optionalOptions ? ['[OPTIONS]'] : []),
    ...requiredOptions.map(argumentSyntax),
    ...positionals,
    ...(command.subcommands.length > 0 ? ['<COMMAND>'] : []),
  ].join(' ');
}

function argumentSyntax(argument: ArgumentMetadata): string {
  const label = argument.valueName ?? argument.parser?.label ?? argument.name.toUpperCase();
  if (argument.kind === 'positional') {
    return renderPositionalCount(argument, label);
  }
  const name = argument.long === undefined
    ? argument.short === undefined ? argument.name : `-${argument.short}`
    : `--${argument.long}`;
  if (argument.kind === 'flag' || argument.kind === 'count' || argument.maxValues === 0) {
    return name;
  }
  return argument.requireEquals
    ? `${name}${renderEqualsValueCount(argument, label)}`
    : `${name}${renderValueCount(argument, label)}`;
}

function argumentDisplay(argument: ArgumentMetadata): string {
  if (argument.kind === 'positional') {
    return argument.presence === 'required'
      ? `<${argument.valueName ?? argument.name}>`
      : `[${argument.valueName ?? argument.name}]`;
  }
  const names = [
    ...(argument.short === undefined ? [] : [`-${argument.short}`]),
    ...(argument.long === undefined ? [] : [`--${argument.long}`]),
    ...(argument.negativeLong === undefined ? [] : [`--${argument.negativeLong}`]),
  ];
  return names.length === 0 ? argument.name : names.join(', ');
}

function argumentDescription(argument: ArgumentMetadata): string {
  const details: string[] = [`syntax ${argumentSyntax(argument)}`];
  if (argument.help !== undefined) {
    details.push(argument.help);
  }
  details.push(`arity ${formatArity(argument.arity)}`);
  if (argument.parser !== undefined) {
    details.push(`parser ${argument.parser.label}`);
    for (const choice of argument.parser.choices ?? []) {
      if (choice.describe !== undefined) {
        details.push(`${choice.value}: ${choice.describe}`);
      }
      if (choice.aliases !== undefined && choice.aliases.length > 0) {
        details.push(`${choice.value} aliases: ${choice.aliases.join(', ')}`);
      }
    }
    if (argument.parser.ignoreCase) {
      details.push('case-insensitive values');
    }
    if (argument.parser.completions !== undefined) {
      details.push(`completions: ${argument.parser.completions.join(', ')}`);
    }
    if (argument.parser.completionHint !== undefined) {
      details.push(`completion: ${argument.parser.completionHint}`);
    }
  }
  if (argument.completionHint !== undefined) {
    details.push(`value completion: ${argument.completionHint}`);
  }
  if (argument.hasDynamicCompletion) {
    details.push('dynamic completion');
  }
  if (argument.env !== undefined) {
    details.push(`env: ${argument.env}`);
  }
  if (argument.hasDefaultValue) {
    const value = argument.defaultValues ?? argument.defaultValue;
    details.push(
      value === undefined
        ? 'default: unavailable'
        : `default: ${formatPlainValue(value)}`,
    );
  }
  if (argument.hasDefaultMissingValue) {
    details.push(
      argument.defaultMissingValue === undefined
        ? 'missing-value default: unavailable'
        : `missing-value default: ${formatPlainValue(argument.defaultMissingValue)}`,
    );
  }
  if (argument.deprecated !== undefined) {
    details.push(`deprecated: ${argument.deprecated}`);
  }
  if (argument.deprecatedAliases !== undefined) {
    details.push(
      `deprecated aliases: ${
        Object.entries(argument.deprecatedAliases)
          .map(([name, reason,]) => `${name} (${reason})`)
          .join(', ')
      }`,
    );
  }
  if (argument.aliases.length > 0) {
    details.push(`aliases: ${argument.aliases.join(', ')}`);
  }
  return details.join('; ');
}

function formatArity(arity: ArgumentArityMetadata): string {
  return arity.max === null
    ? `${arity.min}..`
    : arity.min === arity.max
    ? String(arity.min)
    : `${arity.min}..${arity.max}`;
}

function formatPlainValue(value: MetadataValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatMarkdownValue(value: MetadataValue | undefined): string {
  return value === undefined ? 'unknown' : markdownInline(formatPlainValue(value));
}

function markdownHeading(level: number, title: string): string {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${title}`;
}

function markdownInline(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const length = runs.reduce((maximum, run) => Math.max(maximum, run.length), 0);
  const delimiter = '`'.repeat(length + 1);
  return `${delimiter}${value}${delimiter}`;
}

function markdownText(value: string): string {
  return value
    .split('\n')
    .map((line) => {
      const escaped = line.replace(/[\\`*_{}[\]()#+.!|<>~=]/g, '\\$&');
      return /^[ \t]*[-+]/.test(escaped) ? `\\${escaped}` : escaped;
    })
    .join('\n');
}

function roffQuote(value: string): string {
  return `"${roffText(value).replaceAll('"', '\\"')}"`;
}

function roffText(value: string): string {
  return value
    .replaceAll('\\', '\\e')
    .replaceAll('-', '\\-')
    .split('\n')
    .map((line) => /^[.'"]/.test(line) ? `\\&${line}` : line)
    .join('\n');
}
