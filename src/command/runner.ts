import {
  getArgumentDefinition,
  type AnyGlobalArgument,
  type ArgumentDefinition,
  type ArgumentOutput,
} from '../argument.js';
import type {
  HandlerContext,
  HandlerResult,
  RunOptions,
} from '../command.js';
import { getWarnings } from '../deprecation.js';
import {
  DisplayKind,
  type CliError,
  type ParseDisplay,
  type ParseResult,
} from '../error.js';
import { createStyle } from '../style.js';
import {
  resolveOutputColor,
  type AnsiColorFormat,
} from './color.js';
import { createConsole } from './console.js';
import { sanitizeDiagnostic } from './help.js';
import {
  writeOutput,
  type OutputChannel,
} from './output.js';
import { outputColorModes } from './parse.js';
import type { CommandDefinition } from './schema.js';

interface SelectedCommand {
  readonly definition: CommandDefinition;
  readonly args: Record<string, unknown>;
  readonly globals: readonly SelectedGlobal[];
  readonly path: readonly string[];
}

interface SelectedGlobal {
  readonly argument: ArgumentDefinition;
  readonly value: unknown;
}

function selectDeepestCommand(
  definition: CommandDefinition,
  args: Record<string, unknown>,
  path: readonly string[],
  inheritedGlobals: readonly SelectedGlobal[] = [],
): SelectedCommand {
  const globals = [
    ...inheritedGlobals,
    ...definition.arguments
      .filter((argument) => argument.global && Object.hasOwn(args, argument.name))
      .map((argument) => ({ argument, value: args[argument.name] })),
  ];
  const parsedSubcommand = args.subcommand;
  if (
    typeof parsedSubcommand !== 'object'
    || parsedSubcommand === null
    || !('name' in parsedSubcommand)
    || !('args' in parsedSubcommand)
    || typeof parsedSubcommand.name !== 'string'
    || typeof parsedSubcommand.args !== 'object'
    || parsedSubcommand.args === null
  ) {
    return { definition, args, globals, path };
  }

  const child = definition.subcommands.find(
    ({ name }) => name === parsedSubcommand.name,
  );
  if (child === undefined) {
    throw new Error(
      `Internal parser result references unknown subcommand '${parsedSubcommand.name}'`,
    );
  }
  return selectDeepestCommand(
    child,
    parsedSubcommand.args as Record<string, unknown>,
    [...path, child.name],
    globals,
  );
}

function writeMessage(channel: OutputChannel, text: string, options: RunOptions): Promise<void> {
  const writer = options[channel];
  // Terminal messages end with one newline. Injected writers receive the rendered text verbatim.
  return writeOutput(channel, writer === undefined ? `${text.trimEnd()}\n` : text, writer);
}

async function writeParseFailure(error: CliError, options: RunOptions): Promise<number> {
  const decision = resolveOutputColor('stderr', outputColorModes.get(error), options.color, options.stderr);
  await writeMessage(
    'stderr',
    decision.enabled
      ? styleParseFailure(error.output, decision.format)
      : error.output,
    options,
  );
  return options.parseErrorExitCode ?? error.exitCode;
}

const helpAnsi = Object.freeze({ strong: '\x1b[1m', reset: '\x1b[0m' });
const helpAccent = '#0891b2';
const errorAccent = '#dc2626';

function helpPalette(format: AnsiColorFormat): {
  readonly heading: string;
  readonly label: string;
  readonly strong: string;
  readonly reset: string;
} {
  const accent = Bun.color(helpAccent, format) ?? '';
  return {
    heading: `${helpAnsi.strong}${accent}`,
    label: accent,
    ...helpAnsi,
  };
}

function hasHelpOverride(
  definition: CommandDefinition,
  output: string,
): boolean {
  return definition.overrideHelp === output
    || definition.subcommands.some((child) => hasHelpOverride(child, output));
}

function styleHelp(output: string, format: AnsiColorFormat): string {
  const palette = helpPalette(format);
  let entrySection = false;
  return output.split('\n').map((line) => {
    if (/^(Arguments|Commands|Options|Examples):$/.test(line)) {
      entrySection = true;
      return `${palette.heading}${line}${palette.reset}`;
    }
    if (line === '') {
      entrySection = false;
      return line;
    }
    if (line.startsWith('Usage: ')) {
      return `${palette.heading}Usage:${palette.reset} ${palette.strong}${line.slice(7)}${palette.reset}`;
    }
    if (line.startsWith('Author: ')) {
      return `${palette.heading}Author:${palette.reset} ${line.slice(8)}`;
    }
    if (entrySection && line.startsWith('  ')) {
      const content = line.slice(2);
      const described = /^(.*?\S)( {2,})(\S.*)$/.exec(content);
      if (described !== null) {
        const label = described[1] ?? '';
        const spacing = described[2] ?? '';
        const description = described[3] ?? '';
        return `  ${palette.label}${label}${palette.reset}${spacing}${description}`;
      }
      return `  ${palette.label}${content}${palette.reset}`;
    }
    return line;
  }).join('\n');
}

function styleParseFailure(output: string, format: AnsiColorFormat): string {
  const accent = Bun.color(errorAccent, format) ?? '';
  const styled = styleHelp(output, format);
  return `${helpAnsi.strong}${accent}error:${helpAnsi.reset}${styled.slice(6)}`;
}

async function writeDisplay(
  definition: CommandDefinition,
  display: ParseDisplay,
  options: RunOptions,
): Promise<number> {
  const decision = resolveOutputColor('stdout', outputColorModes.get(display), options.color, options.stdout);
  const output = display.kind === DisplayKind.Help
      && decision.enabled
      && !hasHelpOverride(definition, display.output)
    ? styleHelp(display.output, decision.format)
    : display.output;
  await writeMessage('stdout', output, options);
  return 0;
}

function normalizeHandlerExitCode(value: HandlerResult): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new RangeError('A command handler exit code must be an integer from 0 to 255');
  }
  return value;
}

export async function runConfiguredHandler<Args extends object>(
  definition: CommandDefinition,
  result: ParseResult<Args>,
  options: RunOptions,
): Promise<number> {
  const lsColors = options.lsColors ?? Bun.env.LS_COLORS;
  if (
    options.parseErrorExitCode !== undefined
    && (!Number.isSafeInteger(options.parseErrorExitCode)
      || options.parseErrorExitCode < 1
      || options.parseErrorExitCode > 255)
  ) {
    throw new RangeError('parseErrorExitCode must be an integer from 1 to 255');
  }
  if (result.type === 'error') {
    await writeWarnings(result, options);
    return writeParseFailure(result.error, options);
  }
  if (result.type === 'display') {
    return writeDisplay(definition, result, options);
  }

  const selected = selectDeepestCommand(
    definition,
    result.value as Record<string, unknown>,
    [definition.name],
  );
  if (selected.definition.handler === undefined) {
    throw new TypeError(
      `No handler is configured for command '${selected.path.join(' ')}'`,
    );
  }
  await writeWarnings(result, options);
  const mode = outputColorModes.get(result);
  const colors = {
    stdout: resolveOutputColor('stdout', mode, options.color, options.stdout),
    stderr: resolveOutputColor('stderr', mode, options.color, options.stderr),
  };
  const context: HandlerContext = Object.freeze({
    commandPath: Object.freeze([...selected.path]),
    stdout: (chunk: string) => writeOutput('stdout', chunk, options.stdout),
    stderr: (chunk: string) => writeOutput('stderr', chunk, options.stderr),
    style: createStyle(colors, lsColors),
    output: createConsole(
      options.output,
      resolveOutputColor('stderr', mode, options.color, options.output?.stderr),
    ),
    global<ArgumentType extends AnyGlobalArgument>(argument: ArgumentType) {
      const argumentDefinition = getArgumentDefinition(argument);
      if (!argumentDefinition.global) {
        throw new TypeError(`Argument '${argumentDefinition.name}' is not global`);
      }
      const binding = selected.globals.find(
        (candidate) => candidate.argument === argumentDefinition,
      );
      if (binding === undefined) {
        throw new TypeError(
          `Global argument '${argumentDefinition.name}' is not registered for command '${selected.path.join(' ')}'`,
        );
      }
      return binding.value as ArgumentOutput<ArgumentType>;
    },
  });
  const exitCode = await selected.definition.handler(selected.args as never, context);
  return normalizeHandlerExitCode(exitCode);
}

async function writeWarnings(result: object, options: RunOptions): Promise<void> {
  for (const warning of getWarnings(result)) {
    if (options.onWarning !== undefined) {
      options.onWarning(warning);
    } else {
      const message = sanitizeDiagnostic(`${warning.target} '${warning.name}' is deprecated: ${warning.message}`);
      await writeMessage('stderr', `warning: ${message}\n`, options);
    }
  }
}
