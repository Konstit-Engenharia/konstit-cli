/** A warning collected while parsing a deprecated command, argument, or alias. */
export interface DeprecationWarning {
  readonly kind: 'deprecated';
  readonly target: 'command' | 'argument' | 'alias';
  readonly name: string;
  readonly message: string;
  readonly commandPath: readonly string[];
  readonly argumentName?: string;
}

const warningsByResult = new WeakMap<object, readonly DeprecationWarning[]>();
const noWarnings: readonly DeprecationWarning[] = Object.freeze([]);

/** Reads warnings without writing output. Results from parse() and tryParse() are supported. */
export function getWarnings(result: object): readonly DeprecationWarning[] {
  return warningsByResult.get(result) ?? noWarnings;
}

/** Attaches an immutable warning snapshot to a parse result or error. */
export function setWarnings(result: object, warnings: readonly DeprecationWarning[]): void {
  warningsByResult.set(result, Object.freeze([...warnings]));
}

/** Collects each deprecated spelling once per command path and argument. */
export function collectDeprecation(
  warnings: DeprecationWarning[],
  target: DeprecationWarning['target'],
  name: string,
  message: string | undefined,
  commandPath: readonly string[],
  argumentName?: string,
): void {
  if (message === undefined) {
    return;
  }
  if (
    warnings.some((warning) =>
      warning.target === target && warning.name === name && warning.argumentName === argumentName
      && warning.commandPath.length === commandPath.length
      && warning.commandPath.every((part, index) => part === commandPath[index])
    )
  ) {
    return;
  }
  warnings.push(Object.freeze({
    kind: 'deprecated',
    target,
    name,
    message,
    commandPath: Object.freeze([...commandPath]),
    ...(argumentName === undefined ? {} : { argumentName }),
  }));
}

/** Validates messages against aliases already registered on a definition. */
export function validateDeprecatedAliases(value: unknown, aliases: readonly string[]): void {
  if (value === undefined) {
    return;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('deprecatedAliases must be an object mapping declared aliases to messages');
  }
  for (const [name, message,] of Object.entries(value)) {
    if (!aliases.includes(name)) {
      throw new TypeError(`Deprecated alias '${name}' must be a declared alias`);
    }
    if (typeof message !== 'string') {
      throw new TypeError(`Deprecation message for alias '${name}' must be a string`);
    }
  }
}
