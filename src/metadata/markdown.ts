import type { CommandType } from '../command/types.js';
import { describeCommand } from './describe.js';
import {
  argumentDescription,
  argumentDisplay,
  markdownInline,
  metadataArgumentGroups,
  metadataCommandGroups,
  relationDescriptions,
  usageText,
} from './documentation.js';
import type {
  CommandMetadata,
  CommandMetadataOptions,
} from './types.js';

/** Options for Markdown documentation. */
export interface MarkdownOptions extends CommandMetadataOptions {
  /** The main heading. Defaults to the command name. */
  readonly title?: string;
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
  if (command.examples !== undefined) {
    lines.push('', markdownHeading(headingLevel, 'Examples'));
    for (const { command: invocation, description } of command.examples) {
      if (description !== '') {
        lines.push('', markdownText(description));
      }
      lines.push('', ...invocation.split(/\r\n?|\n/).map((line) => `    ${line}`));
    }
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
  for (const group of metadataArgumentGroups(command)) {
    lines.push('', markdownHeading(headingLevel, markdownText(group.heading)));
    for (const argument of group.arguments) {
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
  for (const group of metadataCommandGroups(command)) {
    lines.push('', markdownHeading(headingLevel, markdownText(group.heading)));
    for (const child of group.arguments) {
      const aliases = child.aliases.map(({ name }) => markdownInline(name));
      const aliasText = aliases.length === 0 ? '' : ` (aliases: ${aliases.join(', ')})`;
      lines.push(`- ${markdownInline(child.path.join(' '))}${aliasText} — ${markdownText(child.about ?? '')}`);
    }
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

function markdownHeading(level: number, title: string): string {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} ${title}`;
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
