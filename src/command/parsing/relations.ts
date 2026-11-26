import {
  collectsArgumentValues,
  type ArgumentDefinition,
} from '../../argument/index.js';
import { commandError } from '../../help/diagnostics.js';
import { displayName } from '../../help/usage.js';
import { describeRequiredValueCount } from '../../help/value-syntax.js';
import { ErrorKind } from '../../result/error.js';
import { handlerColorEnabled } from '../../terminal/color.js';
import {
  readEnv,
  type Environment,
} from '../environment.js';
import type { CommandDefinition } from '../schema.js';
import {
  defaultArgument,
  environmentPolicy,
  hasCommandLineInput,
  restoreArgumentDefault,
  suppliedArgument,
  suppliedArgumentNames,
  type ArgumentValues,
} from './argument-state.js';

export interface RelationState extends ArgumentValues {
  readonly session?: {
    readonly defaultColor?: boolean;
    colorMode?: 'auto' | 'always' | 'never';
  };
}

function hasInputForConditionalDefault(state: RelationState, name: string): boolean {
  const argument = state.argumentStates.get(name);
  return argument !== undefined && (argument.kind !== 'implicit' || argument.source === 'env');
}

export function applyConditionalDefaults(
  definition: CommandDefinition,
  state: RelationState,
  env: Environment,
): void {
  const rulesByTarget = new Map<string, typeof definition.defaultIf[number][]>();
  for (const rule of definition.defaultIf) {
    const rules = rulesByTarget.get(rule.target) ?? [];
    rules.push(rule);
    rulesByTarget.set(rule.target, rules);
  }
  const resolutionStates = new Map<string, 'resolving' | 'resolved'>();

  const resolve = (targetName: string): void => {
    switch (resolutionStates.get(targetName) ?? 'unresolved') {
      case 'resolved':
        return;
      case 'resolving':
        throw new TypeError('Conditional defaults contain a dependency cycle');
      case 'unresolved':
        break;
    }
    if (hasInputForConditionalDefault(state, targetName)) {
      resolutionStates.set(targetName, 'resolved');
      return;
    }
    resolutionStates.set(targetName, 'resolving');
    const target = definition.arguments.find(({ name }) => name === targetName);
    const rules = rulesByTarget.get(targetName) ?? [];
    if (target !== undefined) {
      for (const rule of rules) {
        if (rule.hasEquals) {
          resolve(rule.source);
          if (!matchesRelationValue(state.values[rule.source], rule.equals)) {
            continue;
          }
        } else if (!hasInputForConditionalDefault(state, rule.source)) {
          continue;
        }
        state.values[target.name] = collectsArgumentValues(target)
          ? [...(rule.value as readonly unknown[])]
          : rule.value;
        state.argumentStates.set(target.name, defaultArgument);
        if (target.color) {
          if (readEnv(env, 'NO_COLOR') !== undefined) {
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
    resolutionStates.set(targetName, 'resolved');
  };

  for (const target of rulesByTarget.keys()) {
    resolve(target);
  }
}

export function applyOverrides(
  definition: CommandDefinition,
  state: RelationState,
  env: Environment,
): void {
  // Resolve every source before clearing any targets so chained rules see the same input.
  const overrides = definition.overrides.filter(({ source }) => hasCommandLineInput(state, source));
  for (const { target } of overrides) {
    const argument = definition.arguments.find(({ name }) => name === target);
    if (argument === undefined) {
      continue;
    }
    restoreArgumentDefault(state, argument);
    if (argument.color) {
      // Clearing a color switch restores the automatic policy used by an absent flag.
      const colorDisabled = readEnv(env, 'NO_COLOR') !== undefined;
      state.values[target] = colorDisabled
        ? false
        : state.session?.defaultColor ?? handlerColorEnabled({ env });
      if (state.session !== undefined) {
        state.session.colorMode = colorDisabled ? 'never' : 'auto';
      }
      if (colorDisabled) {
        state.argumentStates.set(target, environmentPolicy);
      }
    }
  }
}

function matchesRelationValue(actual: unknown, expected: unknown): boolean {
  return Array.isArray(actual)
    ? actual.some((value) => Object.is(value, expected))
    : Object.is(actual, expected);
}

function displayRelationValue(definition: CommandDefinition, name: string, expected: unknown): string {
  return definition.arguments.some((argument) => argument.name === name && argument.sensitive)
    ? '[redacted]'
    : String(expected);
}

export function validateRelations(
  definition: CommandDefinition,
  path: readonly string[],
  state: RelationState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  const isSupplied = (name: string): boolean => suppliedArgument(state, name) !== undefined;
  for (const { source, target } of definition.requirements) {
    if (isSupplied(source) && !isSupplied(target)) {
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
      isSupplied(source)
      && (!isSupplied(target) || !matchesRelationValue(state.values[target], expected))
    ) {
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}' with value '${
          displayRelationValue(definition, target, expected)
        }'`,
        definition,
        path,
        inheritedArguments,
        { argumentName: target, relatedArguments: [source] },
      );
    }
  }
  for (const { source, expected, target, valueCount } of definition.conditionalRequirements) {
    if (!matchesRelationValue(state.values[source], expected)) {
      continue;
    }
    const supplied = suppliedArgument(state, target);
    if (supplied === undefined) {
      const count = valueCount === undefined ? '' : ` with ${describeRequiredValueCount(valueCount)}`;
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}'${count} when its value is '${
          displayRelationValue(definition, source, expected)
        }'`,
        definition,
        path,
        inheritedArguments,
        { argumentName: target, relatedArguments: [source] },
      );
    }
    if (valueCount !== undefined) {
      const { exactValues, minValues, maxValues } = valueCount;
      const { valueCount: count, tokenIndex } = supplied;
      const tooFew = count < (exactValues ?? minValues ?? 0);
      if (tooFew || count > (exactValues ?? maxValues ?? Infinity)) {
        throw commandError(
          tooFew ? ErrorKind.TooFewValues : ErrorKind.TooManyValues,
          `argument '${displayName(definition, target)}' requires ${describeRequiredValueCount(valueCount)} when '${
            displayName(definition, source)
          }' is '${displayRelationValue(definition, source, expected)}' (received ${count})`,
          definition,
          path,
          inheritedArguments,
          { argumentName: target, relatedArguments: [source], ...(tokenIndex === undefined ? {} : { tokenIndex }) },
        );
      }
    }
  }
  for (const requirement of definition.conditionalSetRequirements) {
    const matches = requirement.conditions.map(({ source, expected }) =>
      isSupplied(source)
      && matchesRelationValue(state.values[source], expected)
    );
    const matched = requirement.match === 'any'
      ? matches.some(Boolean)
      : matches.every(Boolean);
    if (matched && !isSupplied(requirement.target)) {
      const joiner = requirement.match === 'any' ? ' or ' : ' and ';
      const conditions = requirement.conditions
        .map(({ source, expected }) => `'${displayName(definition, source)}=${displayRelationValue(definition, source, expected)}'`)
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
      !isSupplied(target)
      && !alternatives.some(isSupplied)
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
      !isSupplied(target)
      && !alternatives.every(isSupplied)
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
    if (!isSupplied(exclusive)) {
      continue;
    }
    const others = [...suppliedArgumentNames(state)].filter((name) => name !== exclusive);
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
    const present = conflict.filter(isSupplied);
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
    const present = group.members.filter(isSupplied);
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
        (name) => !isSupplied(name),
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
      const conflict = group.conflicts.find(isSupplied);
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
