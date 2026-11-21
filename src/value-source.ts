import {
  getArgumentDefinition,
  type AnyArgument,
} from './argument.js';

/** The source that supplied an argument's final parsed value. */
export type ValueSource = 'cli' | 'env' | 'config' | 'default';

const sourcesByValue = new WeakMap<object, ReadonlyMap<string, ValueSource>>();

/** The string keys available on a parsed value object. */
type ParsedArgumentName<Values extends object> = Extract<keyof Values, string>;

/** Looks up the source of a named argument on the `value` of a successful parse. */
export function getValueSource<Values extends object>(
  parsedValue: Values,
  argumentName: ParsedArgumentName<Values>,
): ValueSource | undefined;
/** Looks up the source of a parsed value using the configured argument's name. */
export function getValueSource(
  parsedValue: object,
  argument: AnyArgument,
): ValueSource | undefined;
export function getValueSource<Values extends object>(
  parsedValue: Values,
  argumentName: ParsedArgumentName<Values> | AnyArgument,
): ValueSource | undefined {
  const name = typeof argumentName === 'string'
    ? argumentName
    : getArgumentDefinition(argumentName).name;
  return sourcesByValue.get(parsedValue)?.get(name);
}

export function setValueSources(
  parsedValue: object,
  sources: ReadonlyMap<string, ValueSource>,
): void {
  sourcesByValue.set(parsedValue, new Map(sources));
}

export function updateValueSource(
  parsedValue: object,
  argumentName: string,
  source: ValueSource | undefined,
): void {
  const current = sourcesByValue.get(parsedValue);
  if (current === undefined) {
    if (source !== undefined) {
      sourcesByValue.set(parsedValue, new Map([[argumentName, source]]));
    }
    return;
  }
  const next = new Map(current);
  if (source === undefined) {
    next.delete(argumentName);
  } else {
    next.set(argumentName, source);
  }
  sourcesByValue.set(parsedValue, next);
}
