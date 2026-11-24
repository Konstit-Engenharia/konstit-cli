import { validateDeprecatedAliases } from '../../result/deprecation.js';
import {
  validateArray,
  validateClosedObject,
} from './shape.js';

const commandOptionKeys = new Set([
  'deprecated',
  'deprecatedAliases',
  'version',
  'about',
  'longAbout',
  'author',
  'beforeHelp',
  'afterHelp',
  'examples',
  'overrideUsage',
  'overrideHelp',
  'aliases',
  'visibleAliases',
  'args',
  'subcommands',
  'inferSubcommands',
  'subcommandRequired',
  'argsConflictWithSubcommands',
  'argsOverrideSelf',
  'defaultToHelp',
  'disableHelpSubcommand',
  'disableHelpFlag',
  'disableVersionFlag',
  'hideStandardFlagsInSubcommandHelp',
  'hide',
  'requires',
  'requiresIf',
  'requiresValue',
  'requiredIfAny',
  'requiredIfAll',
  'requiredUnlessPresent',
  'requiredUnlessAll',
  'defaultIf',
  'overrides',
  'conflicts',
  'exclusive',
  'groups',
  'validate',
  'handler',
]);

const commandStringOptionKeys = [
  'deprecated',
  'version',
  'about',
  'longAbout',
  'author',
  'beforeHelp',
  'afterHelp',
  'overrideUsage',
  'overrideHelp',
] as const;

const commandBooleanOptionKeys = [
  'inferSubcommands',
  'subcommandRequired',
  'argsConflictWithSubcommands',
  'argsOverrideSelf',
  'defaultToHelp',
  'disableHelpSubcommand',
  'disableHelpFlag',
  'disableVersionFlag',
  'hideStandardFlagsInSubcommandHelp',
  'hide',
] as const;

const conditionalSetKeys = new Set(['conditions', 'target']);
const commandExampleKeys = new Set(['command', 'args', 'description']);
const requiredUnlessKeys = new Set(['alternatives', 'target']);
const commandGroupKeys = new Set([
  'name',
  'members',
  'required',
  'multiple',
  'requires',
  'conflicts',
]);

function validateOptionalString(
  options: Record<string, unknown>,
  key: string,
): void {
  const value = options[key];
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`Command option '${key}' must be a string`);
  }
}

function validateOptionalBoolean(
  options: Record<string, unknown>,
  key: string,
): void {
  const value = options[key];
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`Command option '${key}' must be a boolean`);
  }
}

function validateStringArray(
  value: unknown,
  context: string,
  minimum = 0,
): readonly string[] {
  const values = validateArray(value, context);
  if (values.length < minimum) {
    throw new TypeError(`${context} must contain at least ${minimum} value(s)`);
  }
  if (values.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${context} must contain only argument names`);
  }
  return values as readonly string[];
}

function validateTuple(
  value: unknown,
  length: number,
  context: string,
): readonly unknown[] {
  const tuple = validateArray(value, context);
  if (tuple.length !== length) {
    throw new TypeError(`${context} must contain exactly ${length} values`);
  }
  return tuple;
}

function validateBinaryRelations(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    const tuple = validateTuple(relation, 2, `${context} entry`);
    if (typeof tuple[0] !== 'string' || typeof tuple[1] !== 'string') {
      throw new TypeError(`${context} entries must contain argument names`);
    }
  }
}

function validateConditionalRelations(value: unknown, context: string, targetIndex: 1 | 2): void {
  for (const relation of validateArray(value, context)) {
    const tuple = validateTuple(relation, 3, `${context} entry`);
    if (typeof tuple[0] !== 'string' || typeof tuple[targetIndex] !== 'string') {
      throw new TypeError(`${context} entries must contain argument names`);
    }
  }
}

function validateConditions(value: unknown, context: string): void {
  const conditions = validateArray(value, context);
  if (conditions.length === 0) {
    throw new TypeError(`${context} must contain a condition`);
  }
  for (const condition of conditions) {
    const tuple = validateTuple(condition, 2, `${context} entry`);
    if (typeof tuple[0] !== 'string') {
      throw new TypeError(`${context} entries must start with an argument name`);
    }
  }
}

function validateConditionalSets(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    validateClosedObject(relation, conditionalSetKeys, `${context} entry`);
    validateConditions(relation.conditions, `${context} conditions`);
    if (typeof relation.target !== 'string') {
      throw new TypeError(`${context} target must be an argument name`);
    }
  }
}

function validateRequiredUnless(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    validateClosedObject(relation, requiredUnlessKeys, `${context} entry`);
    validateStringArray(
      relation.alternatives,
      `${context} alternatives`,
      1,
    );
    if (typeof relation.target !== 'string') {
      throw new TypeError(`${context} target must be an argument name`);
    }
  }
}

function validateConflictSets(value: unknown): void {
  for (const conflict of validateArray(value, 'Command option \'conflicts\'')) {
    validateStringArray(conflict, 'Command option \'conflicts\' entry', 2);
  }
}

function validateGroups(value: unknown): void {
  for (const group of validateArray(value, 'Command option \'groups\'')) {
    validateClosedObject(group, commandGroupKeys, 'Command group');
    if (typeof group.name !== 'string') {
      throw new TypeError('Command group name must be a string');
    }
    validateStringArray(group.members, `Argument group '${group.name}' members`, 1);
    if (group.required !== undefined && typeof group.required !== 'boolean') {
      throw new TypeError(`Argument group '${group.name}' required must be a boolean`);
    }
    if (group.multiple !== undefined && typeof group.multiple !== 'boolean') {
      throw new TypeError(`Argument group '${group.name}' multiple must be a boolean`);
    }
    if (group.requires !== undefined) {
      validateStringArray(group.requires, `Argument group '${group.name}' requirements`);
    }
    if (group.conflicts !== undefined) {
      validateStringArray(group.conflicts, `Argument group '${group.name}' conflicts`);
    }
  }
}

export function validateCommandOptions(options: unknown): void {
  validateClosedObject(options, commandOptionKeys, 'Command configuration');
  for (const key of commandStringOptionKeys) {
    validateOptionalString(options, key);
  }
  for (const key of commandBooleanOptionKeys) {
    validateOptionalBoolean(options, key);
  }
  for (const key of ['aliases', 'visibleAliases'] as const) {
    if (options[key] !== undefined) {
      validateStringArray(options[key], `Command option '${key}'`);
    }
  }
  validateDeprecatedAliases(options.deprecatedAliases, [
    ...((options.aliases ?? []) as readonly string[]),
    ...((options.visibleAliases ?? []) as readonly string[]),
  ]);
  for (const key of ['args', 'subcommands'] as const) {
    if (options[key] !== undefined) {
      validateArray(options[key], `Command option '${key}'`);
    }
  }
  if (options.examples !== undefined) {
    for (const example of validateArray(options.examples, 'Command option \'examples\'')) {
      validateClosedObject(example, commandExampleKeys, 'Command example');
      const { command, args, description } = example;
      const hasCommand = typeof command === 'string' && args === undefined;
      const hasArgs = args !== null && typeof args === 'object' && !Array.isArray(args) && command === undefined;
      if (!hasCommand && !hasArgs) {
        throw new TypeError('A command example requires exactly one of command (string) or args (object)');
      }
      if (description !== undefined && typeof description !== 'string') {
        throw new TypeError('A command example description must be a string');
      }
    }
  }
  if (
    options.subcommandRequired === true
    && (options.subcommands === undefined
      || (options.subcommands as readonly unknown[]).length === 0)
  ) {
    throw new TypeError(
      'A command with subcommandRequired enabled must define at least one subcommand',
    );
  }
  if (options.requires !== undefined) {
    validateBinaryRelations(options.requires, 'Command option \'requires\'');
  }
  if (options.requiresIf !== undefined) {
    validateConditionalRelations(options.requiresIf, 'Command option \'requiresIf\'', 2);
  }
  if (options.requiresValue !== undefined) {
    validateConditionalRelations(options.requiresValue, 'Command option \'requiresValue\'', 1);
  }
  if (options.requiredIfAny !== undefined) {
    validateConditionalSets(options.requiredIfAny, 'Command option \'requiredIfAny\'');
  }
  if (options.requiredIfAll !== undefined) {
    validateConditionalSets(options.requiredIfAll, 'Command option \'requiredIfAll\'');
  }
  if (options.requiredUnlessPresent !== undefined) {
    validateRequiredUnless(
      options.requiredUnlessPresent,
      'Command option \'requiredUnlessPresent\'',
    );
  }
  if (options.requiredUnlessAll !== undefined) {
    validateRequiredUnless(
      options.requiredUnlessAll,
      'Command option \'requiredUnlessAll\'',
    );
  }
  if (options.defaultIf !== undefined) {
    validateArray(options.defaultIf, 'Command option \'defaultIf\'');
  }
  if (options.overrides !== undefined) {
    validateBinaryRelations(options.overrides, 'Command option \'overrides\'');
  }
  if (options.conflicts !== undefined) {
    validateConflictSets(options.conflicts);
  }
  if (options.exclusive !== undefined) {
    validateStringArray(options.exclusive, 'Command option \'exclusive\'', 1);
  }
  if (options.groups !== undefined) {
    validateGroups(options.groups);
  }
  for (const key of ['validate', 'handler'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw new TypeError(`Command option '${key}' must be a function`);
    }
  }
}
