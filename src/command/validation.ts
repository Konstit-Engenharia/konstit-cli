import type { ArgumentDefinition } from '../argument.js';
import { argumentLongNames } from './recognition.js';
import type { CommandDefinition } from './schema.js';

interface RuntimeRequiredUnless {
  readonly alternatives: readonly string[];
  readonly target: string;
}

interface RuntimeGroupRelations {
  readonly name: string;
  readonly members: readonly string[];
  readonly requires?: readonly string[];
  readonly conflicts?: readonly string[];
}

export interface RuntimeCommandRelations {
  readonly requires?: readonly (readonly [string, string])[];
  readonly requiresIf?: readonly (readonly [string, unknown, string])[];
  readonly requiredIfAny?: readonly RuntimeConditionalSetRelation[];
  readonly requiredIfAll?: readonly RuntimeConditionalSetRelation[];
  readonly requiredUnlessPresent?: readonly RuntimeRequiredUnless[];
  readonly requiredUnlessAll?: readonly RuntimeRequiredUnless[];
  readonly overrides?: readonly (readonly [string, string])[];
  readonly conflicts?: readonly (readonly string[])[];
  readonly exclusive?: readonly string[];
  readonly groups?: readonly RuntimeGroupRelations[];
}

const commandOptionKeys = new Set([
  'version',
  'about',
  'longAbout',
  'author',
  'beforeHelp',
  'afterHelp',
  'overrideUsage',
  'overrideHelp',
  'aliases',
  'visibleAliases',
  'args',
  'subcommands',
  'inferSubcommands',
  'subcommandRequired',
  'argsConflictWithSubcommands',
  'defaultToHelp',
  'disableHelpSubcommand',
  'disableHelpFlag',
  'disableVersionFlag',
  'hide',
  'requires',
  'requiresIf',
  'requiredIfAny',
  'requiredIfAll',
  'requiredUnlessPresent',
  'requiredUnlessAll',
  'overrides',
  'conflicts',
  'exclusive',
  'groups',
  'handler',
]);

const commandStringOptionKeys = [
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
  'defaultToHelp',
  'disableHelpSubcommand',
  'disableHelpFlag',
  'disableVersionFlag',
  'hide',
] as const;

const conditionalSetKeys = new Set(['conditions', 'target']);
const requiredUnlessKeys = new Set(['alternatives', 'target']);
const commandGroupKeys = new Set([
  'name',
  'members',
  'required',
  'multiple',
  'requires',
  'conflicts',
]);

function validateClosedObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  context: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const unsupported = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupported !== undefined) {
    throw new TypeError(`${context} contains unsupported field '${unsupported}'`);
  }
}

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

function validateArray(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array`);
  }
  return value;
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

function validateConditionalRelations(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    const tuple = validateTuple(relation, 3, `${context} entry`);
    if (typeof tuple[0] !== 'string' || typeof tuple[2] !== 'string') {
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
  for (const key of ['args', 'subcommands'] as const) {
    if (options[key] !== undefined) {
      validateArray(options[key], `Command option '${key}'`);
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
    validateConditionalRelations(options.requiresIf, 'Command option \'requiresIf\'');
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
  if (options.handler !== undefined && typeof options.handler !== 'function') {
    throw new TypeError('Command option \'handler\' must be a function');
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
  for (const [source, target,] of options.requires ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requires\'');
  }
  for (const [source, , target,] of options.requiresIf ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requiresIf\'');
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
      argument.presence === 'required'
      && positionals.some(({ presence }) => presence !== 'required')
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
