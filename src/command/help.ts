import type { ArgumentDefinition } from '../argument.js';
import {
  CliError,
  DisplayKind,
  type CliErrorDetails,
  type ErrorKind,
  type ParseDisplay,
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

/** The headings emitted by the generated help renderer. */
export type GeneratedHelpSection = 'Arguments' | 'Commands' | 'Options' | 'Examples';

export type HelpLineRole =
  | { readonly kind: 'plain'; }
  | { readonly kind: 'usage'; }
  | { readonly kind: 'author'; }
  | { readonly kind: 'heading'; readonly section: GeneratedHelpSection; }
  | { readonly kind: 'entry'; readonly section: GeneratedHelpSection; readonly labelStart: number; readonly labelEnd: number; };

export interface HelpDisplayMetadata {
  readonly lines: readonly HelpLine[];
}

export interface HelpLine {
  readonly text: string;
  readonly role: HelpLineRole;
}

/** Metadata for generated help displays, keyed by the display object itself. */
export const helpDisplayMetadata = new WeakMap<object, HelpDisplayMetadata>();

export function renderHelp(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  includeLongAbout = true,
): string {
  return renderHelpDocument(definition, path, inheritedArguments, includeLongAbout).output;
}

export function createHelpDisplay(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  includeLongAbout = true,
): ParseDisplay {
  const document = renderHelpDocument(definition, path, inheritedArguments, includeLongAbout);
  const display: ParseDisplay = {
    ok: true,
    type: 'display',
    kind: DisplayKind.Help,
    output: document.output,
  };
  if (document.metadata !== undefined) {
    helpDisplayMetadata.set(display, document.metadata);
  }
  return display;
}

interface RenderedHelpDocument {
  readonly output: string;
  readonly metadata?: HelpDisplayMetadata;
}

function renderHelpDocument(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
  includeLongAbout: boolean,
): RenderedHelpDocument {
  if (definition.overrideHelp !== undefined) {
    return { output: definition.overrideHelp };
  }

  const lines: HelpLine[] = [];
  if (definition.beforeHelp !== undefined) {
    appendText(lines, definition.beforeHelp, { kind: 'plain' });
  }
  if (definition.about !== undefined) {
    appendText(lines, definition.about, { kind: 'plain' });
    appendLine(lines, '', { kind: 'plain' });
  }
  if (definition.author !== undefined) {
    appendFirstLineRole(lines, `Author: ${definition.author}`, { kind: 'author' });
    appendLine(lines, '', { kind: 'plain' });
  }
  if (definition.deprecated !== undefined) {
    appendText(lines, `[deprecated: ${sanitizeDiagnostic(definition.deprecated)}]`, { kind: 'plain' });
    appendLine(lines, '', { kind: 'plain' });
  }
  appendFirstLineRole(lines, renderUsage(definition, path, inheritedArguments), { kind: 'usage' });

  const positionals = definition.arguments.filter(
    (argument) => argument.kind === 'positional' && !argument.hidden,
  );
  if (positionals.length > 0) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, 'Arguments:', { kind: 'heading', section: 'Arguments' });
    const entries: Array<readonly [string, string]> = positionals.map((argument) => {
      const name = argument.valueName ?? argument.name.toUpperCase();
      const label = renderPositionalCount(argument, name);
      return [`  ${label}`, annotateHelp(argument)] as const;
    });
    pushAligned(lines, entries, 'Arguments');
  }

  const subcommands = definition.subcommands.filter(({ hidden }) => !hidden);
  if (subcommands.length > 0) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, 'Commands:', { kind: 'heading', section: 'Commands' });
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
    pushAligned(lines, commandEntries, 'Commands');
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
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, 'Options:', { kind: 'heading', section: 'Options' });
    pushAligned(lines, entries, 'Options');
  }
  if (includeLongAbout && definition.longAbout !== undefined) {
    appendLine(lines, '', { kind: 'plain' });
    appendText(lines, definition.longAbout, { kind: 'plain' });
  }
  if (definition.examples !== undefined) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, 'Examples:', { kind: 'heading', section: 'Examples' });
    for (const { command, description } of definition.examples) {
      appendLine(lines, '', { kind: 'plain' });
      for (const line of description.split(/\r\n?|\n/)) {
        appendEntry(lines, 'Examples', '  ', sanitizeDiagnostic(line));
      }
      for (const line of command.split(/\r\n?|\n/)) {
        appendEntry(lines, 'Examples', '    ', sanitizeDiagnostic(line));
      }
    }
  }
  if (definition.afterHelp !== undefined) {
    appendLine(lines, '', { kind: 'plain' });
    appendText(lines, definition.afterHelp, { kind: 'plain' });
  }
  return {
    output: `${lines.map(({ text }) => text).join('\n')}\n`,
    metadata: { lines },
  };
}

function valueLabel(argument: ArgumentDefinition): string {
  return argument.valueName ?? (argument.sensitive ? undefined : argument.parser?.label) ?? 'VALUE';
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
  const parser = argument.sensitive ? undefined : argument.parser;
  for (const choice of parser?.choices ?? []) {
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
  if (parser?.ignoreCase) {
    annotations.push('[case-insensitive values]');
  }
  if (
    !argument.sensitive
    && argument.presence === 'default'
    && argument.kind !== 'flag'
    && argument.kind !== 'count'
  ) {
    annotations.push(`[default: ${String(argument.defaultValues ?? argument.defaultValue)}]`);
  }
  return annotations.join(' ');
}

function appendLine(lines: HelpLine[], text: string, role: HelpLineRole): void {
  lines.push({ text, role });
}

function appendEntry(
  lines: HelpLine[],
  section: GeneratedHelpSection,
  indentation: string,
  label: string,
  suffix = '',
): void {
  appendLine(lines, `${indentation}${label}${suffix}`, {
    kind: 'entry',
    section,
    labelStart: indentation.length,
    labelEnd: indentation.length + label.length,
  });
}

function appendText(lines: HelpLine[], text: string, role: HelpLineRole): void {
  for (const line of text.split('\n')) {
    appendLine(lines, line, role);
  }
}

function appendFirstLineRole(lines: HelpLine[], text: string, role: HelpLineRole): void {
  const [first, ...rest] = text.split('\n');
  appendLine(lines, first ?? '', role);
  for (const line of rest) {
    appendLine(lines, line, { kind: 'plain' });
  }
}

function pushAligned(
  lines: HelpLine[],
  entries: readonly (readonly [string, string])[],
  section: GeneratedHelpSection,
): void {
  const width = Math.max(0, ...entries.map(([label,]) => Bun.stringWidth(label)));
  for (const [label, description,] of entries) {
    const padding = ' '.repeat(width - Bun.stringWidth(label));
    appendEntry(lines, section, '  ', label.slice(2), description === '' ? '' : `${padding}  ${description}`);
  }
}
