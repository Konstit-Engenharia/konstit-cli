import type { ArgumentDefinition } from '../../argument/types.js';
import type { CommandDefinition } from '../schema.js';
import {
  validateArray,
  validateClosedObject,
} from './shape.js';

interface RuntimeRequiredUnless {
  readonly alternatives: readonly string[];
  readonly target: string;
}

interface RuntimeConditionalDefault {
  readonly source: string;
  readonly equals?: unknown;
  readonly target: string;
  readonly value: unknown;
}

interface RuntimeGroupRelations {
  readonly name: string;
  readonly members: readonly string[];
  readonly requires?: readonly string[];
  readonly conflicts?: readonly string[];
}

interface RuntimeCommandRelations {
  readonly requires?: readonly (readonly [string, string])[];
  readonly requiresIf?: readonly (readonly [string, unknown, string])[];
  readonly requiresValue?: readonly (readonly [string, string, unknown])[];
  readonly requiredIfAny?: readonly RuntimeConditionalSetRelation[];
  readonly requiredIfAll?: readonly RuntimeConditionalSetRelation[];
  readonly requiredUnlessPresent?: readonly RuntimeRequiredUnless[];
  readonly requiredUnlessAll?: readonly RuntimeRequiredUnless[];
  readonly defaultIf?: readonly RuntimeConditionalDefault[];
  readonly overrides?: readonly (readonly [string, string])[];
  readonly conflicts?: readonly (readonly string[])[];
  readonly exclusive?: readonly string[];
  readonly groups?: readonly RuntimeGroupRelations[];
}

const conditionalDefaultKeys = new Set(['source', 'equals', 'target', 'value']);

function validateDefaultValueCount(
  argument: ArgumentDefinition,
  count: number,
  context: string,
): void {
  if (argument.repeatable) {
    if (count === 0) {
      return;
    }
    if (argument.maxValues === null) {
      if (count < argument.minValues) {
        throw new TypeError(`${context} does not contain a complete occurrence`);
      }
      return;
    }
    if (
      argument.minValues > 0
      && Math.ceil(count / argument.maxValues) > Math.floor(count / argument.minValues)
    ) {
      throw new TypeError(`${context} does not contain complete occurrences`);
    }
    return;
  }
  if (
    count < argument.minValues
    || (argument.maxValues !== null && count > argument.maxValues)
  ) {
    throw new TypeError(`${context} does not satisfy its value count`);
  }
}

function validateDenseArray(value: unknown, context: string): readonly unknown[] {
  const values = validateArray(value, context);
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.hasOwn(values, index)) {
      throw new TypeError(`${context} cannot contain sparse entries`);
    }
  }
  return values;
}

function validateConditionalTargetValue(
  argument: ArgumentDefinition,
  value: unknown,
  context: string,
): void {
  if (argument.kind === 'flag' && typeof value !== 'boolean') {
    throw new TypeError(`${context} flag value must be a boolean`);
  }
  if (
    argument.kind === 'count'
    && (
      typeof value !== 'number'
      || !Number.isSafeInteger(value)
      || value < 0
    )
  ) {
    throw new TypeError(`${context} count value must be a non-negative safe integer`);
  }
}

function validateConditionalDefaults(
  value: unknown,
  definition: CommandDefinition,
): void {
  const context = 'Command option \'defaultIf\'';
  const rules = validateArray(value, context) as readonly RuntimeConditionalDefault[];
  const names = new Set(definition.arguments.map(({ name }) => name));
  const graph = new Map<string, string[]>();
  for (const rule of rules) {
    validateClosedObject(rule, conditionalDefaultKeys, `${context} entry`);
    if (!Object.hasOwn(rule, 'value')) {
      throw new TypeError(`${context} entry must define a value`);
    }
    if (typeof rule.source !== 'string' || typeof rule.target !== 'string') {
      throw new TypeError(`${context} entries must contain argument names`);
    }
    validateDistinctRelation(names, rule.source, rule.target, context);
    const target = definition.arguments.find(({ name }) => name === rule.target);
    if (target === undefined) {
      continue;
    }
    const collectsValues = (target.kind === 'option' || target.kind === 'positional')
      && (target.repeatable || target.trailingVarArg || target.maxValues !== 1);
    if (collectsValues) {
      const values = validateDenseArray(rule.value, `${context} collection value`);
      validateDefaultValueCount(target, values.length, `${context} collection value`);
    } else {
      validateConditionalTargetValue(target, rule.value, `${context} target`);
    }
    const dependencies = graph.get(rule.target) ?? [];
    dependencies.push(rule.source);
    graph.set(rule.target, dependencies);
  }

  const visitStates = new Map<string, 'visiting' | 'visited'>();
  const visit = (name: string): void => {
    switch (visitStates.get(name) ?? 'unvisited') {
      case 'visited':
        return;
      case 'visiting':
        throw new TypeError(`${context} contains a dependency cycle`);
      case 'unvisited':
        break;
    }
    visitStates.set(name, 'visiting');
    for (const dependency of graph.get(name) ?? []) {
      visit(dependency);
    }
    visitStates.set(name, 'visited');
  };
  for (const target of graph.keys()) {
    visit(target);
  }
}

function validateArgumentReference(
  names: ReadonlySet<string>,
  name: string,
  context: string,
): void {
  if (!names.has(name)) {
    throw new TypeError(`${context} references unknown argument '${name}'`);
  }
}

function validateDistinctRelation(
  names: ReadonlySet<string>,
  source: string,
  target: string,
  context: string,
): void {
  validateArgumentReference(names, source, context);
  validateArgumentReference(names, target, context);
  if (source === target) {
    throw new TypeError(`${context} cannot target its source argument '${source}'`);
  }
}

function validateNoDuplicateNames(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${context} cannot contain duplicate arguments`);
  }
}

interface RuntimeConditionalSetRelation {
  readonly conditions: readonly (readonly [string, unknown])[];
  readonly target: string;
}

export function validateCommandRelations(
  options: RuntimeCommandRelations,
  definition: CommandDefinition,
): void {
  const names = new Set(definition.arguments.map(({ name }) => name));
  if (options.defaultIf !== undefined) {
    validateConditionalDefaults(options.defaultIf, definition);
  }
  for (const [source, target,] of options.requires ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requires\'');
  }
  for (const [source, , target,] of options.requiresIf ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requiresIf\'');
  }
  for (const [source, target,] of options.requiresValue ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requiresValue\'');
  }
  for (
    const { conditions, target } of (options.requiredIfAny ?? []) as readonly RuntimeConditionalSetRelation[]
  ) {
    const context = 'Command option \'requiredIfAny\'';
    validateArgumentReference(names, target, context);
    for (const [source,] of conditions) {
      validateDistinctRelation(names, source, target, context);
    }
  }
  for (
    const { conditions, target } of (options.requiredIfAll ?? []) as readonly RuntimeConditionalSetRelation[]
  ) {
    const context = 'Command option \'requiredIfAll\'';
    validateArgumentReference(names, target, context);
    for (const [source,] of conditions) {
      validateDistinctRelation(names, source, target, context);
    }
  }
  for (
    const [context, relations,] of [
      ['Command option \'requiredUnlessPresent\'', options.requiredUnlessPresent],
      ['Command option \'requiredUnlessAll\'', options.requiredUnlessAll],
    ] as const
  ) {
    for (const { alternatives, target } of relations ?? []) {
      validateArgumentReference(names, target, context);
      validateNoDuplicateNames(alternatives, context);
      for (const alternative of alternatives) {
        validateDistinctRelation(names, alternative, target, context);
      }
    }
  }
  for (const [source, target,] of options.overrides ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'overrides\'');
  }
  for (const conflict of options.conflicts ?? []) {
    validateNoDuplicateNames(conflict, 'Command option \'conflicts\'');
    for (const name of conflict) {
      validateArgumentReference(names, name, 'Command option \'conflicts\'');
    }
  }
  if (options.exclusive !== undefined) {
    validateNoDuplicateNames(options.exclusive, 'Command option \'exclusive\'');
    for (const name of options.exclusive) {
      validateArgumentReference(names, name, 'Command option \'exclusive\'');
    }
  }
  for (const group of options.groups ?? []) {
    validateNoDuplicateNames(group.members, `Argument group '${group.name}'`);
    for (const member of group.members) {
      validateArgumentReference(names, member, `Argument group '${group.name}'`);
    }
    for (const target of group.requires ?? []) {
      validateArgumentReference(
        names,
        target,
        `Argument group '${group.name}' requirements`,
      );
    }
    for (const target of group.conflicts ?? []) {
      validateArgumentReference(
        names,
        target,
        `Argument group '${group.name}' conflicts`,
      );
    }
  }
}
