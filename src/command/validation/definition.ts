import type { ArgumentDefinition } from '../../argument/types.js';
import { argumentLongNames } from '../parsing/recognition.js';
import type { CommandDefinition } from '../schema.js';

export function validateCommandName(name: unknown): void {
  if (typeof name !== 'string') {
    throw new TypeError('Invalid command name: expected a string');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new TypeError(`Invalid command name: ${JSON.stringify(name)}`);
  }
}

export function validateCommandAlias(definition: CommandDefinition, alias: string): void {
  if (alias === definition.name || definition.aliases.some(({ name }) => name === alias)) {
    throw new TypeError(`Duplicate command alias: ${alias}`);
  }
}

export function validateArgument(
  commandDefinition: CommandDefinition,
  argument: ArgumentDefinition,
): void {
  const all = commandDefinition.arguments;
  if (all.some(({ name }) => name === argument.name)) {
    throw new TypeError(`Duplicate argument: ${argument.name}`);
  }
  if (argument.color && all.some((current) => current.color)) {
    throw new TypeError('A command cannot contain more than one color flag');
  }
  if (argument.kind === 'positional') {
    if (argument.short !== undefined || argument.long !== undefined) {
      throw new TypeError(`Positional '${argument.name}' cannot have option names`);
    }
    const positionals = all.filter(({ kind }) => kind === 'positional');
    if (argument.maxValues === 0) {
      throw new TypeError(`Positional '${argument.name}' must accept at least one value`);
    }
    const previous = positionals.at(-1);
    if (
      previous !== undefined
      && (previous.repeatable || previous.trailingVarArg || previous.maxValues === null)
    ) {
      throw new TypeError(
        `No positional can follow repeatable or unbounded '${previous.name}'`,
      );
    }
    if (
      (argument.presence === 'required' || argument.presence === 'without-subcommand')
      && positionals.some(({ presence }) => presence === 'optional' || presence === 'default')
    ) {
      throw new TypeError('A required positional cannot follow an optional positional');
    }
  }

  if (argument.kind !== 'positional' && argument.trailingVarArg) {
    throw new TypeError(`Named argument '${argument.name}' cannot be trailing`);
  }
  if (argument.kind === 'positional' && argument.global) {
    throw new TypeError(`Positional '${argument.name}' cannot be global`);
  }

  const reservedLongs = new Set([
    ...(commandDefinition.disableHelpFlag ? [] : ['help']),
    ...(commandDefinition.version === undefined || commandDefinition.disableVersionFlag
      ? []
      : ['version']),
  ]);
  const reservedShorts = new Set([
    ...(commandDefinition.disableHelpFlag ? [] : ['h']),
    ...(commandDefinition.version === undefined || commandDefinition.disableVersionFlag
      ? []
      : ['V']),
  ]);
  const argumentLongs = argumentLongNames(argument);
  if (new Set(argumentLongs).size !== argumentLongs.length) {
    throw new TypeError(`Argument '${argument.name}' has duplicate long options`);
  }
  for (const long of argumentLongs) {
    if (reservedLongs.has(long)) {
      throw new TypeError(`Option '--${long}' is reserved`);
    }
    if (all.some((current) => argumentLongNames(current).includes(long))) {
      throw new TypeError(`Duplicate long option: --${long}`);
    }
  }
  if (argument.short !== undefined) {
    if (reservedShorts.has(argument.short)) {
      throw new TypeError(`Option '-${argument.short}' is reserved`);
    }
    if (all.some(({ short }) => short === argument.short)) {
      throw new TypeError(`Duplicate short option: -${argument.short}`);
    }
  }
}

export function validateBuiltInCollisions(
  definition: CommandDefinition,
  inheritedGlobals: readonly ArgumentDefinition[],
): void {
  const available = [...definition.arguments, ...inheritedGlobals];
  if (
    !definition.disableHelpFlag && available.some(
      (argument) =>
        argument.short === 'h'
        || argumentLongNames(argument).includes('help'),
    )
  ) {
    throw new TypeError('Help flags conflict with an existing argument');
  }
  if (
    definition.version !== undefined
    && !definition.disableVersionFlag
    && available.some(
      (argument) =>
        argument.short === 'V'
        || argumentLongNames(argument).includes('version'),
    )
  ) {
    throw new TypeError('Version flags conflict with an existing argument');
  }

  const globals = [
    ...inheritedGlobals,
    ...definition.arguments.filter(({ global }) => global),
  ];
  if (globals.filter(({ color }) => color).length > 1) {
    throw new TypeError('An active command path cannot contain more than one color flag');
  }
  for (const child of definition.subcommands) {
    validateBuiltInCollisions(child, globals);
  }
}
