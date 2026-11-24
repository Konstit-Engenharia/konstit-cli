import type { ArgumentDefinition } from '../../argument/types.js';
import type { Environment } from '../../command/environment.js';
import type { ArgumentValues } from '../../command/parsing/argument-state.js';
import type { ArgvState } from '../../command/parsing/recognition.js';
import type { RelationState } from '../../command/parsing/relations.js';
import type { CommandDefinition } from '../../command/schema.js';
import type { CommandConfig } from '../../configuration/shape.js';
import type { CompletionValueHint } from '../../parser/index.js';

/** A completion returned by a dynamic provider. */
export interface DynamicCompletionCandidate {
  /** The text offered as a completion. */
  readonly value: string;
  /** An optional label displayed by shells that support candidate descriptions. */
  readonly description?: string;
}

/** A completion supplied as plain text or as a value with a description. */
export type DynamicCompletionCandidateInput =
  | string
  | DynamicCompletionCandidate;

/** Parsed values and defaults keyed by argument name. */
export type DynamicCompletionValues = Readonly<Record<string, unknown>>;
/** Unparsed values keyed by argument name, in the order they were collected. */
export type DynamicCompletionRawValues = Readonly<
  Record<string, readonly string[]>
>;

/** Data available to an argument completion provider. */
export interface DynamicCompletionContext<
  out Values extends DynamicCompletionValues = DynamicCompletionValues,
> {
  /** All words supplied to the resolver, excluding the executable. */
  readonly argv: readonly string[];
  /** Index of the word being completed. */
  readonly cursor: number;
  /** The value fragment being completed, without an inline option prefix. */
  readonly current: string;
  /** Canonical command names from the root to the active command. */
  readonly commandPath: readonly string[];
  /** The normalized definition of the active command. */
  readonly command: CommandDefinition;
  /** The normalized definition of the argument whose value is being completed. */
  readonly argument: ArgumentDefinition;
  /** Parsed values and fallbacks visible at the active command. */
  readonly values: Values;
  /** Raw argument values from preceding words, the environment, or config. */
  readonly rawValues: DynamicCompletionRawValues;
}

/** Candidates yielded synchronously or asynchronously by a value completer. */
export type DynamicCompletionIterable =
  | Iterable<DynamicCompletionCandidateInput>
  | AsyncIterable<DynamicCompletionCandidateInput>;

/** A synchronous, asynchronous, or async-iterable value completer. */
export type DynamicCompletionProvider<
  in Values extends DynamicCompletionValues = DynamicCompletionValues,
> = (
  context: DynamicCompletionContext<Values>,
) => DynamicCompletionIterable | PromiseLike<DynamicCompletionIterable>;

/** Settings for resolving completions at a given word. */
export interface DynamicCompletionOptions {
  /**
   * Index of the word being completed. It can equal argv.length to represent
   * a new empty word. The default is the final argv word, or zero for [].
   */
  readonly cursor?: number;
  /** Applies prefix filtering to provider and static values. The default is true. */
  readonly filter?: boolean;
  /** Environment variables used for argument fallbacks. Defaults to `Bun.env`. */
  readonly env?: Environment;
  /** Configuration values used below CLI and environment values. */
  readonly config?: CommandConfig;
}

/** The candidates and context resolved for one completion request. */
export interface DynamicCompletionResult {
  /** The suggestions to offer for the current word. */
  readonly candidates: readonly DynamicCompletionCandidate[];
  /** Canonical command names from the root to the active command. */
  readonly commandPath: readonly string[];
  /** The word or value fragment used to resolve candidates. */
  readonly current: string;
  /** The argument being completed, when the word can contain an argument value. */
  readonly argument?: ArgumentDefinition;
  /** The file or directory hint available for value completion. */
  readonly valueHint?: CompletionValueHint;
}

export interface ActiveCommandScope {
  readonly command: CommandDefinition;
  readonly commandPath: readonly string[];
  readonly inheritedGlobals: readonly ArgumentDefinition[];
  positionalIndex: number;
  argvState: ArgvState;
  readonly config?: CommandConfig | undefined;
}

export interface ScanState extends ArgumentValues {
  active: ActiveCommandScope;
  readonly env: Environment;
  readonly owners: Map<string, CommandDefinition>;
  readonly scopes: Map<CommandDefinition, ScopeSnapshot>;
  readonly rawValues: Record<string, string[]>;
}

export interface ScopeSnapshot extends RelationState {
  readonly config: CommandConfig | undefined;
  readonly inheritedGlobals: readonly ArgumentDefinition[];
}

export interface ValueTarget {
  readonly argument: ArgumentDefinition;
  readonly current: string;
  readonly outputPrefix: string;
}
