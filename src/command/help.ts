import type { ArgumentDefinition } from '../argument.js';
import {
  CliError,
  type ErrorKind,
} from '../error.js';
import { argumentLongNames } from './recognition.js';
import type { CommandDefinition } from './schema.js';

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

export function commandError(
  kind: ErrorKind,
  message: string,
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
): CliError {
  const usage = renderUsage(definition, path, inheritedArguments);
  const safeMessage = sanitizeDiagnostic(message);
  return new CliError(
    kind,
    safeMessage,
    `error: ${safeMessage}\n\n${usage}\n\nFor more information, try '--help'.\n`,
  );
}

function sanitizeDiagnostic(message: string): string {
  return message.replace(/[\p{Cc}\p{Cf}]/gu, (character) => {
    if (character === '\n') {
      return '\\n';
    }
    if (character === '\r') {
      return '\\r';
    }
    if (character === '\t') {
      return '\\t';
    }
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? '' : `\\u{${codePoint.toString(16)}}`;
  });
}

export function suggestToken(
  token: string,
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): string {
  const candidates = [
    ...[...definition.arguments, ...inheritedArguments].flatMap((argument) => [
      ...argumentLongNames(argument).map((name) => `--${name}`),
      ...(argument.short === undefined ? [] : [`-${argument.short}`]),
    ]),
    ...definition.subcommands.flatMap((child) => [
      child.name,
      ...child.aliases.map(({ name }) => name),
    ]),
  ];
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = editDistance(token, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  const limit = Math.max(1, Math.floor(token.length / 3));
  return best !== undefined && bestDistance <= limit ? `; a similar argument exists: '${best}'` : '';
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] ?? 0;
      const deletion = previous[rightIndex] ?? 0;
      const insertion = current[rightIndex - 1] ?? 0;
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? substitution
        : 1 + Math.min(substitution, deletion, insertion);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

export function renderUsageText(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
): string {
  if (definition.overrideUsage !== undefined) {
    return definition.overrideUsage;
  }
  const allArguments = [...definition.arguments, ...inheritedArguments];
  const requiredOptions = allArguments.filter(
    (argument) =>
      argument.kind !== 'positional'
      && argument.presence === 'required'
      && !argument.hidden,
  );
  const options = allArguments.some(
    ({ kind, presence, hidden }) =>
      kind !== 'positional'
      && presence !== 'required'
      && !hidden,
  );
  const requiredOptionUsage = requiredOptions.map((argument) => `${displayArgument(argument)}${renderValueCount(argument)}`);
  const positionalUsage = definition.arguments
    .filter(({ kind, hidden }) => kind === 'positional' && !hidden)
    .map((argument) => {
      const name = argument.valueName ?? argument.name.toUpperCase();
      return renderPositionalCount(argument, name);
    });
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
): string {
  return `Usage: ${renderUsageText(definition, path, inheritedArguments)}`;
}

export function renderHelp(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  includeLongAbout = true,
): string {
  if (definition.overrideHelp !== undefined) {
    return definition.overrideHelp;
  }

  const lines: string[] = [];
  if (definition.beforeHelp !== undefined) {
    lines.push(definition.beforeHelp);
  }
  if (definition.about !== undefined) {
    lines.push(definition.about, '');
  }
  if (definition.author !== undefined) {
    lines.push(`Author: ${definition.author}`, '');
  }
  lines.push(renderUsage(definition, path, inheritedArguments));

  const positionals = definition.arguments.filter(
    (argument) => argument.kind === 'positional' && !argument.hidden,
  );
  if (positionals.length > 0) {
    lines.push('', 'Arguments:');
    const entries: Array<readonly [string, string]> = positionals.map((argument) => {
      const name = argument.valueName ?? argument.name.toUpperCase();
      const label = renderPositionalCount(argument, name);
      return [`  ${label}`, annotateHelp(argument)] as const;
    });
    pushAligned(lines, entries);
  }

  const subcommands = definition.subcommands.filter(({ hidden }) => !hidden);
  if (subcommands.length > 0) {
    lines.push('', 'Commands:');
    const commandEntries: Array<readonly [string, string]> = subcommands.map((child) => {
      const aliases = child.aliases
        .filter(({ visible }) => visible)
        .map(({ name }) => name);
      const label = aliases.length === 0
        ? child.name
        : `${child.name} (aliases: ${aliases.join(', ')})`;
      return [`  ${label}`, child.about ?? ''] as const;
    });
    if (subcommands.length > 0 && !definition.disableHelpSubcommand) {
      commandEntries.push(['  help', 'Print help for a subcommand']);
    }
    pushAligned(lines, commandEntries);
  }

  const options = [...definition.arguments, ...inheritedArguments].filter(
    (argument) => argument.kind !== 'positional' && !argument.hidden,
  );
  const entries: Array<readonly [string, string]> = options.map((argument) => {
    const names = [
      ...(argument.short === undefined ? [] : [`-${argument.short}`]),
      ...(argument.long === undefined ? [] : [`--${argument.long}`]),
      ...(argument.negativeLong === undefined ? [] : [`--${argument.negativeLong}`]),
    ].join(', ');
    const value = argument.kind !== 'option'
      ? ''
      : argument.requireEquals
      ? renderEqualsValueCount(argument)
      : renderValueCount(argument);
    return [`  ${names}${value}`, annotateHelp(argument)] as const;
  });
  if (!definition.disableHelpFlag) {
    entries.push(['  -h, --help', 'Print help']);
  }
  if (definition.version !== undefined && !definition.disableVersionFlag) {
    entries.push(['  -V, --version', 'Print version']);
  }
  if (entries.length > 0) {
    lines.push('', 'Options:');
    pushAligned(lines, entries);
  }
  if (includeLongAbout && definition.longAbout !== undefined) {
    lines.push('', definition.longAbout);
  }
  if (definition.afterHelp !== undefined) {
    lines.push('', definition.afterHelp);
  }
  return `${lines.join('\n')}\n`;
}

function valueLabel(argument: ArgumentDefinition): string {
  return argument.valueName ?? argument.parser?.label ?? 'VALUE';
}

const expandedValueCountLimit = 8;

function compactValueCount(
  minimum: number,
  maximum: number | null,
): string | undefined {
  if (
    minimum <= expandedValueCountLimit
    && (maximum === null || maximum <= expandedValueCountLimit)
  ) {
    return undefined;
  }
  if (maximum === null) {
    return `{${minimum}..}`;
  }
  return minimum === maximum ? `{${minimum}}` : `{${minimum}..${maximum}}`;
}

function renderValueCount(
  argument: ArgumentDefinition,
  minimum = argument.minValues,
): string {
  if (argument.kind !== 'option' || argument.maxValues === 0) {
    return '';
  }
  const label = `<${valueLabel(argument)}>`;
  const compact = compactValueCount(minimum, argument.maxValues);
  if (compact !== undefined) {
    return ` ${label}${compact}${argument.repeatable ? '...' : ''}`;
  }
  if (argument.maxValues === null) {
    if (minimum === 0) {
      return ` [${label}...]`;
    }
    const required = Array<string>(Math.max(0, minimum - 1)).fill(label);
    return ` ${[...required, `${label}...`].join(' ')}`;
  }
  const required = Array<string>(minimum).fill(label);
  const optional = Array<string>(argument.maxValues - minimum).fill(
    `[${label}]`,
  );
  const values = [...required, ...optional];
  const repeated = argument.repeatable ? '...' : '';
  return values.length === 0 ? '' : ` ${values.join(' ')}${repeated}`;
}

function renderEqualsValueCount(argument: ArgumentDefinition): string {
  const minimum = argument.minValues === 0 && argument.maxValues !== 0
    ? 1
    : argument.minValues;
  const values = renderValueCount(argument, minimum).trimStart();
  return argument.minValues === 0 ? `[=${values}]` : `=${values}`;
}

function renderPositionalCount(
  argument: ArgumentDefinition,
  name: string,
): string {
  const label = `<${name}>`;
  const optionalLabel = `[${name}]`;
  const compact = compactValueCount(argument.minValues, argument.maxValues);
  if (compact !== undefined) {
    const compactLabel = argument.presence === 'required' ? label : optionalLabel;
    return `${compactLabel}${compact}${argument.repeatable ? '...' : ''}`;
  }
  if (argument.maxValues === null) {
    if (argument.presence !== 'required') {
      if (argument.minValues <= 1) {
        return `${optionalLabel}...`;
      }
      const values = Array<string>(argument.minValues - 1).fill(label);
      return `[${[...values, `${label}...`].join(' ')}]`;
    }
    const required = Array<string>(
      Math.max(0, argument.minValues - 1),
    ).fill(label);
    return [...required, `${label}...`].join(' ');
  }
  const requiredCount = argument.presence === 'required' ? argument.minValues : 0;
  const required = Array<string>(requiredCount).fill(label);
  const optional = Array<string>(
    argument.maxValues - requiredCount,
  ).fill(optionalLabel);
  const repeated = argument.repeatable ? '...' : '';
  return `${[...required, ...optional].join(' ')}${repeated}`;
}

function annotateHelp(argument: ArgumentDefinition): string {
  const annotations: string[] = [];
  if (argument.help !== undefined) {
    annotations.push(argument.help);
  }
  if (argument.env !== undefined) {
    annotations.push(`[env: ${argument.env}]`);
  }
  if (
    argument.presence === 'default'
    && argument.kind !== 'flag'
    && argument.kind !== 'count'
  ) {
    annotations.push(`[default: ${String(argument.defaultValue)}]`);
  }
  return annotations.join(' ');
}

function pushAligned(lines: string[], entries: readonly (readonly [string, string])[]): void {
  const width = Math.max(0, ...entries.map(([label,]) => Bun.stringWidth(label)));
  for (const [label, description,] of entries) {
    const padding = ' '.repeat(width - Bun.stringWidth(label));
    lines.push(description === '' ? label : `${label}${padding}  ${description}`);
  }
}
