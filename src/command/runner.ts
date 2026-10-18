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
import { sanitizeDiagnostic } from './help.js';
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

type OutputChannel = 'stdout' | 'stderr';

interface ColorDecision {
  readonly enabled: boolean;
  readonly force: boolean;
}

export function handlerColorEnabled(options: RunOptions = {}): boolean {
  if (Bun.env.NO_COLOR !== undefined) {
    return false;
  }
  return options.color
    ?? (process.stdout.isTTY === true && Bun.env.TERM !== 'dumb');
}

function automaticColorEnabled(
  channel: OutputChannel,
  options: RunOptions = {},
): boolean {
  const output = {
    stderr: { stream: process.stderr, writer: options.stderr },
    stdout: { stream: process.stdout, writer: options.stdout },
  }[channel];
  const interactive = output.writer === undefined
    && output.stream.isTTY === true
    && Bun.env.NO_COLOR === undefined
    && Bun.env.TERM !== 'dumb';
  return options.color ?? interactive;
}

function colorDecision(
  target: object,
  channel: OutputChannel,
  options: RunOptions,
): ColorDecision | undefined {
  const mode = outputColorModes.get(target);
  if (mode === undefined) {
    return undefined;
  }
  if (Bun.env.NO_COLOR !== undefined || mode === 'never') {
    return { enabled: false, force: false };
  }
  if (mode === 'always') {
    return { enabled: true, force: true };
  }
  return {
    enabled: automaticColorEnabled(channel, options),
    force: options.color === true,
  };
}

function writeParseFailure(error: CliError, options: RunOptions): number {
  const write = options.stderr ?? ((output: string) => console.error(output.trimEnd()));
  const decision = colorDecision(error, 'stderr', options);
  const enabled = decision?.enabled ?? automaticColorEnabled('stderr', options);
  write(
    enabled
      ? styleParseFailure(error.output, decision?.force ?? options.color === true)
      : error.output,
  );
  return options.parseErrorExitCode ?? error.exitCode;
}

const helpAnsi = Object.freeze({ strong: '\x1b[1m', reset: '\x1b[0m' });
const helpAccent = '#0891b2';
const errorAccent = '#dc2626';

function helpPalette(forceColor: boolean): {
  readonly heading: string;
  readonly label: string;
  readonly strong: string;
  readonly reset: string;
} {
  const format = forceColor ? 'ansi-16m' : 'ansi';
  const accent = Bun.color(helpAccent, format) ?? '';
  return {
    heading: `${helpAnsi.strong}${accent}`,
    label: accent,
    ...helpAnsi,
  };
}

function shouldStyleHelp(options: RunOptions): boolean {
  return options.color
    ?? (
      options.stdout === undefined
      && process.stdout.isTTY === true
      && Bun.env.NO_COLOR === undefined
      && Bun.env.TERM !== 'dumb'
    );
}

function hasHelpOverride(
  definition: CommandDefinition,
  output: string,
): boolean {
  return definition.overrideHelp === output
    || definition.subcommands.some((child) => hasHelpOverride(child, output));
}

function styleHelp(output: string, forceColor: boolean): string {
  const palette = helpPalette(forceColor);
  let entrySection = false;
  return output.split('\n').map((line) => {
    if (/^(Arguments|Commands|Options):$/.test(line)) {
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

function styleParseFailure(output: string, forceColor: boolean): string {
  const format = forceColor ? 'ansi-16m' : 'ansi';
  const accent = Bun.color(errorAccent, format) ?? '';
  const styled = styleHelp(output, forceColor);
  return `${helpAnsi.strong}${accent}error:${helpAnsi.reset}${styled.slice(6)}`;
}

function writeDisplay(
  definition: CommandDefinition,
  display: ParseDisplay,
  options: RunOptions,
): number {
  const write = options.stdout ?? ((output: string) => console.log(output.trimEnd()));
  const decision = colorDecision(display, 'stdout', options);
  const output = display.kind === DisplayKind.Help
      && (decision?.enabled ?? shouldStyleHelp(options))
      && !hasHelpOverride(definition, display.output)
    ? styleHelp(display.output, decision?.force ?? options.color === true)
    : display.output;
  write(output);
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
  if (
    options.parseErrorExitCode !== undefined
    && (!Number.isSafeInteger(options.parseErrorExitCode)
      || options.parseErrorExitCode < 1
      || options.parseErrorExitCode > 255)
  ) {
    throw new RangeError('parseErrorExitCode must be an integer from 1 to 255');
  }
  if (result.type === 'error') {
    writeWarnings(result, options);
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
  writeWarnings(result, options);
  const context: HandlerContext = Object.freeze({
    commandPath: Object.freeze([...selected.path]),
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

function writeWarnings(result: object, options: RunOptions): void {
  for (const warning of getWarnings(result)) {
    if (options.onWarning !== undefined) {
      options.onWarning(warning);
    } else {
      const message = sanitizeDiagnostic(`${warning.target} '${warning.name}' is deprecated: ${warning.message}`);
      const write = options.stderr ?? ((output: string) => console.error(output.trimEnd()));
      write(`warning: ${message}\n`);
    }
  }
}
