import {
  getArgumentDefinition,
  type AnyGlobalArgument,
  type ArgumentDefinition,
  type ArgumentOutput,
} from '../argument/index.js';
import { sanitizeDiagnostic } from '../help/diagnostics.js';
import {
  helpDisplayMetadata,
  type HelpDisplayMetadata,
} from '../help/render.js';
import { getWarnings } from '../result/deprecation.js';
import {
  CommandFailure,
  DisplayKind,
  type CliError,
  type ParseDisplay,
  type ParseResult,
} from '../result/error.js';
import {
  resolveOutputColor,
  type AnsiColorFormat,
} from '../terminal/color.js';
import { createConsole } from '../terminal/console.js';
import { DEFAULT_LS_COLORS } from '../terminal/ls-colors.js';
import {
  writeOutput,
  type OutputChannel,
} from '../terminal/output.js';
import { createStyle } from '../terminal/style.js';
import { readEnv } from './environment.js';
import { outputColorModes } from './parse.js';
import type { CommandDefinition } from './schema.js';
import type {
  HandlerContext,
  HandlerResult,
  RunOptions,
} from './types.js';

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
  const exitCode = options.parseErrorExitCode ?? error.exitCode;
  if (options.diagnostics === 'json') {
    await writeJsonDiagnostic({
      type: 'parse-error',
      kind: error.kind,
      message: sanitizeDiagnostic(error.message),
      exitCode,
      ...(error.argumentName === undefined ? {} : { argumentName: error.argumentName }),
      commandPath: error.commandPath,
      ...(error.tokenIndex === undefined ? {} : { tokenIndex: error.tokenIndex }),
      suggestions: error.suggestions,
      relatedArguments: error.relatedArguments,
    }, options);
    return exitCode;
  }
  const decision = resolveOutputColor('stderr', outputColorModes.get(error), options.color, options.stderr, options.env);
  await writeMessage(
    'stderr',
    decision.enabled
      ? styleParseFailure(error.output, decision.format)
      : error.output,
    options,
  );
  return exitCode;
}

async function writeJsonDiagnostic(
  diagnostic: Readonly<Record<string, unknown>>,
  options: RunOptions,
): Promise<void> {
  await writeMessage('stderr', `${JSON.stringify(diagnostic)}\n`, options);
}

const helpAnsi = Object.freeze({ strong: '\x1b[1m', faint: '\x1b[2m', reset: '\x1b[0m' });
const helpAccent = '#0891b2';
const errorAccent = '#dc2626';

function helpPalette(format: AnsiColorFormat): {
  readonly heading: string;
  readonly label: string;
  readonly exampleCommand: string;
  readonly exampleValue: string;
  readonly faint: string;
  readonly strong: string;
  readonly reset: string;
} {
  const accent = Bun.color(helpAccent, format) ?? '';
  return {
    heading: `${helpAnsi.strong}${accent}`,
    label: accent,
    exampleCommand: `${helpAnsi.strong}${Bun.color('#22c55e', format) ?? ''}`,
    exampleValue: Bun.color('#2563eb', format) ?? '',
    ...helpAnsi,
  };
}

function styleExampleCommand(text: string, invocation: string | undefined, palette: ReturnType<typeof helpPalette>): string {
  const command = text.slice(4);
  const invocationEnd = invocation !== undefined && (command === invocation || command.startsWith(`${invocation} `))
    ? invocation.length
    : 0;
  const prompt = invocation === undefined ? text.slice(0, 4) : `  ${palette.faint}$${palette.reset} `;
  const highlighted = command.replace(/(?:\\.|"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'\\])+/g, (word, offset: number) => {
    if (invocation !== undefined && (offset === 0 || offset < invocationEnd)) {
      return `${palette.exampleCommand}${word}${palette.reset}`;
    }
    const color = /^--?[a-z]/i.test(word) ? palette.label : palette.exampleValue;
    return `${color}${word}${palette.reset}`;
  });
  return prompt + highlighted;
}

function styleHelp(
  output: string,
  format: AnsiColorFormat,
  metadata?: HelpDisplayMetadata,
): string {
  const palette = helpPalette(format);
  const lines = metadata?.lines ?? output.split('\n').map((text) => ({ text, role: undefined }));
  const styled = lines.map(({ text, role }) => {
    if (role?.kind === 'heading') {
      return `${palette.heading}${text}${palette.reset}`;
    }
    if (role?.kind === 'title') {
      const { nameEnd, versionStart } = role;
      const name = `${palette.heading}${text.slice(0, nameEnd)}${palette.reset}`;
      const description = text.slice(nameEnd, versionStart);
      const version = versionStart === undefined
        ? ''
        : `${palette.faint}${text.slice(versionStart)}${palette.reset}`;
      return `${name}${description}${version}`;
    }
    if (role?.kind === 'usage' || (metadata === undefined && text.startsWith('Usage: '))) {
      return `${palette.heading}Usage:${palette.reset} ${palette.strong}${text.slice(7)}${palette.reset}`;
    }
    if (role?.kind === 'author' || (metadata === undefined && text.startsWith('Author: '))) {
      return `${palette.heading}Author:${palette.reset} ${text.slice(8)}`;
    }
    if (role?.kind === 'exampleDescription') {
      return `  ${palette.faint}${text.slice(2)}${palette.reset}`;
    }
    if (role?.kind === 'exampleCommand') {
      return styleExampleCommand(text, role.invocation, palette);
    }
    if (role?.kind !== 'entry') {
      return text;
    }
    const { labelStart, labelEnd, placeholderEnd } = role;
    const indentation = text.slice(0, labelStart);
    const suffix = text.slice(labelEnd);
    if (placeholderEnd !== undefined) {
      const placeholder = text.slice(labelStart, placeholderEnd);
      const flag = text.slice(placeholderEnd + 1, labelEnd);
      return `${indentation}${palette.faint}${placeholder}${palette.reset} ${palette.heading}${flag}${palette.reset}${suffix}`;
    }
    return `${indentation}${palette.label}${text.slice(labelStart, labelEnd)}${palette.reset}${suffix}`;
  }).join('\n');
  return metadata === undefined ? styled : `${styled}\n`;
}

function styleParseFailure(output: string, format: AnsiColorFormat): string {
  const accent = Bun.color(errorAccent, format) ?? '';
  const styled = styleHelp(output, format);
  return `${helpAnsi.strong}${accent}error:${helpAnsi.reset}${styled.slice(6)}`;
}

async function writeDisplay(
  display: ParseDisplay,
  options: RunOptions,
): Promise<number> {
  const decision = resolveOutputColor('stdout', outputColorModes.get(display), options.color, options.stdout, options.env);
  const metadata = display.kind === DisplayKind.Help
    ? helpDisplayMetadata.get(display)
    : undefined;
  const output = display.kind === DisplayKind.Help
      && decision.enabled
      && metadata !== undefined
    ? styleHelp(display.output, decision.format, metadata)
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
  const lsColors = options.lsColors ?? readEnv(options.env ?? Bun.env, 'LS_COLORS') ?? DEFAULT_LS_COLORS;
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
    return writeDisplay(result, options);
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
    stdout: resolveOutputColor('stdout', mode, options.color, options.stdout, options.env),
    stderr: resolveOutputColor('stderr', mode, options.color, options.stderr, options.env),
  };
  let stdin = options.stdin;
  const signal = options.signal ?? new AbortController().signal;
  const context: HandlerContext = Object.freeze({
    commandPath: Object.freeze([...selected.path]),
    signal,
    get stdin(): ReadableStream<Uint8Array> {
      stdin ??= Bun.stdin.stream();
      return stdin;
    },
    stdout: (chunk: string) => writeOutput('stdout', chunk, options.stdout),
    stderr: (chunk: string) => writeOutput('stderr', chunk, options.stderr),
    style: createStyle(colors, lsColors),
    output: createConsole(
      options.output,
      resolveOutputColor('stderr', mode, options.color, options.output?.stderr, options.env),
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
  try {
    return normalizeHandlerExitCode(await selected.definition.handler(selected.args as never, context));
  } catch (error) {
    if (!(error instanceof CommandFailure)) {
      throw error;
    }
    const { message, exitCode } = error;
    if (options.diagnostics === 'json') {
      await writeJsonDiagnostic({
        type: 'command-failure',
        message: sanitizeDiagnostic(message),
        exitCode,
        commandPath: selected.path,
      }, options);
      return exitCode;
    }
    await writeMessage('stderr', message.endsWith('\n') ? message : `${message}\n`, options);
    return exitCode;
  }
}

async function writeWarnings(result: object, options: RunOptions): Promise<void> {
  for (const warning of getWarnings(result)) {
    if (options.onWarning !== undefined) {
      options.onWarning(warning);
    } else if (options.diagnostics === 'json') {
      await writeJsonDiagnostic({
        type: 'warning',
        kind: warning.kind,
        target: warning.target,
        name: sanitizeDiagnostic(warning.name),
        message: sanitizeDiagnostic(warning.message),
        commandPath: warning.commandPath,
        ...(warning.argumentName === undefined ? {} : { argumentName: warning.argumentName }),
      }, options);
    } else {
      const message = sanitizeDiagnostic(`${warning.target} '${warning.name}' is deprecated: ${warning.message}`);
      await writeMessage('stderr', `warning: ${message}\n`, options);
    }
  }
}
