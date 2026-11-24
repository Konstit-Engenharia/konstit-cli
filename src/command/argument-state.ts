import type { ArgumentDefinition } from '../argument.js';
import type { ValueSource } from '../value-source.js';

export type InputSource = Exclude<ValueSource, 'default'>;

interface SuppliedArgument {
  readonly kind: 'supplied';
  readonly input: InputSource;
  readonly source: InputSource;
  readonly valueCount: number;
  readonly tokenIndex: number | undefined;
}

// A missing map entry represents an absent argument. An implicit value can have
// a source without satisfying presence checks, as with defaults and NO_COLOR.
export type ArgumentState =
  | { readonly kind: 'implicit'; readonly source: 'default' | 'env'; }
  | { readonly kind: 'unparsed'; readonly input: 'cli' | 'env'; readonly source?: undefined; }
  | SuppliedArgument;

export interface ArgumentValues {
  readonly values: Record<string, unknown>;
  readonly argumentStates: Map<string, ArgumentState>;
}

export const defaultArgument = { kind: 'implicit', source: 'default' } as const;
export const environmentPolicy = { kind: 'implicit', source: 'env' } as const;

export function restoreArgumentDefault(state: ArgumentValues, argument: ArgumentDefinition): void {
  const { name, defaultValues } = argument;
  if (defaultValues !== undefined || argument.presence === 'default') {
    state.values[name] = defaultValues === undefined ? argument.defaultValue : [...defaultValues];
    state.argumentStates.set(name, defaultArgument);
    return;
  }
  state.values[name] = argument.repeatable || argument.trailingVarArg ? [] : undefined;
  state.argumentStates.delete(name);
}

export function suppliedArgument(state: ArgumentValues, name: string): SuppliedArgument | undefined {
  const argument = state.argumentStates.get(name);
  return argument?.kind === 'supplied' ? argument : undefined;
}

export function hasCommandLineInput(state: ArgumentValues, name: string): boolean {
  const argument = state.argumentStates.get(name);
  return argument?.kind !== 'implicit' && argument?.input === 'cli';
}

export function recordSuppliedArgument(
  state: ArgumentValues,
  name: string,
  input: InputSource,
  { source = input, valueCount = 0, tokenIndex }: {
    readonly source?: InputSource;
    readonly valueCount?: number;
    readonly tokenIndex?: number | undefined;
  } = {},
): void {
  if (state.argumentStates.get(name)?.kind !== 'supplied') {
    // Exclusivity diagnostics list supplied arguments in the order they became present.
    state.argumentStates.delete(name);
  }
  state.argumentStates.set(name, { kind: 'supplied', input, source, valueCount, tokenIndex });
}

export function* suppliedArgumentNames(state: ArgumentValues): IterableIterator<string> {
  for (const [name, argument,] of state.argumentStates) {
    if (argument.kind === 'supplied') {
      yield name;
    }
  }
}
