import type { ArgumentDefinition } from '../argument/types.js';
import { argumentLongNames } from '../command/parsing/recognition.js';
import type { CommandDefinition } from '../command/schema.js';

export function completionDefault(command: CommandDefinition): CommandDefinition | undefined {
  return command.defaultSubcommand === undefined
    ? undefined
    : command.subcommands.find((child) => child.name === command.defaultSubcommand && !child.hidden);
}

export function builtinOptions(command: CommandDefinition): readonly NamedCompletion[] {
  const options: NamedCompletion[] = [];
  if (!command.disableHelpFlag) {
    options.push({ value: '-h', description: 'Print help' }, { value: '--help', description: 'Print help' });
  }
  if (command.version !== undefined && !command.disableVersionFlag) {
    options.push({ value: '-V', description: 'Print version' }, { value: '--version', description: 'Print version' });
  }
  if (command.enableJsonFlag) {
    options.push({ value: '--json', description: 'Print handler result as JSON' });
  }
  return options;
}

interface NamedCompletion {
  readonly value: string;
  readonly description?: string;
  readonly argument?: ArgumentDefinition;
}

function argumentOptions(argument: ArgumentDefinition): string[] {
  return [
    ...(argument.short === undefined ? [] : [`-${argument.short}`]),
    ...argumentLongNames(argument).map((name) => `--${name}`),
  ];
}

export function defaultOptions(
  command: CommandDefinition,
  activeArguments: readonly ArgumentDefinition[],
  positional?: ArgumentDefinition,
): readonly NamedCompletion[] {
  let child = completionDefault(command);
  if (child === undefined || positional?.literal === true || positional?.allowHyphenValues === true) {
    return [];
  }

  const seen = new Set([...activeArguments.flatMap(argumentOptions), ...builtinOptions(command).map(({ value }) => value)]);
  const options: NamedCompletion[] = [];
  while (child !== undefined) {
    const firstPositional: ArgumentDefinition | undefined = child.arguments.find(({ kind }) => kind === 'positional');
    if (firstPositional?.literal === true) {
      break;
    }
    for (const argument of child.arguments) {
      for (const value of argumentOptions(argument)) {
        if (!seen.has(value) && !argument.hidden) {
          options.push({ value, argument, ...(argument.help === undefined ? {} : { description: argument.help }) });
        }
        seen.add(value);
      }
    }
    for (const option of builtinOptions(child)) {
      if (!seen.has(option.value)) {
        options.push(option);
        seen.add(option.value);
      }
    }
    child = firstPositional?.allowHyphenValues === true ? undefined : completionDefault(child);
  }
  return options;
}
