import type { CommandType } from '../command.js';
import type { CommandDefinition } from './schema.js';
import { validateBuiltInCollisions } from './validation.js';

const commandDefinitions = new WeakMap<object, CommandDefinition>();

export function setCommandDefinition(
  command: object,
  definition: CommandDefinition,
): void {
  commandDefinitions.set(command, definition);
}

/** Gets the runtime definition for internal parser and completion code. */
export function getCommandDefinition(command: CommandType): CommandDefinition {
  const definition = commandDefinitions.get(command);
  if (definition === undefined) {
    throw new TypeError('Expected a command created by command()');
  }
  return definition;
}

export function copyCommand(
  definition: CommandDefinition,
  patch: Partial<CommandDefinition>,
): CommandDefinition {
  const merged = { ...definition, ...patch };
  const copied = Object.freeze({
    ...merged,
    aliases: Object.freeze(
      merged.aliases.map((alias) => Object.freeze({ ...alias })),
    ),
    arguments: Object.freeze([...merged.arguments]),
    subcommands: Object.freeze([...merged.subcommands]),
    requirements: Object.freeze(
      merged.requirements.map((requirement) => Object.freeze({ ...requirement })),
    ),
    conditionalRequirements: Object.freeze(
      merged.conditionalRequirements.map((requirement) => Object.freeze({ ...requirement })),
    ),
    conditionalSetRequirements: Object.freeze(
      merged.conditionalSetRequirements.map((requirement) =>
        Object.freeze({
          ...requirement,
          conditions: Object.freeze(
            requirement.conditions.map((condition) => Object.freeze({ ...condition })),
          ),
        })
      ),
    ),
    requiredUnless: Object.freeze(
      merged.requiredUnless.map((requirement) =>
        Object.freeze({
          ...requirement,
          alternatives: Object.freeze([...requirement.alternatives]),
        })
      ),
    ),
    requiredUnlessAll: Object.freeze(
      merged.requiredUnlessAll.map((requirement) =>
        Object.freeze({
          ...requirement,
          alternatives: Object.freeze([...requirement.alternatives]),
        })
      ),
    ),
    exclusiveArguments: Object.freeze([...merged.exclusiveArguments]),
    overrides: Object.freeze(
      merged.overrides.map((override) => Object.freeze({ ...override })),
    ),
    conflicts: Object.freeze(
      merged.conflicts.map((conflict) => Object.freeze([...conflict])),
    ),
    groups: Object.freeze(
      merged.groups.map((group) =>
        Object.freeze({
          ...group,
          members: Object.freeze([...group.members]),
          requires: Object.freeze([...group.requires]),
          conflicts: Object.freeze([...group.conflicts]),
        })
      ),
    ),
  });
  validateBuiltInCollisions(copied, []);
  return copied;
}
