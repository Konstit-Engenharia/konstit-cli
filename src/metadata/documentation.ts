import {
  groupHelpArguments,
  type HelpArgumentGroup,
} from '../help/sections.js';
import {
  describeRequiredValueCount,
  renderEqualsValueCount,
  renderPositionalUsage,
  renderValueCount,
} from '../help/value-syntax.js';
import type {
  ArgumentArityMetadata,
  ArgumentMetadata,
  CommandMetadata,
  MetadataValue,
} from './types.js';

export function metadataArgumentGroups(
  command: CommandMetadata,
): readonly HelpArgumentGroup<ArgumentMetadata>[] {
  return groupHelpArguments(
    [
      ...command.arguments.filter(({ kind }) => kind === 'positional'),
      ...command.inheritedArguments,
      ...command.arguments.filter(({ kind }) => kind !== 'positional'),
    ],
    (argument) => argument.kind === 'positional' ? 'Arguments' : 'Options',
  );
}

export function metadataCommandGroups(
  command: CommandMetadata,
): readonly HelpArgumentGroup<CommandMetadata>[] {
  return groupHelpArguments(command.subcommands, 'Commands');
}

export function relationDescriptions(command: CommandMetadata): readonly string[] {
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
  for (const { source, target, expected, valueCount } of command.conditionalRequirements) {
    const count = valueCount === undefined ? '' : ` with ${describeRequiredValueCount(valueCount)}`;
    lines.push(`${markdownInline(source)} = ${formatMarkdownValue(expected)} requires ${markdownInline(target)}${count}`);
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

export function usageText(command: CommandMetadata): string {
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
    return renderPositionalUsage(argument, label);
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

export function argumentDisplay(argument: ArgumentMetadata): string {
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

export function argumentDescription(argument: ArgumentMetadata): string {
  const details: string[] = [`syntax ${argumentSyntax(argument)}`];
  if (argument.help !== undefined) {
    details.push(argument.help);
  }
  if (argument.presence === 'without-subcommand') {
    details.push('required without a subcommand');
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
  if (argument.hasDefaultValue && !argument.sensitive) {
    const value = argument.defaultValues ?? argument.defaultValue;
    details.push(
      value === undefined
        ? 'default: unavailable'
        : `default: ${formatPlainValue(value)}`,
    );
  }
  if (argument.hasDefaultMissingValue && !argument.sensitive) {
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

export function markdownInline(value: string): string {
  const runs = value.match(/`+/g) ?? [];
  const length = runs.reduce((maximum, run) => Math.max(maximum, run.length), 0);
  const delimiter = '`'.repeat(length + 1);
  return `${delimiter}${value}${delimiter}`;
}
