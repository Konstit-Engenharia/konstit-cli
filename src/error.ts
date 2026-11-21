/** Machine-readable categories for CLI errors. */
export const ErrorKind = Object.freeze(
  {
    /** An unrecognized option or unexpected argument. */
    UnknownArgument: 'unknown-argument',
    /** An unrecognized or invalid subcommand selection. */
    InvalidSubcommand: 'invalid-subcommand',
    /** A value rejected by a parser or validation rule. */
    InvalidValue: 'invalid-value',
    /** An option was supplied without its required equals sign. */
    NoEquals: 'no-equals',
    /** A required argument or argument group was omitted. */
    MissingRequiredArgument: 'missing-required-argument',
    /** A command required a subcommand, but none was supplied. */
    MissingSubcommand: 'missing-subcommand',
    /** The supplied arguments or subcommands cannot be used together. */
    ArgumentConflict: 'argument-conflict',
    /** An argument or group dependency is missing or has a non-matching value. */
    MissingDependency: 'missing-dependency',
    /** An argument received fewer values than its minimum. */
    TooFewValues: 'too-few-values',
    /** An argument received more values than its maximum. */
    TooManyValues: 'too-many-values',
    /** An invalid command or argument definition. */
    InvalidDefinition: 'invalid-definition',
  } as const,
);

/** The string discriminator carried by a {@link CliError}. */
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
  /** The fixed error name. */
  override readonly name = 'CliError';
  /** The machine-readable category of the failure. */
  readonly kind: ErrorKind;
  /** The exit status associated with this failure. */
  readonly exitCode: number;
  /** The diagnostic text formatted for display. */
  readonly output: string;
  /** The schema name of the argument associated with the failure. */
  readonly argumentName?: string;
  /** The command path where the failure was detected. */
  readonly commandPath: readonly string[];
  /** The index of the offending token in the original argv, when applicable. */
  readonly tokenIndex?: number;
  /** Machine-readable suggestions for recovering from the failure. */
  readonly suggestions: readonly string[];
  /** Other argument names involved in the failure. */
  readonly relatedArguments: readonly string[];

  /**
   * Creates a structured CLI failure with an exit code from 1 to 255.
   * @param kind Machine-readable failure category.
   * @param message The underlying Error message.
   * @param output The diagnostic text formatted for display.
   * @param exitCode The exit status to report. Defaults to 2.
   * @param details Context about the command, argument, or offending token.
   * @throws {RangeError} If the exit code is not an integer from 1 to 255.
   */
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

/** Machine-readable categories for display results. */
export const DisplayKind = Object.freeze(
  {
    /** Generated or overridden command help. */
    Help: 'help',
    /** The configured command version. */
    Version: 'version',
  } as const,
);

/** The kind of text carried by a {@link ParseDisplay} result. */
export type DisplayKind = (typeof DisplayKind)[keyof typeof DisplayKind];

/** A successful parse with typed argument values. */
export interface ParseValue<Value> {
  /** Indicates that parsing succeeded. */
  readonly ok: true;
  /** Identifies a successful argument parse. */
  readonly type: 'value';
  /** The parsed arguments and any selected subcommand. */
  readonly value: Value;
}

/** Successful parser control output, such as help or version text. */
export interface ParseDisplay {
  /** Indicates that parsing produced a successful display result. */
  readonly ok: true;
  /** Identifies a display result. */
  readonly type: 'display';
  /** Whether the result contains help or version text. */
  readonly kind: DisplayKind;
  /** The formatted text to display. */
  readonly output: string;
}

/** An expected CLI failure returned by tryParse(). */
export interface ParseFailure {
  /** Indicates that parsing failed. */
  readonly ok: false;
  /** Identifies a parse failure. */
  readonly type: 'error';
  /** The structured parser error. */
  readonly error: CliError;
}

/** Every successful result of parsing explicit argv. */
export type ParseOutcome<Value> = ParseValue<Value> | ParseDisplay;

/** Every expected result of parsing explicit argv without exceptions. */
export type ParseResult<Value> = ParseOutcome<Value> | ParseFailure;
