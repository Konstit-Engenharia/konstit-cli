import type { Environment } from './environment.js';

/** Values accepted by caller supplied command configuration. */
export type ConfigValue = string | readonly string[] | boolean | number;

interface CommandConfigNode {
  /** Values keyed by the argument's configured name. */
  readonly values?: Readonly<Record<string, ConfigValue>>;
  /** Configuration for child commands, keyed by their canonical name. */
  readonly subcommands?: Readonly<Record<string, CommandConfigNode>>;
}

/** Configuration for a command tree. */
export interface CommandConfig extends CommandConfigNode {
  /** Associates the config with a JSON Schema for editors and validators. */
  readonly $schema?: string;
}

/** Options that affect parsing without changing the command definition. */
export interface ParseOptions {
  /** Caller supplied values used below CLI and environment values. */
  readonly config?: CommandConfig;
  /** Environment variables for this invocation. Defaults to Bun.env. */
  readonly env?: Environment;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateConfigValue(value: unknown, path: readonly string[]): void {
  if (typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) {
      return;
    }
    throw new TypeError(
      `Invalid config value at '${path.join('.')}' (numbers must be nonnegative safe integers)`,
    );
  }
  if (
    Array.isArray(value)
    && value.every((item) => typeof item === 'string')
  ) {
    return;
  }
  throw new TypeError(
    `Invalid config value at '${path.join('.')}' (expected a string, string array, boolean, or nonnegative integer)`,
  );
}

/** Validates the structural part of a config tree before parsing starts. */
export function validateConfigShape(
  value: unknown,
  path: readonly string[] = ['config'],
): asserts value is CommandConfig | undefined {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new TypeError(`Config at '${path.join('.')}' must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (key !== '$schema' && key !== 'values' && key !== 'subcommands') {
      throw new TypeError(`Unknown config field '${[...path, key].join('.')}'`);
    }
  }
  if (Object.hasOwn(value, '$schema')) {
    const schemaPath = `${path.join('.')}.$schema`;
    if (path.length !== 1) {
      throw new TypeError(`Unknown config field '${schemaPath}'`);
    }
    if (typeof value.$schema !== 'string') {
      throw new TypeError(`Config field '${schemaPath}' must be a string`);
    }
  }
  if (Object.hasOwn(value, 'values')) {
    const values = value.values;
    if (!isRecord(values)) {
      throw new TypeError(`Config values at '${[...path, 'values'].join('.')}' must be an object`);
    }
    for (const [name, configValue,] of Object.entries(values)) {
      validateConfigValue(configValue, [...path, 'values', name]);
    }
  }
  if (Object.hasOwn(value, 'subcommands')) {
    const subcommands = value.subcommands;
    if (!isRecord(subcommands)) {
      throw new TypeError(`Config subcommands at '${[...path, 'subcommands'].join('.')}' must be an object`);
    }
    for (const [name, child,] of Object.entries(subcommands)) {
      validateConfigShape(child, [...path, 'subcommands', name]);
    }
  }
}
