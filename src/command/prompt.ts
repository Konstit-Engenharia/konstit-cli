import type { ArgumentDefinition } from '../argument/index.js';
import {
  ErrorKind,
  type CliError,
  type ParseResult,
} from '../result/error.js';
import {
  externalCommandDefinitions,
  tryParseConfigured,
} from './parsing/runtime.js';
import type { CommandDefinition } from './schema.js';
import type {
  PromptHandler,
  PromptRequest,
  RunOptions,
} from './types.js';

interface PromptTarget {
  readonly argument: ArgumentDefinition;
  readonly commandPath: readonly string[];
}

function promptEnabled(options: RunOptions): boolean {
  if (options.prompt !== undefined) {
    return true;
  }
  return options.interactive === true
    && process.stdin.isTTY === true
    && process.stderr.isTTY === true;
}

function promptHandler(options: RunOptions): PromptHandler {
  if (options.prompt !== undefined) {
    return options.prompt;
  }
  return async ({ message, sensitive }) => {
    if (sensitive) {
      throw new TypeError('Sensitive interactive prompts require the RunOptions.prompt callback');
    }
    const { createInterface } = await import('node:readline/promises');
    const input = process.stdin;
    const readline = createInterface({ input, output: process.stderr });
    let resolveEnd: (() => void) | undefined;
    const onEnd = (): void => resolveEnd?.();
    const end = new Promise<undefined>((resolve) => {
      resolveEnd = () => resolve(undefined);
      input.once('end', onEnd);
      input.once('close', onEnd);
    });
    const signal = options.signal;
    let resolveAbort: (() => void) | undefined;
    const aborted = signal === undefined
      ? undefined
      : new Promise<undefined>((resolve) => {
        resolveAbort = () => resolve(undefined);
        if (signal.aborted) {
          resolveAbort();
        } else {
          signal.addEventListener('abort', resolveAbort, { once: true });
        }
      });
    try {
      const question = readline.question(`${message} `);
      return aborted === undefined
        ? await Promise.race([question, end])
        : await Promise.race([question, end, aborted]);
    } finally {
      input.removeListener('end', onEnd);
      input.removeListener('close', onEnd);
      if (resolveAbort !== undefined && signal !== undefined) {
        signal.removeEventListener('abort', resolveAbort);
      }
      readline.close();
    }
  };
}

function commandAtPath(
  definition: CommandDefinition,
  commandPath: readonly string[],
  externalCommands?: ReadonlyMap<string, CommandDefinition>,
): CommandDefinition | undefined {
  let current = definition;
  const path = [definition.name];
  for (const name of commandPath.slice(1)) {
    path.push(name);
    const child = current.subcommands.find((candidate) => candidate.name === name) ?? externalCommands?.get(path.join('\u0000'));
    if (child === undefined) {
      return undefined;
    }
    current = child;
  }
  return current;
}

function canPrompt(argument: ArgumentDefinition | undefined): argument is ArgumentDefinition {
  return argument !== undefined
    && argument.prompt !== undefined
    && argument.prompt !== false
    && argument.kind === 'option'
    && !argument.repeatable
    && argument.minValues <= 1
    && argument.maxValues === 1;
}

function promptMessage(argument: ArgumentDefinition): string {
  return typeof argument.prompt === 'string'
    ? argument.prompt
    : argument.help ?? argument.name;
}

function promptKey(commandPath: readonly string[], name: string): string {
  return `${commandPath.join('\u0000')}:${name}`;
}

function targetsFromError(
  definition: CommandDefinition,
  error: CliError,
  prompted: ReadonlySet<string>,
): PromptTarget[] {
  if (
    error.kind !== ErrorKind.MissingRequiredArgument
    && error.kind !== ErrorKind.MissingDependency
    && error.kind !== ErrorKind.NoEquals
    && error.kind !== ErrorKind.TooFewValues
  ) {
    return [];
  }
  const command = commandAtPath(definition, error.commandPath, externalCommandDefinitions.get(error));
  if (command === undefined) {
    return [];
  }
  const names = error.kind === ErrorKind.MissingRequiredArgument
    ? [
      ...(error.argumentName === undefined ? [] : [error.argumentName]),
      ...error.relatedArguments,
    ]
    : error.argumentName === undefined
    ? []
    : [error.argumentName];
  const targets: PromptTarget[] = [];
  for (const name of names) {
    const argument = command.arguments.find((candidate) => candidate.name === name);
    if (canPrompt(argument) && !prompted.has(promptKey(error.commandPath, name))) {
      targets.push({ argument, commandPath: error.commandPath });
    }
  }
  return targets;
}

function targetsFromValue(
  definition: CommandDefinition,
  value: unknown,
  prompted: ReadonlySet<string>,
  externalCommands?: ReadonlyMap<string, CommandDefinition>,
  commandPath: readonly string[] = [definition.name],
): PromptTarget[] {
  const values = value as Record<string, unknown>;
  const targets = definition.arguments
    .filter((argument) =>
      canPrompt(argument)
      && values[argument.name] === undefined
      && !prompted.has(promptKey(commandPath, argument.name))
    )
    .map((argument) => ({ argument, commandPath }));
  const selected = values.subcommand;
  if (
    typeof selected !== 'object'
    || selected === null
    || !('name' in selected)
    || !('args' in selected)
    || typeof selected.name !== 'string'
  ) {
    return targets;
  }
  const childPath = [...commandPath, selected.name];
  const child = definition.subcommands.find(({ name }) => name === selected.name) ?? externalCommands?.get(childPath.join('\u0000'));
  return child === undefined
    ? targets
    : [...targets, ...targetsFromValue(child, selected.args, prompted, externalCommands, childPath)];
}

function promptRequest(target: PromptTarget): PromptRequest {
  return {
    argumentName: target.argument.name,
    commandPath: target.commandPath,
    message: promptMessage(target.argument),
    sensitive: target.argument.sensitive,
  };
}

/** Resolves configured prompt values before dispatching a `run()` handler. */
export async function promptConfiguredResult<Value>(
  definition: CommandDefinition,
  argv: readonly string[],
  initial: ParseResult<Value>,
  defaultColor: boolean,
  options: RunOptions,
): Promise<ParseResult<Value>> {
  if (!promptEnabled(options)) {
    return initial;
  }
  const ask = promptHandler(options);
  const prompted = new Set<string>();
  const promptValues: Record<string, string> = {};
  let current = initial;
  while (true) {
    const targets = current.type === 'error'
      ? targetsFromError(definition, current.error, prompted)
      : current.type === 'value'
      ? targetsFromValue(definition, current.value, prompted, externalCommandDefinitions.get(current.value as object))
      : [];
    if (targets.length === 0) {
      return current;
    }
    for (const target of targets) {
      const key = promptKey(target.commandPath, target.argument.name);
      prompted.add(key);
      const response = await ask(promptRequest(target));
      if (response === undefined) {
        return current;
      }
      promptValues[key] = response;
    }
    current = tryParseConfigured<Value>(definition, argv, defaultColor, options, promptValues);
  }
}
