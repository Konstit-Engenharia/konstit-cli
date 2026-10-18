export const ErrorKind = Object.freeze(
  {
    UnknownArgument: 'unknown-argument',
    InvalidSubcommand: 'invalid-subcommand',
    InvalidValue: 'invalid-value',
    NoEquals: 'no-equals',
    MissingRequiredArgument: 'missing-required-argument',
    MissingSubcommand: 'missing-subcommand',
    ArgumentConflict: 'argument-conflict',
    MissingDependency: 'missing-dependency',
    TooFewValues: 'too-few-values',
    TooManyValues: 'too-many-values',
    InvalidDefinition: 'invalid-definition',
  } as const,
);

export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];

/** Optional context attached to a structured parser failure. */
export interface CliErrorDetails {
  /** The schema name of the argument associated with the failure. */
  readonly argumentName?: string;
  /** The command path active when the failure was detected. */
  readonly commandPath?: readonly string[];
  /** The index of the offending token in the original argv, when applicable. */
  readonly tokenIndex?: number;
  /** Machine-readable suggestions for recovering from the failure. */
  readonly suggestions?: readonly string[];
  /** Other argument names involved in a relation or conflict. */
  readonly relatedArguments?: readonly string[];
}

/** A structured parser failure. */
export class CliError extends Error {
  override readonly name = 'CliError';
  readonly kind: ErrorKind;
  readonly exitCode: number;
  readonly output: string;
  readonly argumentName?: string;
  readonly commandPath: readonly string[];
  readonly tokenIndex?: number;
  readonly suggestions: readonly string[];
  readonly relatedArguments: readonly string[];

  constructor(
    kind: ErrorKind,
    message: string,
    output: string,
    exitCode = 2,
    details: CliErrorDetails = {},
  ) {
    super(message);
    if (!Number.isSafeInteger(exitCode) || exitCode < 1 || exitCode > 255) {
      throw new RangeError('A CLI error exit code must be an integer from 1 to 255');
    }
    this.kind = kind;
    this.output = output;
    this.exitCode = exitCode;
    if (details.argumentName !== undefined) {
      this.argumentName = details.argumentName;
    }
    this.commandPath = Object.freeze([...(details.commandPath ?? [])]);
    if (details.tokenIndex !== undefined) {
      this.tokenIndex = details.tokenIndex;
    }
    this.suggestions = Object.freeze([...(details.suggestions ?? [])]);
    this.relatedArguments = Object.freeze([...(details.relatedArguments ?? [])]);
  }
}

export const DisplayKind = Object.freeze(
  {
    Help: 'help',
    Version: 'version',
  } as const,
);

export type DisplayKind = (typeof DisplayKind)[keyof typeof DisplayKind];

/** A parsed argument value. */
export interface ParseValue<Value> {
  readonly ok: true;
  readonly type: 'value';
  readonly value: Value;
}

/** Successful parser control output, such as help or version text. */
export interface ParseDisplay {
  readonly ok: true;
  readonly type: 'display';
  readonly kind: DisplayKind;
  readonly output: string;
}

export interface ParseFailure {
  readonly ok: false;
  readonly type: 'error';
  readonly error: CliError;
}

/** Every successful result of parsing explicit argv. */
export type ParseOutcome<Value> = ParseValue<Value> | ParseDisplay;

/** Every expected result of parsing explicit argv without exceptions. */
export type ParseResult<Value> = ParseOutcome<Value> | ParseFailure;
