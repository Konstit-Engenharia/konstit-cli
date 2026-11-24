import type { ArgumentDefinition } from '../argument/index.js';
import type { CommandDefinition } from '../command/schema.js';
import {
  DisplayKind,
  type ParseDisplay,
} from '../result/error.js';
import { sanitizeDiagnostic } from './diagnostics.js';
import { groupHelpArguments } from './sections.js';
import {
  positionalValueName,
  renderEqualsValueCount,
  renderUsage,
  renderValueCount,
  resolveExampleCommand,
} from './usage.js';
import { renderPositionalCount } from './value-syntax.js';

export type GeneratedHelpSection = string;

export type HelpLineRole =
  | { readonly kind: 'plain'; }
  | { readonly kind: 'title'; readonly nameEnd: number; readonly versionStart: number | undefined; }
  | { readonly kind: 'usage'; }
  | { readonly kind: 'author'; }
  | { readonly kind: 'exampleDescription'; }
  | { readonly kind: 'exampleCommand'; readonly invocation?: string; }
  | { readonly kind: 'heading'; readonly section: GeneratedHelpSection; }
  | {
    readonly kind: 'entry';
    readonly section: GeneratedHelpSection;
    readonly labelStart: number;
    readonly labelEnd: number;
    readonly placeholderEnd?: number;
  };

type HelpEntry = readonly [label: string, description: string, placeholderLength?: number];

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
  return renderHelpDocument(definition, path, inheritedArguments, { includeLongAbout }).output;
}

interface HelpRenderOptions {
  readonly includeLongAbout?: boolean;
  readonly hideStandardFlags?: boolean;
}

export function createHelpDisplay(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  options: HelpRenderOptions = {},
): ParseDisplay {
  const document = renderHelpDocument(definition, path, inheritedArguments, options);
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
  { includeLongAbout = true, hideStandardFlags = false }: HelpRenderOptions,
): RenderedHelpDocument {
  if (definition.overrideHelp !== undefined) {
    return { output: definition.overrideHelp };
  }

  const lines: HelpLine[] = [];
  if (definition.beforeHelp !== undefined) {
    appendText(lines, definition.beforeHelp, { kind: 'plain' });
  }
  if (definition.about !== undefined || definition.version !== undefined) {
    const [summary, ...details] = (definition.about ?? '').split(/\r\n?|\n/);
    const title = summary ? `${definition.name} ${summary}` : definition.name;
    const version = definition.version;
    appendLine(lines, version === undefined ? title : `${title} (${sanitizeDiagnostic(version)})`, {
      kind: 'title',
      nameEnd: definition.name.length,
      versionStart: version === undefined ? undefined : title.length + 1,
    });
    for (const detail of details) {
      appendLine(lines, detail, { kind: 'plain' });
    }
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
  appendFirstLineRole(lines, renderUsage(definition, path, inheritedArguments, hideStandardFlags), { kind: 'usage' });

  const argumentsToRender = [
    ...definition.arguments,
    ...inheritedArguments,
  ].filter(({ hidden, color }) => !hidden && (!hideStandardFlags || !color));
  const builtInEntries: Array<readonly [string, string]> = [];
  if (!hideStandardFlags) {
    if (!definition.disableHelpFlag) {
      builtInEntries.push(['  -h, --help', 'Print help']);
    }
    if (definition.version !== undefined && !definition.disableVersionFlag) {
      builtInEntries.push(['  -V, --version', 'Print version']);
    }
  }
  const argumentGroups = groupHelpArguments(
    argumentsToRender,
    (argument) => argument.kind === 'positional' ? 'Arguments' : 'Options',
  );
  const groupsWithBuiltIns = builtInEntries.length === 0 || argumentGroups.some(
      ({ heading }) => heading === 'Options',
    )
    ? argumentGroups
    : [...argumentGroups, { heading: 'Options', arguments: [] }];
  const positionalGroups = groupsWithBuiltIns.filter(
    ({ arguments: groupArguments }) => groupArguments.some(({ kind }) => kind === 'positional'),
  );
  const optionGroups = groupsWithBuiltIns.filter(
    ({ arguments: groupArguments }) => groupArguments.every(({ kind }) => kind !== 'positional'),
  );
  for (const group of positionalGroups) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, `${sanitizeDiagnostic(group.heading)}:`, {
      kind: 'heading',
      section: group.heading,
    });
    pushAligned(lines, helpGroupEntries(group, builtInEntries), group.heading);
  }

  const subcommands = definition.subcommands.filter(({ hidden }) => !hidden);
  if (subcommands.length > 0) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, 'Commands:', { kind: 'heading', section: 'Commands' });
    const commandEntries: HelpEntry[] = subcommands.map((child) => {
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
    if (!hideStandardFlags && !definition.disableVersionFlag && subcommands.some(({ disableHelpFlag }) => !disableHelpFlag)) {
      const placeholder = '<command>';
      commandEntries.push([`  ${placeholder} --help`, 'Print help text for command.', placeholder.length]);
    }
    pushAligned(lines, commandEntries, 'Commands');
  }

  for (const group of optionGroups) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, `${sanitizeDiagnostic(group.heading)}:`, {
      kind: 'heading',
      section: group.heading,
    });
    pushAligned(lines, helpGroupEntries(group, builtInEntries), group.heading);
  }
  if (includeLongAbout && definition.longAbout !== undefined) {
    appendLine(lines, '', { kind: 'plain' });
    appendText(lines, definition.longAbout, { kind: 'plain' });
  }
  if (definition.examples !== undefined) {
    appendLine(lines, '', { kind: 'plain' });
    appendLine(lines, 'Examples:', { kind: 'heading', section: 'Examples' });
    const invocation = path.join(' ');
    for (const example of definition.examples) {
      const { description } = example;
      if (description !== '') {
        for (const line of description.split(/\r\n?|\n/)) {
          appendLine(lines, `  ${sanitizeDiagnostic(line)}`, { kind: 'exampleDescription' });
        }
      }
      const command = resolveExampleCommand(example, invocation);
      const [first = '', ...continuation] = command.split(/\r\n?|\n/);
      appendLine(lines, `  $ ${sanitizeDiagnostic(first)}`, { kind: 'exampleCommand', invocation });
      for (const line of continuation) {
        appendLine(lines, line === '' ? '' : `    ${sanitizeDiagnostic(line)}`, { kind: 'exampleCommand' });
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

function helpArgumentEntries(
  argumentsToRender: readonly ArgumentDefinition[],
): Array<readonly [string, string]> {
  return argumentsToRender.map((argument) => {
    if (argument.kind === 'positional') {
      const label = renderPositionalCount(argument, positionalValueName(argument));
      return [`  ${label}`, annotateHelp(argument)] as const;
    }
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
}

function helpGroupEntries(
  group: { readonly heading: string; readonly arguments: readonly ArgumentDefinition[]; },
  builtInEntries: readonly (readonly [string, string])[],
): Array<readonly [string, string]> {
  const entries = helpArgumentEntries(group.arguments);
  if (group.heading === 'Options') {
    entries.push(...builtInEntries);
  }
  return entries;
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
  const choices = parser?.choices?.filter(({ hide }) => hide !== true) ?? [];
  if (choices.length > 0 && (argument.kind === 'positional' || argument.valueName !== undefined)) {
    const values = choices.map(({ value }) => sanitizeDiagnostic(value)).join(', ');
    annotations.push(`[possible values: ${values}]`);
  }
  for (const choice of choices) {
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
  entries: readonly HelpEntry[],
  section: GeneratedHelpSection,
): void {
  const width = Math.max(0, ...entries.map(([label,]) => Bun.stringWidth(label)));
  for (const [label, description, placeholderLength,] of entries) {
    const padding = ' '.repeat(width - Bun.stringWidth(label));
    const suffix = description === '' ? '' : `${padding}  ${description}`;
    appendLine(lines, `${label}${suffix}`, {
      kind: 'entry',
      section,
      labelStart: 2,
      labelEnd: label.length,
      ...(placeholderLength === undefined ? {} : { placeholderEnd: 2 + placeholderLength }),
    });
  }
}
