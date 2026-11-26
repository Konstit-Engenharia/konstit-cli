import {
  validateValueParser,
  type ValueParser,
} from '../parser/index.js';
import { validateDeprecatedAliases } from '../result/deprecation.js';
import type {
  ArgumentCardinality,
  ArgumentKind,
  ArgumentOptions,
  NamedArgumentOptions,
  RuntimeValueOptions,
  ValueArgumentKind,
} from './options.js';
import type {
  ArgumentDefinition,
  ArgumentType,
} from './types.js';

/** Runtime actions follow clap's ArgAction names while using JS-style values. */
export const ArgumentAction = Object.freeze(
  {
    /** Stores a parsed value. */
    Set: 'set',
    /** Appends parsed values across occurrences. */
    Append: 'append',
    /** Sets a flag to true when supplied. */
    SetTrue: 'setTrue',
    /** Sets a flag to false when supplied. */
    SetFalse: 'setFalse',
    /** Counts occurrences. */
    Count: 'count',
    /** Displays help for the command. */
    Help: 'help',
    /** Displays abbreviated help. */
    HelpShort: 'helpShort',
    /** Displays full help. */
    HelpLong: 'helpLong',
    /** Displays the command version. */
    Version: 'version',
  } as const,
);

/** The parser action associated with an argument. */
export type ArgumentAction = (typeof ArgumentAction)[keyof typeof ArgumentAction];

export function copyDefinition(
  definition: ArgumentDefinition,
  patch: Partial<ArgumentDefinition>,
): ArgumentDefinition {
  const merged = { ...definition, ...patch };
  return Object.freeze({
    ...merged,
    aliases: Object.freeze([...merged.aliases]),
  });
}

const argumentDefinitions = new WeakMap<object, ArgumentDefinition>();

export function configuredArgument<
  const Name extends string,
  Value,
  Output,
  const Kind extends ArgumentKind,
  const Cardinality extends ArgumentCardinality = 'one',
  const Global extends boolean = false,
>(
  definition: ArgumentDefinition,
): ArgumentType<Name, Value, Output, Kind, Cardinality, Global> {
  const argument = Object.freeze({}) as ArgumentType<
    Name,
    Value,
    Output,
    Kind,
    Cardinality,
    Global
  >;
  argumentDefinitions.set(argument, definition);
  return argument;
}

/** Gets the runtime definition for internal parser and completion code. */
export function getArgumentDefinition(argument: ArgumentType): ArgumentDefinition {
  const definition = argumentDefinitions.get(argument);
  if (definition === undefined) {
    throw new TypeError(
      'Expected an argument created by option(), positional(), flag(), colorFlag(), or count()',
    );
  }
  return definition;
}

export function collectsArgumentValues(argument: ArgumentDefinition | undefined): boolean {
  return argument !== undefined
    && (argument.kind === 'option' || argument.kind === 'positional')
    && (argument.repeatable || argument.maxValues !== 1);
}

function validateName(name: string): void {
  if (typeof name !== 'string') {
    throw new TypeError('An argument name must be a string');
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new TypeError(`Invalid argument name: ${JSON.stringify(name)}`);
  }
}

function validateLongName(name: string): void {
  validateName(name);
}

function validateValueCount(minimum: number, maximum: number | undefined): void {
  if (!Number.isSafeInteger(minimum) || minimum < 0) {
    throw new RangeError('The minimum value count must be a non-negative integer');
  }
  if (
    maximum !== undefined
    && (!Number.isSafeInteger(maximum) || maximum < minimum)
  ) {
    throw new RangeError('The maximum value count must be an integer at least equal to min');
  }
}

export function baseDefinition(
  name: string,
  kind: ArgumentKind,
  parser?: ValueParser<unknown>,
): ArgumentDefinition {
  validateName(name);
  if (kind === 'option' || kind === 'positional') {
    validateValueParser(parser);
  }
  const long = kind === 'positional' ? undefined : name.replaceAll('_', '-');
  return Object.freeze({
    name,
    kind,
    color: false,
    action: kind === 'flag'
      ? ArgumentAction.SetTrue
      : kind === 'count'
      ? ArgumentAction.Count
      : ArgumentAction.Set,
    ...(parser === undefined ? {} : { parser }),
    ...(long === undefined ? {} : { long }),
    aliases: Object.freeze([]),
    presence: kind === 'flag' || kind === 'count' ? 'default' : 'optional',
    ...(kind === 'flag' ? { defaultValue: false } : {}),
    ...(kind === 'count' ? { defaultValue: 0 } : {}),
    hasDefaultMissingValue: false,
    repeatable: false,
    minValues: kind === 'flag' || kind === 'count' ? 0 : 1,
    maxValues: kind === 'flag' || kind === 'count' ? 0 : 1,
    requireEquals: false,
    allowHyphenValues: false,
    allowNegativeNumbers: false,
    trailingVarArg: false,
    global: false,
    hidden: false,
    sensitive: false,
  });
}

function applyArgumentOptions(
  definition: ArgumentDefinition,
  options: ArgumentOptions,
): ArgumentDefinition {
  let configured = definition;
  if (options.deprecated !== undefined) {
    configured = copyDefinition(configured, { deprecated: options.deprecated });
  }
  if (options.describe !== undefined) {
    configured = copyDefinition(configured, { help: options.describe });
  }
  if (options.helpHeading !== undefined) {
    configured = copyDefinition(configured, { helpHeading: options.helpHeading });
  }
  if (options.env !== undefined) {
    if (options.env.length === 0) {
      throw new TypeError('An environment variable name cannot be empty');
    }
    configured = copyDefinition(configured, { env: options.env });
  }
  if (options.hide !== undefined) {
    configured = copyDefinition(configured, { hidden: options.hide });
  }
  if (options.sensitive !== undefined) {
    configured = copyDefinition(configured, { sensitive: options.sensitive });
  }
  return configured;
}

export function applyNamedArgumentOptions(
  definition: ArgumentDefinition,
  options: NamedArgumentOptions,
): ArgumentDefinition {
  let configured = applyArgumentOptions(definition, options);
  if (options.short !== undefined) {
    configured = copyDefinition(configured, { short: options.short });
  }
  if (options.long !== undefined) {
    validateLongName(options.long);
    configured = copyDefinition(configured, { long: options.long });
  }
  for (const alias of options.aliases ?? []) {
    validateLongName(alias);
    configured = copyDefinition(configured, {
      aliases: [...configured.aliases, alias],
    });
  }
  if (options.deprecatedAliases !== undefined) {
    configured = copyDefinition(configured, {
      deprecatedAliases: Object.freeze({ ...options.deprecatedAliases }),
    });
  }
  return options.global === true
    ? copyDefinition(configured, { global: true })
    : configured;
}

export function validateConfiguredValueOptions(
  kind: ValueArgumentKind,
  options: RuntimeValueOptions<unknown>,
): void {
  validateArgumentOptionKeys(kind, options);
  const hasDefault = Object.hasOwn(options, 'default');
  const hasDefaultValues = Object.hasOwn(options, 'defaultValues');
  const hasDefaultMissing = Object.hasOwn(options, 'defaultMissing');
  const hasNumArgs = Object.hasOwn(options, 'numArgs');
  const required = options.required === true || options.required === 'without-subcommand';

  if (options.unique === true && options.repeatable !== true) {
    throw new TypeError('unique requires a repeatable option');
  }
  if (options.literal === true && options.trailingVarArg !== true) {
    throw new TypeError('literal requires a trailing positional');
  }
  if (options.joinWith !== undefined && options.literal !== true) {
    throw new TypeError('joinWith requires a literal trailing positional');
  }
  if (options.output === 'scalar' && options.joinWith === undefined) {
    throw new TypeError('Scalar output requires joinWith');
  }
  if (hasDefaultValues) {
    if (!Array.isArray(options.defaultValues)) {
      throw new TypeError('Argument defaultValues must be an array');
    }
    for (let index = 0; index < options.defaultValues.length; index += 1) {
      if (!Object.hasOwn(options.defaultValues, index)) {
        throw new TypeError('Argument defaultValues cannot contain sparse entries');
      }
    }
    if (hasDefault) {
      throw new TypeError('An argument cannot configure both default and defaultValues');
    }
    if (required) {
      throw new TypeError('An argument cannot be required and have default values');
    }
    const numArgsCollectsValues = options.numArgs === undefined
      ? false
      : typeof options.numArgs === 'number'
      ? options.numArgs !== 1
      : options.numArgs.max !== 1;
    const collectsValues = options.repeatable === true
      || (options.trailingVarArg === true && options.output !== 'scalar')
      || numArgsCollectsValues;
    if (!collectsValues) {
      throw new TypeError('defaultValues requires a collection argument');
    }
    const minimum = options.numArgs === undefined
      ? 0
      : typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.min;
    const maximum = options.numArgs === undefined
      ? undefined
      : typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.max;
    const count = options.defaultValues.length;
    if (options.repeatable) {
      if (
        count > 0
        && maximum === undefined
        && count < minimum
      ) {
        throw new TypeError('Argument defaultValues does not contain a complete occurrence');
      }
      if (
        count > 0
        && maximum !== undefined
        && minimum > 0
        && Math.ceil(count / maximum) > Math.floor(count / minimum)
      ) {
        throw new TypeError('Argument defaultValues does not contain complete occurrences');
      }
    } else if (
      count < minimum
      || (maximum !== undefined && count > maximum)
    ) {
      throw new TypeError('Argument defaultValues does not satisfy its value count');
    }
  }

  if (kind === 'option' && Object.hasOwn(options, 'trailingVarArg')) {
    throw new TypeError('Options cannot be trailing positional arguments');
  }
  if (kind === 'positional') {
    if (Object.hasOwn(options, 'global')) {
      throw new TypeError('Positional arguments cannot be global');
    }
    if (hasDefaultMissing) {
      throw new TypeError('Positional arguments cannot configure defaultMissing');
    }
    if (Object.hasOwn(options, 'requireEquals')) {
      throw new TypeError('Positional arguments cannot require equals-form values');
    }
  }
  if (hasDefault && required) {
    throw new TypeError('An argument configuration cannot be required and have a default');
  }
  if (hasDefault && options.repeatable === true) {
    throw new TypeError('A repeatable argument cannot have a scalar default');
  }
  if (hasDefault && options.trailingVarArg === true && options.output !== 'scalar') {
    throw new TypeError('A trailing argument cannot have a scalar default');
  }
  if (hasDefault && options.numArgs !== undefined) {
    const maximum = typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.max;
    const message = 'A multi-value argument cannot have a scalar default';
    if (maximum !== 1) {
      throw new TypeError(message);
    }
  }
  if (hasDefaultMissing && hasNumArgs) {
    throw new TypeError('defaultMissing cannot be combined with numArgs');
  }
  if (options.trailingVarArg === true) {
    if (options.repeatable === true) {
      throw new TypeError('A trailing argument cannot be repeatable');
    }
    if (hasNumArgs) {
      throw new TypeError('A trailing argument cannot configure numArgs');
    }
    if (options.allowHyphenValues === false) {
      throw new TypeError('A trailing argument must allow hyphen values');
    }
  }
}

export function validateArgumentOptionKeys(
  kind: ArgumentKind,
  options: unknown,
): void {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(`${kind} argument configuration must be an object`);
  }
  const allowed = [
    'deprecated',
    'describe',
    'helpHeading',
    'env',
    'hide',
    'sensitive',
    ...(kind === 'positional' ? [] : ['global', 'short', 'long', 'aliases', 'deprecatedAliases']),
    ...(kind === 'option' || kind === 'positional'
      ? [
        'valueName',
        'valueHint',
        'complete',
        'required',
        'default',
        'defaultValues',
        'repeatable',
        'numArgs',
        'valueDelimiter',
        'valueTerminator',
        'allowHyphenValues',
        'allowNegativeNumbers',
      ]
      : []),
    ...(kind === 'option' ? ['defaultMissing', 'requireEquals', 'unique'] : []),
    ...(kind === 'positional' ? ['trailingVarArg', 'literal', 'joinWith', 'output'] : []),
    ...(kind === 'flag' ? ['negated'] : []),
  ];
  const deferredUnsupported = kind === 'option'
    ? ['trailingVarArg']
    : kind === 'positional'
    ? ['global', 'defaultMissing', 'requireEquals']
    : [];
  const unsupported = Object.keys(options).find(
    (key) => !allowed.includes(key) && !deferredUnsupported.includes(key),
  );
  if (unsupported !== undefined) {
    throw new TypeError(`${kind} arguments cannot configure ${unsupported}`);
  }

  const configured = options as Record<string, unknown>;
  for (
    const key of [
      'deprecated',
      'describe',
      'helpHeading',
      'env',
      'long',
      'valueName',
      'valueDelimiter',
      'valueTerminator',
      'joinWith',
    ]
  ) {
    if (configured[key] !== undefined && typeof configured[key] !== 'string') {
      throw new TypeError(`${kind} argument option '${key}' must be a string`);
    }
  }
  if (configured.helpHeading === '') {
    throw new TypeError(`${kind} argument option 'helpHeading' cannot be empty`);
  }
  if (configured.output !== undefined && configured.output !== 'scalar') {
    throw new TypeError(`${kind} argument option 'output' must be 'scalar'`);
  }
  if (
    configured.required !== undefined
    && typeof configured.required !== 'boolean'
    && configured.required !== 'without-subcommand'
  ) {
    throw new TypeError(`${kind} argument option 'required' must be a boolean or 'without-subcommand'`);
  }
  if (typeof configured.helpHeading === 'string' && /[\r\n]/u.test(configured.helpHeading)) {
    throw new TypeError(`${kind} argument option 'helpHeading' cannot contain line breaks`);
  }
  for (
    const key of [
      'hide',
      'sensitive',
      'global',
      'repeatable',
      'unique',
      'requireEquals',
      'allowHyphenValues',
      'allowNegativeNumbers',
      'trailingVarArg',
      'literal',
      'negated',
    ]
  ) {
    if (configured[key] !== undefined && typeof configured[key] !== 'boolean') {
      throw new TypeError(`${kind} argument option '${key}' must be a boolean`);
    }
  }
  if (configured.short !== undefined) {
    if (typeof configured.short !== 'string') {
      throw new TypeError(`${kind} argument option 'short' must be a string`);
    }
    if (configured.short.length !== 1 || configured.short === '-') {
      throw new TypeError('A short option must be one UTF-16 character other than \'-\'');
    }
  }
  if (configured.aliases !== undefined) {
    if (
      !Array.isArray(configured.aliases)
      || configured.aliases.some((alias) => typeof alias !== 'string')
    ) {
      throw new TypeError(`${kind} argument option 'aliases' must be an array of strings`);
    }
  }
  validateDeprecatedAliases(
    configured.deprecatedAliases,
    (configured.aliases ?? []) as readonly string[],
  );
  if (
    configured.valueHint !== undefined
    && configured.valueHint !== 'file'
    && configured.valueHint !== 'directory'
  ) {
    throw new TypeError(
      `${kind} argument option 'valueHint' must be 'file' or 'directory'`,
    );
  }
  if (configured.complete !== undefined && typeof configured.complete !== 'function') {
    throw new TypeError(`${kind} argument option 'complete' must be a function`);
  }
  if (configured.numArgs !== undefined) {
    if (typeof configured.numArgs === 'number') {
      validateValueCount(configured.numArgs, configured.numArgs);
    } else {
      const range = configured.numArgs;
      if (range === null || typeof range !== 'object' || Array.isArray(range)) {
        throw new TypeError(
          `${kind} argument option 'numArgs' must be a number or range object`,
        );
      }
      const unsupportedRangeKey = Object.keys(range).find(
        (key) => key !== 'min' && key !== 'max',
      );
      if (unsupportedRangeKey !== undefined) {
        throw new TypeError(
          `${kind} argument option 'numArgs' contains unsupported field '${unsupportedRangeKey}'`,
        );
      }
      if (!('min' in range) || typeof range.min !== 'number') {
        throw new TypeError(`${kind} argument option 'numArgs.min' must be a number`);
      }
      const maximum = 'max' in range ? range.max : undefined;
      if (maximum !== undefined && typeof maximum !== 'number') {
        throw new TypeError(`${kind} argument option 'numArgs.max' must be a number`);
      }
      validateValueCount(range.min, maximum as number | undefined);
    }
  }
}

export function applyValueArgumentOptions(
  definition: ArgumentDefinition,
  options: RuntimeValueOptions<unknown>,
): ArgumentDefinition {
  validateConfiguredValueOptions(
    definition.kind as ValueArgumentKind,
    options,
  );

  let configured = applyArgumentOptions(definition, options);
  if (options.valueName !== undefined) {
    configured = copyDefinition(configured, { valueName: options.valueName });
  }
  if (options.valueHint !== undefined) {
    configured = copyDefinition(configured, {
      completionHint: options.valueHint,
    });
  }
  if (options.complete !== undefined) {
    configured = copyDefinition(configured, { completion: options.complete });
  }

  const hasDefault = Object.hasOwn(options, 'default');
  const hasDefaultValues = Object.hasOwn(options, 'defaultValues');
  if (hasDefault) {
    configured = copyDefinition(configured, {
      presence: 'default',
      defaultValue: options.default,
    });
  }
  if (hasDefaultValues) {
    configured = copyDefinition(configured, {
      presence: 'default',
      defaultValues: Object.freeze([...(options.defaultValues ?? [])]),
    });
  }
  if (Object.hasOwn(options, 'defaultMissing')) {
    configured = copyDefinition(configured, {
      minValues: 0,
      maxValues: 1,
      defaultMissingValue: options.defaultMissing,
      hasDefaultMissingValue: true,
      requireEquals: true,
    });
  }
  if (options.numArgs !== undefined) {
    const minimum = typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.min;
    const maximum = typeof options.numArgs === 'number'
      ? options.numArgs
      : options.numArgs.max;
    validateValueCount(minimum, maximum);
    configured = copyDefinition(configured, {
      minValues: minimum,
      maxValues: maximum ?? null,
    });
  }
  if (options.required === true) {
    configured = copyDefinition(configured, { presence: 'required' });
  }
  if (options.required === 'without-subcommand') {
    if (configured.global) {
      throw new TypeError('An argument required without a subcommand cannot be global');
    }
    configured = copyDefinition(configured, { presence: 'without-subcommand' });
  }
  if (options.repeatable === true) {
    configured = copyDefinition(configured, {
      action: ArgumentAction.Append,
      repeatable: true,
      ...(options.unique === true ? { unique: true } : {}),
      defaultValue: undefined,
    });
  }
  if (options.valueDelimiter !== undefined) {
    if (Array.from(options.valueDelimiter).length !== 1) {
      throw new TypeError('A value delimiter must be one character');
    }
    configured = copyDefinition(configured, {
      valueDelimiter: options.valueDelimiter,
    });
  }
  if (options.valueTerminator !== undefined) {
    if (options.valueTerminator.length === 0) {
      throw new TypeError('A value terminator cannot be empty');
    }
    if (options.literal !== true) {
      configured = copyDefinition(configured, {
        valueTerminator: options.valueTerminator,
      });
    }
  }
  if (options.requireEquals !== undefined) {
    configured = copyDefinition(configured, {
      requireEquals: options.requireEquals,
    });
  }
  if (options.allowHyphenValues !== undefined) {
    configured = copyDefinition(configured, {
      allowHyphenValues: options.allowHyphenValues,
    });
  }
  if (options.allowNegativeNumbers !== undefined) {
    configured = copyDefinition(configured, {
      allowNegativeNumbers: options.allowNegativeNumbers,
    });
  }
  if (options.trailingVarArg === true) {
    configured = copyDefinition(configured, {
      minValues: configured.presence === 'required' || configured.presence === 'without-subcommand' ? 1 : 0,
      maxValues: options.output === 'scalar' ? 1 : null,
      trailingVarArg: true,
      ...(options.literal === true ? { literal: true } : {}),
      ...(options.joinWith === undefined ? {} : { joinWith: options.joinWith }),
      ...(options.output === undefined ? {} : { output: options.output }),
      allowHyphenValues: true,
    });
  }
  return configured;
}
