import type { ArgumentDefinition } from '../argument/index.js';
import type {
  CommandDefinition,
  CommandExampleDefinition,
} from '../command/schema.js';
import {
  renderEqualsValueCount as renderSyntaxEqualsValueCount,
  renderPositionalCount,
  renderValueCount as renderSyntaxValueCount,
} from './value-syntax.js';

export function displayArgument(argument: ArgumentDefinition): string {
  if (argument.kind === 'positional') {
    return `<${argument.name}>`;
  }
  if (argument.long !== undefined) {
    return `--${argument.long}`;
  }
  if (argument.short !== undefined) {
    return `-${argument.short}`;
  }
  return argument.name;
}

export function displayName(definition: CommandDefinition, name: string): string {
  const argument = definition.arguments.find((candidate) => candidate.name === name);
  return argument === undefined ? name : displayArgument(argument);
}

export function positionalValueName(argument: ArgumentDefinition): string {
  return argument.valueName ?? argument.name.toUpperCase();
}

export function resolveExampleCommand(example: CommandExampleDefinition, invocation: string): string {
  if (example.command !== undefined) {
    return example.command;
  }
  return example.args === '' ? invocation : `${invocation} ${example.args}`;
}

export function renderUsageText(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
  hideColorFlags = false,
): string {
  if (definition.overrideUsage !== undefined) {
    return definition.overrideUsage;
  }
  const visibleArguments = [...definition.arguments, ...inheritedArguments]
    .filter(({ hidden, color }) => !hidden && (!hideColorFlags || !color));
  const requiredOptions = visibleArguments.filter(
    (argument) =>
      argument.kind !== 'positional'
      && argument.presence === 'required',
  );
  const options = visibleArguments.some(
    ({ kind, presence }) =>
      kind !== 'positional'
      && presence !== 'required',
  );
  const requiredOptionUsage = requiredOptions.map((argument) => {
    const value = argument.requireEquals
      ? renderEqualsValueCount(argument)
      : renderValueCount(argument);
    return `${displayArgument(argument)}${value}`;
  });
  const positionalUsage = definition.arguments
    .filter(({ kind, hidden }) => kind === 'positional' && !hidden)
    .map((argument) => renderPositionalCount(argument, positionalValueName(argument)));
  return [
    path.join(' '),
    ...(options ? ['[OPTIONS]'] : []),
    ...requiredOptionUsage,
    ...positionalUsage,
    ...(definition.subcommands.some(({ hidden }) => !hidden) ? ['<COMMAND>'] : []),
  ].join(' ');
}

export function renderUsage(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  hideColorFlags = false,
): string {
  return `Usage: ${renderUsageText(definition, path, inheritedArguments, hideColorFlags)}`;
}

/** The headings emitted by the generated help renderer. */

function valueLabel(argument: ArgumentDefinition): string {
  return argument.valueName ?? (argument.sensitive ? undefined : argument.parser?.label) ?? 'VALUE';
}

export function renderValueCount(
  argument: ArgumentDefinition,
  minimum = argument.minValues,
): string {
  if (argument.kind !== 'option' || argument.maxValues === 0) {
    return '';
  }
  return renderSyntaxValueCount(argument, valueLabel(argument), minimum);
}

export function renderEqualsValueCount(argument: ArgumentDefinition): string {
  return renderSyntaxEqualsValueCount(argument, valueLabel(argument));
}
