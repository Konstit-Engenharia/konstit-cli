import {
  getArgumentDefinition,
  type AnyArgument,
} from './argument.js';

/** The source that supplied an argument's final parsed value. */
export type ValueSource = 'cli' | 'env' | 'config' | 'default';

export type TrackedValueSource = ValueSource | { readonly file: string; };

const sourcesByValue = new WeakMap<object, ReadonlyMap<string, TrackedValueSource>>();

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
  const source = lookupSource(parsedValue, argumentName);
  return typeof source === 'object' ? 'config' : source;
}

/** Gets the file that supplied a named value through `loadConfig()` or `loadConfigs()`. */
export function getConfigValueFile<Values extends object>(
  parsedValue: Values,
  argumentName: ParsedArgumentName<Values>,
): string | undefined;
/** Gets the source file by argument declaration, including for inherited globals. */
export function getConfigValueFile(parsedValue: object, argument: AnyArgument): string | undefined;
export function getConfigValueFile<Values extends object>(
  parsedValue: Values,
  argumentName: ParsedArgumentName<Values> | AnyArgument,
): string | undefined {
  const source = lookupSource(parsedValue, argumentName);
  return typeof source === 'object' ? source.file : undefined;
}

function lookupSource(
  parsedValue: object,
  argumentName: string | AnyArgument,
): TrackedValueSource | undefined {
  const name = typeof argumentName === 'string'
    ? argumentName
    : getArgumentDefinition(argumentName).name;
  return sourcesByValue.get(parsedValue)?.get(name);
}

export function setValueSources(
  parsedValue: object,
  sources: ReadonlyMap<string, TrackedValueSource>,
): void {
  sourcesByValue.set(parsedValue, new Map(sources));
}

export function updateValueSource(
  parsedValue: object,
  argumentName: string,
  source: TrackedValueSource | undefined,
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
