import type { ArgumentDefinition } from '../argument.js';
import {
  CliError,
  type CliErrorDetails,
  type ErrorKind,
} from '../error.js';
import { argumentLongNames } from './recognition.js';
import type { CommandDefinition } from './schema.js';
import {
  renderEqualsValueCount as renderSyntaxEqualsValueCount,
  renderPositionalCount as renderSyntaxPositionalCount,
  renderValueCount as renderSyntaxValueCount,
} from './syntax.js';

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
  details: Omit<CliErrorDetails, 'commandPath'> = {},
): CliError {
  const usage = renderUsage(definition, path, inheritedArguments);
  const safeMessage = sanitizeDiagnostic(message);
  return new CliError(
    kind,
    safeMessage,
    `error: ${safeMessage}\n\n${usage}\n\nFor more information, try '--help'.\n`,
    2,
    { ...details, commandPath: path },
  );
}

export function sanitizeDiagnostic(message: string): string {
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

export function suggestTokenCandidates(
  token: string,
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): readonly string[] {
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
  return best !== undefined && bestDistance <= limit ? [best] : [];
}

export function suggestToken(
  token: string,
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): string {
  const [suggestion,] = suggestTokenCandidates(token, definition, inheritedArguments);
  return suggestion === undefined ? '' : `; a similar argument exists: '${suggestion}'`;
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
  const requiredOptionUsage = requiredOptions.map((argument) => {
    const value = argument.requireEquals
      ? renderEqualsValueCount(argument)
      : renderValueCount(argument);
    return `${displayArgument(argument)}${value}`;
  });
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
  if (definition.deprecated !== undefined) {
    lines.push(`[deprecated: ${sanitizeDiagnostic(definition.deprecated)}]`, '');
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
      const description = [
        child.about,
        child.deprecated === undefined
          ? undefined
          : `[deprecated: ${sanitizeDiagnostic(child.deprecated)}]`,
      ].filter((value): value is string => value !== undefined).join(' ');
      return [`  ${label}`, description] as const;
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
  if (definition.examples !== undefined) {
    lines.push('', 'Examples:');
    for (const { command, description } of definition.examples) {
      lines.push(
        '',
        ...description.split(/\r\n?|\n/).map((line) => `  ${sanitizeDiagnostic(line)}`),
        ...command.split(/\r\n?|\n/).map((line) => `    ${sanitizeDiagnostic(line)}`),
      );
    }
  }
  if (definition.afterHelp !== undefined) {
    lines.push('', definition.afterHelp);
  }
  return `${lines.join('\n')}\n`;
}

function valueLabel(argument: ArgumentDefinition): string {
  return argument.valueName ?? argument.parser?.label ?? 'VALUE';
}

function renderValueCount(
  argument: ArgumentDefinition,
  minimum = argument.minValues,
): string {
  if (argument.kind !== 'option' || argument.maxValues === 0) {
    return '';
  }
  return renderSyntaxValueCount(argument, valueLabel(argument), minimum);
}

function renderEqualsValueCount(argument: ArgumentDefinition): string {
  return renderSyntaxEqualsValueCount(argument, valueLabel(argument));
}

function renderPositionalCount(
  argument: ArgumentDefinition,
  name: string,
): string {
  return renderSyntaxPositionalCount(argument, name);
}

function annotateHelp(argument: ArgumentDefinition): string {
  const annotations: string[] = [];
  if (argument.deprecated !== undefined) {
    annotations.push(`[deprecated: ${sanitizeDiagnostic(argument.deprecated)}]`);
  }
  if (argument.help !== undefined) {
    annotations.push(argument.help);
  }
  if (argument.env !== undefined) {
    annotations.push(`[env: ${argument.env}]`);
  }
  for (const choice of argument.parser?.choices ?? []) {
    if (choice.hide === true) {
      continue;
    }
    const details: string[] = [];
    if (choice.describe !== undefined) {
      details.push(sanitizeDiagnostic(choice.describe));
    }
    if (choice.aliases !== undefined && choice.aliases.length > 0) {
      details.push(`aliases: ${choice.aliases.map(sanitizeDiagnostic).join(', ')}`);
    }
    if (details.length > 0) {
      annotations.push(`[${sanitizeDiagnostic(choice.value)}: ${details.join('; ')}]`);
    }
  }
  if (argument.parser?.ignoreCase) {
    annotations.push('[case-insensitive values]');
  }
  if (
    argument.presence === 'default'
    && argument.kind !== 'flag'
    && argument.kind !== 'count'
  ) {
    annotations.push(`[default: ${String(argument.defaultValues ?? argument.defaultValue)}]`);
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
