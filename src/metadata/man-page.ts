import type { CommandType } from '../command/types.js';
import { describeCommand } from './describe.js';
import {
  argumentDescription,
  argumentDisplay,
  metadataArgumentGroups,
  metadataCommandGroups,
  relationDescriptions,
  usageText,
} from './documentation.js';
import type {
  ArgumentMetadata,
  CommandMetadata,
  CommandMetadataOptions,
} from './types.js';

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
  if (command.examples !== undefined) {
    lines.push('.SH EXAMPLES');
    for (const { command: invocation, description } of command.examples) {
      lines.push('.PP');
      if (description !== '') {
        lines.push(roffText(description.replace(/\r\n?/g, '\n')));
      }
      lines.push(
        '.RS',
        '.nf',
        roffText(invocation.replace(/\r\n?/g, '\n')),
        '.fi',
        '.RE',
      );
    }
  }
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
  for (const group of metadataArgumentGroups(command)) {
    lines.push(roffSectionHeading(group.heading));
    appendManArgumentEntries(group.arguments, lines);
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
  for (const group of metadataCommandGroups(command)) {
    lines.push(roffSectionHeading(group.heading));
    for (const child of group.arguments) {
      const aliases = child.aliases.map(({ name }) => name);
      const aliasText = aliases.length === 0 ? '' : ` (aliases: ${aliases.join(', ')})`;
      lines.push('.TP', `.B ${roffText(child.path.join(' '))}`, roffText(`${child.about ?? ''}${aliasText}`));
    }
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

function roffQuote(value: string): string {
  return `"${roffText(value).replaceAll('"', '\\"')}"`;
}

function roffSectionHeading(title: string): string {
  const heading = title.toUpperCase();
  return /[\s"]/u.test(heading)
    ? `.SH ${roffQuote(heading)}`
    : `.SH ${roffText(heading)}`;
}

function roffText(value: string): string {
  return value
    .replaceAll('\\', '\\e')
    .replaceAll('-', '\\-')
    .split('\n')
    .map((line) => /^[.'"]/.test(line) ? `\\&${line}` : line)
    .join('\n');
}
