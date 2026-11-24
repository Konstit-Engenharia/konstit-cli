import type { ArgumentDefinition } from '../argument/index.js';
import { splitArgumentValue } from '../command/parsing/recognition.js';

/** The normalized value accepted by a flag, count, option, or positional. */
export type PreparedConfigValue =
  | { readonly kind: 'switch'; readonly value: boolean | number; }
  | { readonly kind: 'values'; readonly values: readonly string[]; }
  | {
    readonly kind: 'error';
    readonly reason: 'boolean' | 'count' | 'strings' | 'max' | 'occurrences';
  };

/**
 * Validates and normalizes one raw config value before parser conversion.
 * Minimum arity is checked after conversion because an argument parser may
 * reject an individual raw value first.
 */
export function prepareConfigValue(
  argument: ArgumentDefinition,
  value: unknown,
): PreparedConfigValue {
  if (argument.kind === 'flag') {
    return typeof value === 'boolean'
      ? { kind: 'switch', value }
      : { kind: 'error', reason: 'boolean' };
  }
  if (argument.kind === 'count') {
    return Number.isSafeInteger(value) && (value as number) >= 0
      ? { kind: 'switch', value: value as number }
      : { kind: 'error', reason: 'count' };
  }
  if (
    typeof value !== 'string'
    && !(Array.isArray(value) && value.every((item) => typeof item === 'string'))
  ) {
    return { kind: 'error', reason: 'strings' };
  }
  const rawValues = typeof value === 'string' ? [value] : value;
  const values = rawValues.flatMap((raw) => splitArgumentValue(argument, raw));
  if (
    (!argument.repeatable || argument.maxValues === 0)
    && argument.maxValues !== null
    && values.length > argument.maxValues
  ) {
    return { kind: 'error', reason: 'max' };
  }
  if (
    argument.repeatable
    && argument.minValues > 0
    && argument.maxValues !== null
    && Math.ceil(values.length / argument.maxValues) > Math.floor(values.length / argument.minValues)
  ) {
    return { kind: 'error', reason: 'occurrences' };
  }
  return { kind: 'values', values };
}
