import { copyValueSources } from '../result/value-source.js';
import type { CommandDefinition } from './schema.js';

function camelCaseName(name: string): string {
  return name.replace(/[-_]+([^-_])?/gu, (_separator, first: string | undefined) => first?.toUpperCase() ?? '');
}

export function validateHandlerArgumentNames(definition: CommandDefinition): void {
  if (!definition.camelCaseArgs) {
    return;
  }
  const names = new Set(definition.subcommands.length > 0 || definition.externalSubcommand !== undefined ? ['subcommand'] : []);
  for (const argument of definition.arguments) {
    const name = camelCaseName(argument.name);
    if (names.has(name)) {
      throw new TypeError(`Argument '${argument.name}' maps to duplicate handler key '${name}' with camelCaseArgs enabled`);
    }
    names.add(name);
  }
}

export function createHandlerArguments(
  definition: CommandDefinition,
  parsedArgs: Record<string, unknown>,
): Record<string, unknown> {
  if (!definition.camelCaseArgs) {
    return parsedArgs;
  }
  const sourceNames = new Map<string, string>();
  const entries = Object.entries(parsedArgs).map(([name, value,]) => {
    const key = camelCaseName(name);
    if (key !== name) {
      sourceNames.set(key, name);
    }
    return [key, value] as const;
  });
  if (sourceNames.size === 0) {
    return parsedArgs;
  }
  const args = Object.freeze(Object.fromEntries(entries));
  copyValueSources(parsedArgs, args, sourceNames);
  return args;
}
