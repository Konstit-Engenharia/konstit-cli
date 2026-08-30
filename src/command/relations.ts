import type { ArgumentDefinition } from '../argument.js';
import { ErrorKind } from '../error.js';
import {
  commandError,
  displayName,
} from './help.js';
import type { CommandDefinition } from './schema.js';

export interface RelationState {
  readonly values: Record<string, unknown>;
  readonly provided: Set<string>;
  readonly cliProvided: Set<string>;
  readonly valueCounts: Record<string, number>;
}

export function applyOverrides(
  definition: CommandDefinition,
  state: RelationState,
): void {
  for (const { source, target } of definition.overrides) {
    if (!state.cliProvided.has(source)) {
      continue;
    }
    const argument = definition.arguments.find(({ name }) => name === target);
    if (argument === undefined) {
      continue;
    }
    state.values[target] = argument.repeatable || argument.trailingVarArg
      ? []
      : argument.presence === 'default'
      ? argument.defaultValue
      : undefined;
    state.provided.delete(target);
    state.cliProvided.delete(target);
    delete state.valueCounts[target];
  }
}

function matchesRelationValue(actual: unknown, expected: unknown): boolean {
  return Array.isArray(actual)
    ? actual.some((value) => Object.is(value, expected))
    : Object.is(actual, expected);
}

export function validateRelations(
  definition: CommandDefinition,
  path: readonly string[],
  state: RelationState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  for (const { source, target } of definition.requirements) {
    if (state.provided.has(source) && !state.provided.has(target)) {
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}'`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const { source, expected, target } of definition.conditionalRequirements) {
    if (
      matchesRelationValue(state.values[source], expected)
      && !state.provided.has(target)
    ) {
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}' when its value is '${
          String(expected)
        }'`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const requirement of definition.conditionalSetRequirements) {
    const matches = requirement.conditions.map(({ source, expected }) =>
      state.provided.has(source)
      && matchesRelationValue(state.values[source], expected)
    );
    const matched = requirement.match === 'any'
      ? matches.some(Boolean)
      : matches.every(Boolean);
    if (matched && !state.provided.has(requirement.target)) {
      const joiner = requirement.match === 'any' ? ' or ' : ' and ';
      const conditions = requirement.conditions
        .map(({ source, expected }) => `'${displayName(definition, source)}=${String(expected)}'`)
        .join(joiner);
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, requirement.target)}' is required when ${conditions}`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const { target, alternatives } of definition.requiredUnless) {
    if (
      !state.provided.has(target)
      && !alternatives.some((name) => state.provided.has(name))
    ) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `argument '${displayName(definition, target)}' is required unless ${
          alternatives.map((name) => `'${displayName(definition, name)}'`).join(' or ')
        } is present`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const { target, alternatives } of definition.requiredUnlessAll) {
    if (
      !state.provided.has(target)
      && !alternatives.every((name) => state.provided.has(name))
    ) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `argument '${displayName(definition, target)}' is required unless all of ${
          alternatives.map((name) => `'${displayName(definition, name)}'`).join(' and ')
        } are present`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const exclusive of definition.exclusiveArguments) {
    if (!state.provided.has(exclusive)) {
      continue;
    }
    const others = [...state.provided].filter((name) => name !== exclusive);
    if (others.length > 0) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `argument '${displayName(definition, exclusive)}' cannot be used with ${
          others.map((name) => `'${displayName(definition, name)}'`).join(' and ')
        }`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const conflict of definition.conflicts) {
    const present = conflict.filter((name) => state.provided.has(name));
    if (present.length > 1) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `arguments ${present.map((name) => `'${displayName(definition, name)}'`).join(' and ')} cannot be used together`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const group of definition.groups) {
    const present = group.members.filter((name) => state.provided.has(name));
    if (group.required && present.length === 0) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `one of group '${group.name}' is required: ${group.members.map((name) => displayName(definition, name)).join(', ')}`,
        definition,
        path,
        inheritedArguments,
      );
    }
    if (!group.multiple && present.length > 1) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `arguments in group '${group.name}' cannot be used together: ${present.map((name) => displayName(definition, name)).join(', ')}`,
        definition,
        path,
        inheritedArguments,
      );
    }
    if (present.length > 0) {
      const missingRequirement = group.requires.find(
        (name) => !state.provided.has(name),
      );
      if (missingRequirement !== undefined) {
        throw commandError(
          ErrorKind.MissingDependency,
          `argument group '${group.name}' requires '${displayName(definition, missingRequirement)}'`,
          definition,
          path,
          inheritedArguments,
        );
      }
      const conflict = group.conflicts.find((name) => state.provided.has(name));
      if (conflict !== undefined) {
        throw commandError(
          ErrorKind.ArgumentConflict,
          `argument group '${group.name}' conflicts with '${displayName(definition, conflict)}'`,
          definition,
          path,
          inheritedArguments,
        );
      }
    }
  }
}
