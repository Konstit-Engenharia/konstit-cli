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

/** A structured parser failure. */
export class CliError extends Error {
  override readonly name = 'CliError';
  readonly kind: ErrorKind;
  readonly exitCode: number;
  readonly output: string;

  constructor(kind: ErrorKind, message: string, output: string, exitCode = 2) {
    super(message);
    if (!Number.isSafeInteger(exitCode) || exitCode < 1 || exitCode > 255) {
      throw new RangeError('A CLI error exit code must be an integer from 1 to 255');
    }
    this.kind = kind;
    this.output = output;
    this.exitCode = exitCode;
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
