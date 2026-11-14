import type { ArgumentDefinition } from '../argument.js';
import { ErrorKind } from '../error.js';
import type { ValueSource } from '../value-source.js';
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
  readonly sources?: Map<string, ValueSource>;
  readonly session?: {
    colorMode?: 'auto' | 'always' | 'never';
  };
}

function collectsValues(argument: ArgumentDefinition): boolean {
  return (argument.kind === 'option' || argument.kind === 'positional')
    && (argument.repeatable || argument.trailingVarArg || argument.maxValues !== 1);
}

function copyDefaultValues(argument: ArgumentDefinition): unknown[] {
  return argument.defaultValues === undefined ? [] : [...argument.defaultValues];
}

function explicitlyProvided(state: RelationState, name: string): boolean {
  const source = state.sources?.get(name);
  return state.cliProvided.has(name) || source === 'env' || source === 'config';
}

export function applyConditionalDefaults(
  definition: CommandDefinition,
  state: RelationState,
): void {
  const rulesByTarget = new Map<string, typeof definition.defaultIf[number][]>();
  for (const rule of definition.defaultIf) {
    const rules = rulesByTarget.get(rule.target) ?? [];
    rules.push(rule);
    rulesByTarget.set(rule.target, rules);
  }
  const resolving = new Set<string>();
  const resolved = new Set<string>();

  const resolve = (targetName: string): void => {
    if (resolved.has(targetName) || explicitlyProvided(state, targetName)) {
      resolved.add(targetName);
      return;
    }
    if (resolving.has(targetName)) {
      throw new TypeError('Conditional defaults contain a dependency cycle');
    }
    resolving.add(targetName);
    const target = definition.arguments.find(({ name }) => name === targetName);
    const rules = rulesByTarget.get(targetName) ?? [];
    if (target !== undefined) {
      for (const rule of rules) {
        if (rule.hasEquals) {
          resolve(rule.source);
          if (!matchesRelationValue(state.values[rule.source], rule.equals)) {
            continue;
          }
        } else if (!explicitlyProvided(state, rule.source)) {
          continue;
        }
        state.values[target.name] = collectsValues(target)
          ? [...(rule.value as readonly unknown[])]
          : rule.value;
        state.sources?.set(target.name, 'default');
        if (target.color) {
          if (Bun.env.NO_COLOR !== undefined) {
            state.values[target.name] = false;
            if (state.session !== undefined) {
              state.session.colorMode = 'never';
            }
          } else if (state.session !== undefined) {
            state.session.colorMode = state.values[target.name] === true
              ? 'always'
              : 'never';
          }
        }
        break;
      }
    }
    resolving.delete(targetName);
    resolved.add(targetName);
  };

  for (const target of rulesByTarget.keys()) {
    resolve(target);
  }
}

export function applyOverrides(
  definition: CommandDefinition,
  state: RelationState,
): void {
  const cliProvided = new Set(state.cliProvided);
  for (const { source, target } of definition.overrides) {
    if (!cliProvided.has(source)) {
      continue;
    }
    const argument = definition.arguments.find(({ name }) => name === target);
    if (argument === undefined) {
      continue;
    }
    state.values[target] = argument.defaultValues !== undefined
      ? copyDefaultValues(argument)
      : argument.repeatable || argument.trailingVarArg
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
        { argumentName: target, relatedArguments: [source] },
      );
    }
  }
  for (const { source, target, expected } of definition.requiresValue) {
    if (
      state.provided.has(source)
      && (!state.provided.has(target) || !matchesRelationValue(state.values[target], expected))
    ) {
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}' with value '${String(expected)}'`,
        definition,
        path,
        inheritedArguments,
        { argumentName: target, relatedArguments: [source] },
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
        { argumentName: target, relatedArguments: [source] },
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
        {
          argumentName: requirement.target,
          relatedArguments: requirement.conditions.map(({ source }) => source),
        },
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
        { argumentName: target, relatedArguments: alternatives },
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
        { argumentName: target, relatedArguments: alternatives },
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
        { argumentName: exclusive, relatedArguments: others },
      );
    }
  }
  for (const conflict of definition.conflicts) {
    const present = conflict.filter((name) => state.provided.has(name));
    const first = present[0];
    if (present.length > 1 && first !== undefined) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `arguments ${present.map((name) => `'${displayName(definition, name)}'`).join(' and ')} cannot be used together`,
        definition,
        path,
        inheritedArguments,
        {
          argumentName: first,
          relatedArguments: present.slice(1),
        },
      );
    }
  }
  for (const group of definition.groups) {
    const present = group.members.filter((name) => state.provided.has(name));
    const first = present[0];
    if (group.required && present.length === 0) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `one of group '${group.name}' is required: ${group.members.map((name) => displayName(definition, name)).join(', ')}`,
        definition,
        path,
        inheritedArguments,
        {
          ...(group.members[0] === undefined ? {} : { argumentName: group.members[0] }),
          relatedArguments: group.members.slice(1),
        },
      );
    }
    if (!group.multiple && present.length > 1 && first !== undefined) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `arguments in group '${group.name}' cannot be used together: ${present.map((name) => displayName(definition, name)).join(', ')}`,
        definition,
        path,
        inheritedArguments,
        {
          argumentName: first,
          relatedArguments: present.slice(1),
        },
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
          { argumentName: missingRequirement, relatedArguments: present },
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
          { argumentName: conflict, relatedArguments: present },
        );
      }
    }
  }
}
