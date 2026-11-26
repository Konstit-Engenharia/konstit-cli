import type {
  AnyArgument,
  AnyGlobalArgument,
  ArgumentName,
  ArgumentOutput,
  ArgumentType,
} from '../argument/index.js';
import type {
  RequiredArgument,
  TrailingPositional,
} from '../argument/types.js';
import type { ParseOptions } from '../configuration/shape.js';
import type { DeprecationWarning } from '../result/deprecation.js';
import type {
  ParseOutcome,
  ParseResult,
} from '../result/error.js';
import type {
  ConsoleOptions,
  HandlerConsole,
} from '../terminal/console.js';
import type { OutputWriter } from '../terminal/output.js';
import type { Style } from '../terminal/style.js';
import type {
  CommandExampleInput,
  GroupOptions,
} from './schema.js';

/** A handler exit code from 0 to 255, or no return value for exit code 0. */
// biome-ignore lint/suspicious/noConfusingVoidType: Handlers intentionally support callbacks with no return value.
export type HandlerResult = void | number;

/** Runtime data available to every command handler. */
export interface HandlerContext {
  /** The selected command path, from the root command to the handler. */
  readonly commandPath: readonly string[];
  /** A caller-controlled cancellation signal for this invocation. */
  readonly signal: AbortSignal;
  /** The input byte stream for this invocation. Defaults to process stdin. */
  readonly stdin: ReadableStream<Uint8Array>;
  /** Writes a raw chunk to the configured standard output. */
  readonly stdout: (chunk: string) => Promise<void>;
  /** Writes a raw chunk to the configured standard error. */
  readonly stderr: (chunk: string) => Promise<void>;
  /** Stream-aware CSS and LS_COLORS formatting for handler output. */
  readonly style: Style;
  /** Synchronous line-oriented output through independently configurable sinks. */
  readonly output: HandlerConsole;
  /** Gets a global argument declared by the selected command or an ancestor. */
  global<ArgumentType extends AnyGlobalArgument>(
    argument: ArgumentType,
  ): ArgumentOutput<ArgumentType>;
}

/** A command callback whose argument shape is inferred from its schema. */
export type CommandHandler<in Arguments extends object> = (
  args: Arguments,
  context: HandlerContext,
) => HandlerResult | PromiseLike<HandlerResult>;

export type Simplify<Value> = { [Key in keyof Value]: Value[Key]; } & {};
export type StringKeyOf<Value> = Extract<keyof Value, string>;

/** A cross-argument validation failure associated with a declared argument. */
export interface CommandValidationIssue<Name extends string = string> {
  /** The canonical name of the argument to report. */
  readonly argumentName: Name;
  /** The detail to add to the invalid-value diagnostic. */
  readonly message: string;
  /** Other arguments involved in the failure. */
  readonly relatedArguments?: readonly Name[];
}

/** A synchronous validator for the resolved arguments of a command. */
export type CommandValidator<in Arguments extends object, out Name extends string = StringKeyOf<Arguments>> = (
  args: Arguments,
  // biome-ignore lint/suspicious/noConfusingVoidType: A validator can succeed without returning a value.
) => void | CommandValidationIssue<Name>;

export type RelationValue<Value> = Exclude<Value, undefined> extends readonly (infer Item)[] ? Item
  : Exclude<Value, undefined>;

/** Compares an argument to a value or collection item of the appropriate type. */
export type FieldCondition<
  Fields extends object,
  Excluded extends StringKeyOf<Fields>,
> = {
  [Source in Exclude<StringKeyOf<Fields>, Excluded>]: readonly [
    /** The argument whose value is checked. */
    source: Source,
    /** The expected value or collection item. */
    expected: RelationValue<Fields[Source]>,
  ];
}[Exclude<StringKeyOf<Fields>, Excluded>];

export type DuplicateArgument<Name extends string> = {
  readonly __typeclap_error__: `Argument '${Name}' is already registered`;
};

export type DuplicateSubcommand<Name extends string> = {
  readonly __typeclap_error__: `Subcommand '${Name}' is already registered`;
};

export type DuplicateGroup<Name extends string> = {
  readonly __typeclap_error__: `Argument group '${Name}' is already registered`;
};

export type EmptyObject = Record<never, never>;

/** The parsed data for a selected subcommand. */
type ParsedSubcommand<Subcommands extends Record<string, unknown>> = {
  [Name in StringKeyOf<Subcommands>]: Subcommands[Name] extends AnyCommand ? {
      /** The canonical name of the selected subcommand. */
      readonly name: Name;
      /** The subcommand's parsed arguments and any nested selection. */
      readonly args: Infer<Subcommands[Name]>;
    }
    : never;
}[StringKeyOf<Subcommands>];

/** The selection field added to parsed values for commands with subcommands. */
type SubcommandField<
  Subcommands extends Record<string, unknown>,
  Required extends boolean,
> = StringKeyOf<Subcommands> extends never ? EmptyObject
  : {
    /** The selected subcommand, or undefined when selection is optional and absent. */
    readonly subcommand: Required extends true ? ParsedSubcommand<Subcommands>
      : ParsedSubcommand<Subcommands> | undefined;
  };

/** Parsed argument fields combined with any subcommand selection. */
export type CommandArguments<
  Fields extends object,
  Subcommands extends Record<string, unknown>,
  Required extends boolean,
> = Simplify<Readonly<Fields> & SubcommandField<Subcommands, Required>>;

export declare const commandTypeKey: unique symbol;

/** The covariant type surface used to inspect any configured command. */
export interface CommandType<
  out Name extends string = string,
  out Fields extends object = object,
  out Subcommands extends Record<string, unknown> = Record<string, unknown>,
  out SubcommandRequired extends boolean = boolean,
  out Groups extends string = string,
> {
  /** Carries the command's inferred schema types. */
  readonly [commandTypeKey]: readonly [
    Name,
    Fields,
    Subcommands,
    SubcommandRequired,
    Groups,
  ];
}

/** A configured command with any argument and subcommand schema. */
export type AnyCommand = CommandType;

/** A terminal command schema that can parse, render, and run. */
export interface HandledCommand<
  out Name extends string = string,
  out Fields extends object = object,
  out Subcommands extends Record<string, unknown> = Record<string, unknown>,
  out SubcommandRequired extends boolean = boolean,
  out Groups extends string = string,
> extends CommandType<Name, Fields, Subcommands, SubcommandRequired, Groups> {
  /** Parses explicit argv. User-facing failures throw CliError. */
  parse(argv: readonly string[], options?: ParseOptions): ParseOutcome<Infer<this>>;
  /** Parses argv without exceptions for expected CLI outcomes. */
  tryParse(argv: readonly string[], options?: ParseOptions): ParseResult<Infer<this>>;
  /** Parses argv and returns the exit code after handling the result. */
  run(argv?: readonly string[]): Promise<number>;
  /** Parses configured argv, handles the result using the supplied options, and returns the exit code. */
  run(options?: RunOptions): Promise<number>;
  /** Executes a result from this command's parse or tryParse without parsing again. */
  runParsed(result: ParseResult<Infer<this>>, options?: RunParsedOptions): Promise<number>;
  /** Renders the complete help text for this command. */
  renderHelp(): string;
  /** Renders the usage line for this command. */
  renderUsage(): string;
}

/** Gets the parsed argument and subcommand value type for a configured command. */
export type Infer<ConfiguredCommand extends AnyCommand> = ConfiguredCommand extends CommandType<
  infer _Name,
  infer Fields,
  infer Subcommands,
  infer Required,
  infer _Groups
> ? CommandArguments<Fields, Subcommands, Required>
  : never;

export type FieldsFromArguments<Arguments extends readonly AnyArgument[]> = Simplify<
  {
    [Value in Arguments[number] as ArgumentName<Value>]: ArgumentOutput<Value>;
  }
>;

type ExampleScalar<Value> = Value extends string | number | boolean | bigint ? Value : string;

type ExampleCollection<Output, Scalar> = Output extends readonly unknown[] ? { readonly [Index in keyof Output]: Scalar; }
  : readonly Scalar[];

type ExampleValue<Argument> = Argument extends ArgumentType<string, infer Value, infer Output, infer Kind, infer Cardinality>
  ? Kind extends 'flag' ? boolean
  : Kind extends 'count' ? number
  : Cardinality extends 'many' ? ExampleCollection<Exclude<Output, undefined>, ExampleScalar<Value>>
  : Cardinality extends 'optional' ? ExampleScalar<Value> | readonly []
  : ExampleScalar<Value>
  : never;

type ExampleParams<Arguments extends readonly AnyArgument[]> = string extends ArgumentName<Arguments[number]>
  ? Readonly<Record<string, unknown>>
  : Arguments[number] extends never ? Readonly<Record<string, never>>
  : Simplify<
    & {
      readonly [Argument in Arguments[number] as Argument extends RequiredArgument ? ArgumentName<Argument> : never]: ExampleValue<
        Argument
      >;
    }
    & {
      readonly [Argument in Arguments[number] as Argument extends RequiredArgument ? never : ArgumentName<Argument>]?: ExampleValue<
        Argument
      >;
    }
  >;

export type CommandName<Value extends AnyCommand> = Value extends CommandType<infer Name> ? Name : never;

export type SubcommandsFromTuple<Subcommands extends readonly AnyCommand[]> = Simplify<
  {
    [Value in Subcommands[number] as CommandName<Value>]: Value;
  }
>;

type NonEmptyTuple<Value> = readonly [Value, ...Value[]];
type AtLeastTwoTuple<Value> = readonly [Value, Value, ...Value[]];

/** A relation between two distinct arguments. */
type BinaryArgumentRelation<Fields extends object> = {
  [Source in StringKeyOf<Fields>]: readonly [
    /** The argument that triggers the relation. */
    source: Source,
    /** The argument affected by the relation. */
    target: Exclude<StringKeyOf<Fields>, Source>,
  ];
}[StringKeyOf<Fields>];

/** The total value count required for a repeatable option by `requiresIf`. */
export type RequiresIfValueCount =
  | { readonly exactValues: number; readonly minValues?: never; readonly maxValues?: never; }
  | { readonly exactValues?: never; readonly minValues: number; readonly maxValues?: number; }
  | { readonly exactValues?: never; readonly minValues?: never; readonly maxValues: number; };

/** Requires an argument when another argument matches an expected value. */
type ConditionalArgumentRelation<Fields extends object> = {
  [Source in StringKeyOf<Fields>]: readonly [
    /** The argument whose value is checked. */
    source: Source,
    /** The expected source value or collection item. */
    expected: RelationValue<Fields[Source]>,
    /** The argument required when the source matches. */
    target: Exclude<StringKeyOf<Fields>, Source>,
    /** Optional count constraint across all occurrences of a repeatable target option. */
    valueCount?: RequiresIfValueCount,
  ];
}[StringKeyOf<Fields>];

/** Requires an argument with a matching value when another argument is supplied. */
type RequiredValueRelation<Fields extends object> = {
  [Target in StringKeyOf<Fields>]: readonly [
    /** The argument that triggers the requirement. */
    source: Exclude<StringKeyOf<Fields>, Target>,
    /** The argument that must be supplied with a matching value. */
    target: Target,
    /** The expected target value or collection item. */
    expected: RelationValue<Fields[Target]>,
  ];
}[StringKeyOf<Fields>];

/** Requires an argument when its configured set of conditions matches. */
type ConditionalSetRelation<Fields extends object> = {
  [Target in StringKeyOf<Fields>]: {
    /** One or more argument and expected-value pairs. */
    readonly conditions: NonEmptyTuple<FieldCondition<Fields, Target>>;
    /** The argument required when the conditions match. */
    readonly target: Target;
  };
}[StringKeyOf<Fields>];

/** Requires an argument unless the supplied alternatives satisfy the rule. */
type RequiredUnlessRelation<Fields extends object> = {
  [Target in StringKeyOf<Fields>]: {
    /** Arguments whose presence can waive the requirement. */
    readonly alternatives: NonEmptyTuple<
      Exclude<StringKeyOf<Fields>, Target>
    >;
    /** The argument required when the alternatives do not satisfy the rule. */
    readonly target: Target;
  };
}[StringKeyOf<Fields>];

/** Supplies a fallback value based on another argument. */
type ConditionalDefaultRelation<Fields extends object> = {
  [Source in StringKeyOf<Fields>]: {
    [Target in Exclude<StringKeyOf<Fields>, Source>]: {
      /** The argument that triggers the fallback. */
      readonly source: Source;
      /** The expected source value or collection item. Omit to check whether the source was supplied. */
      readonly equals?: RelationValue<Fields[Source]>;
      /** The argument that receives the fallback. */
      readonly target: Target;
      /** The fallback in the target's parsed value type. */
      readonly value: Exclude<Fields[Target], undefined>;
    };
  }[Exclude<StringKeyOf<Fields>, Source>];
}[StringKeyOf<Fields>];

/** A declarative clap-style argument group. */
export interface CommandGroupOptions<
  Name extends string = string,
  ArgumentName extends string = string,
> extends GroupOptions {
  /** The name used to identify the group in diagnostics. */
  readonly name: Name;
  /** Arguments that belong to this group. */
  readonly members: NonEmptyTuple<ArgumentName>;
  /** Arguments required whenever any group member is present. */
  readonly requires?: readonly ArgumentName[];
  /** Arguments that conflict whenever any group member is present. */
  readonly conflicts?: readonly ArgumentName[];
}

export type GroupNamesFromTuple<
  Groups extends readonly CommandGroupOptions[],
> = Groups[number] extends CommandGroupOptions<infer Name, string> ? Name
  : never;

type UniqueArguments<
  Arguments extends readonly AnyArgument[],
  Seen extends string = never,
> = number extends Arguments['length'] ? unknown
  : Arguments extends readonly [
    infer First extends AnyArgument,
    ...infer Rest extends readonly AnyArgument[],
  ] ? ArgumentName<First> extends infer Name extends string ? string extends Name ? unknown
      : [Name] extends [never] ? UniqueArguments<Rest, Seen>
      : [Name] extends [Seen] ? DuplicateArgument<Name>
      : UniqueArguments<Rest, Seen | Name>
    : unknown
  : unknown;

type CheckedTrailingPositionals<
  Arguments extends readonly AnyArgument[],
  HasFollowingPositional extends boolean = false,
> = Arguments extends readonly [
  ...infer Rest extends readonly AnyArgument[],
  infer Last extends AnyArgument,
]
  ? [HasFollowingPositional, Last] extends [true, TrailingPositional]
    ? CommandConfigurationError<`Trailing positional '${ArgumentName<Last>}' must be the last positional`>
  : CheckedTrailingPositionals<Rest, [Last] extends [ArgumentType<string, unknown, unknown, 'positional'>] ? true : HasFollowingPositional>
  : unknown;

type UniqueSubcommands<
  Subcommands extends readonly AnyCommand[],
  Seen extends string = never,
> = number extends Subcommands['length'] ? unknown
  : Subcommands extends readonly [
    infer First extends AnyCommand,
    ...infer Rest extends readonly AnyCommand[],
  ] ? CommandName<First> extends infer Name extends string ? string extends Name ? unknown
      : [Name] extends [Seen] ? DuplicateSubcommand<Name>
      : UniqueSubcommands<Rest, Seen | Name>
    : unknown
  : unknown;

type CommandConfigurationError<Message extends string> = {
  readonly __typeclap_error__: Message;
};

type DuplicateString<
  Values extends readonly string[],
  Seen extends string = never,
> = number extends Values['length'] ? never
  : Values extends readonly [
    infer First extends string,
    ...infer Rest extends readonly string[],
  ] ? string extends First ? never
    : First extends Seen ? First
    : DuplicateString<Rest, Seen | First>
  : never;

type CheckedUniqueStrings<
  Values extends readonly string[],
  Context extends string,
> = DuplicateString<Values> extends infer Duplicate extends string ? [Duplicate] extends [never] ? unknown
  : CommandConfigurationError<`${Context} contains duplicate '${Duplicate}'`>
  : unknown;

type CheckedGroup<
  Group extends CommandGroupOptions,
> =
  & (Exclude<keyof Group, keyof CommandGroupOptions> extends never ? unknown
    : CommandConfigurationError<`Argument group '${Group['name']}' contains unsupported fields`>)
  & CheckedUniqueStrings<Group['members'], `Argument group '${Group['name']}'`>
  & ('requires' extends keyof Group ? Group['requires'] extends readonly string[] ? CheckedUniqueStrings<
        Group['requires'],
        `Argument group '${Group['name']}' requirements`
      >
    : unknown
    : unknown)
  & ('conflicts' extends keyof Group ? Group['conflicts'] extends readonly string[] ? CheckedUniqueStrings<
        Group['conflicts'],
        `Argument group '${Group['name']}' conflicts`
      >
    : unknown
    : unknown);

type CheckedGroups<
  Groups extends readonly CommandGroupOptions[],
  Seen extends string = never,
> = number extends Groups['length'] ? unknown
  : Groups extends readonly [
    infer First extends CommandGroupOptions,
    ...infer Rest extends readonly CommandGroupOptions[],
  ] ? string extends First['name'] ? unknown
    : First['name'] extends Seen ? DuplicateGroup<First['name']>
    : CheckedGroup<First> & CheckedGroups<Rest, Seen | First['name']>
  : unknown;

/** Whether conditional requirements compare supplied inputs or all resolved values. */
export type RequirementConditionInput = 'supplied' | 'resolved';

/** Optional values applied when starting an immutable command definition. */
export interface CommandOptions<
  Arguments extends readonly AnyArgument[] = readonly AnyArgument[],
  Subcommands extends readonly AnyCommand[] = readonly AnyCommand[],
  SubcommandRequired extends boolean = boolean,
  Groups extends readonly CommandGroupOptions<
    string,
    StringKeyOf<FieldsFromArguments<Arguments>>
  >[] = readonly CommandGroupOptions<
    string,
    StringKeyOf<FieldsFromArguments<Arguments>>
  >[],
> {
  /** Warns when this command is invoked, with guidance for its replacement. */
  readonly deprecated?: string;
  /** Maps declared aliases to messages emitted only for exact alias invocations. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** Sets the version text printed by `-V` and `--version`. */
  readonly version?: string;
  /** Sets the short command description shown in help and completion. */
  readonly about?: string;
  /** Sets the extended command description shown in full help. */
  readonly longAbout?: string;
  /** Sets the author line shown in generated help. */
  readonly author?: string;
  /** Adds text before the generated help content. */
  readonly beforeHelp?: string;
  /** Adds text after the generated help content. */
  readonly afterHelp?: string;
  /** Adds example invocations to generated help, Markdown, and man pages. */
  readonly examples?: readonly CommandExampleInput<ExampleParams<NoInfer<Arguments>>>[];
  /** Replaces the generated usage line with exact text. */
  readonly overrideUsage?: string;
  /** Replaces all generated help output with exact text. */
  readonly overrideHelp?: string;
  /** Adds parseable aliases that are hidden from help and completion. */
  readonly aliases?: readonly string[];
  /** Adds parseable aliases that are shown in help and completion. */
  readonly visibleAliases?: readonly string[];
  /** Adds arguments in tuple order. */
  readonly args?: Arguments;
  /** Adds subcommands in tuple order. */
  readonly subcommands?: Subcommands;
  /** Accepts an unambiguous prefix of a subcommand name or alias. */
  readonly inferSubcommands?: boolean;
  /** Makes the parsed subcommand field required. */
  readonly subcommandRequired?: SubcommandRequired;
  /**
   * Rejects CLI-supplied local arguments when a subcommand is selected.
   * Defaults to false. Globals, defaults, and environment fallbacks are exempt.
   * Does not waive required arguments.
   */
  readonly argsConflictWithSubcommands?: boolean;
  /** Allows later CLI occurrences of non-repeatable options and ordinary flags to replace earlier values. */
  readonly argsOverrideSelf?: boolean;
  /** Displays help when no argument or subcommand was supplied. */
  readonly defaultToHelp?: boolean;
  /** Disables the generated `help` subcommand. */
  readonly disableHelpSubcommand?: boolean;
  /** Disables the generated `-h` and `--help` flags. */
  readonly disableHelpFlag?: boolean;
  /** Disables the generated `-V` and `--version` flags. */
  readonly disableVersionFlag?: boolean;
  /** Hides generated help and version flags and color switches from descendant help text. */
  readonly hideStandardFlagsInSubcommandHelp?: boolean;
  /** Hides this command from parent help and completion. */
  readonly hide?: boolean;
  /** Requires a target whenever its source is present. */
  readonly requires?: readonly BinaryArgumentRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Requires at least one member of a named group whenever its source is supplied. */
  readonly requiresGroup?: readonly (readonly [
    source: StringKeyOf<FieldsFromArguments<Arguments>>,
    group: NoInfer<GroupNamesFromTuple<Groups>>,
  ])[];
  /** Selects the inputs checked by `requiresIf`, `requiredIfAny`, and `requiredIfAll`. */
  readonly requirementConditionInput?: RequirementConditionInput;
  /** Requires a target, optionally with a total value count, whenever its source matches an expected value. */
  readonly requiresIf?: readonly ConditionalArgumentRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Requires a supplied target matching the expected value whenever its source is present. */
  readonly requiresValue?: readonly RequiredValueRelation<FieldsFromArguments<Arguments>>[];
  /** Requires a target whenever any configured condition matches. */
  readonly requiredIfAny?: readonly ConditionalSetRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Requires a target whenever all configured conditions match. */
  readonly requiredIfAll?: readonly ConditionalSetRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Requires a target unless at least one alternative is present. */
  readonly requiredUnlessPresent?: readonly RequiredUnlessRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Requires a target unless every alternative is present. */
  readonly requiredUnlessAll?: readonly RequiredUnlessRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Supplies a target value when a source value matches a condition. */
  readonly defaultIf?: readonly ConditionalDefaultRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Clears a target whenever its source is explicitly provided. */
  readonly overrides?: readonly BinaryArgumentRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Makes every argument in each tuple mutually exclusive. */
  readonly conflicts?: readonly AtLeastTwoTuple<
    StringKeyOf<FieldsFromArguments<Arguments>>
  >[];
  /** Makes each listed argument conflict with other supplied arguments declared on this command. */
  readonly exclusive?: NonEmptyTuple<
    StringKeyOf<FieldsFromArguments<Arguments>>
  >;
  /** Defines clap-style argument groups and their relations. */
  readonly groups?: Groups;
  /** Rejects direct contradictions between presence requirements and conflicts. Defaults to false. */
  readonly strictRelations?: boolean;
  /** Validates resolved arguments after defaults, overrides, and built-in relations. */
  readonly validate?: CommandValidator<
    CommandArguments<FieldsFromArguments<Arguments>, SubcommandsFromTuple<Subcommands>, SubcommandRequired>,
    StringKeyOf<FieldsFromArguments<Arguments>>
  >;
  /** Attaches a callback with the exact configured argument type. */
  readonly handler?: CommandHandler<
    CommandArguments<
      FieldsFromArguments<Arguments>,
      SubcommandsFromTuple<Subcommands>,
      SubcommandRequired
    >
  >;
}

/** Command options with compile-time checks for layout, uniqueness, and group membership. */
export type CheckedCommandOptions<
  Arguments extends readonly AnyArgument[],
  Subcommands extends readonly AnyCommand[],
  SubcommandRequired extends boolean,
  Groups extends readonly CommandGroupOptions<
    string,
    StringKeyOf<FieldsFromArguments<Arguments>>
  >[],
> =
  & CommandOptions<Arguments, Subcommands, SubcommandRequired, Groups>
  & (SubcommandRequired extends true ? number extends Subcommands['length'] ? unknown
    : Subcommands extends readonly [] ? CommandConfigurationError<
        'A command with subcommandRequired enabled must define at least one subcommand'
      >
    : unknown
    : unknown)
  & {
    /** Arguments in declaration order, with unique names and any trailing positional last among positionals. */
    readonly args?:
      & Arguments
      & UniqueArguments<Arguments>
      & (Extract<Arguments[number], TrailingPositional> extends never ? unknown : CheckedTrailingPositionals<Arguments>);
    /** Subcommands in declaration order, with unique names. */
    readonly subcommands?: Subcommands & UniqueSubcommands<Subcommands>;
    /** Requires selecting one of the configured subcommands. */
    readonly subcommandRequired?: SubcommandRequired;
    /** Named argument groups and their dependency and conflict rules. */
    readonly groups?: Groups & CheckedGroups<Groups>;
  };

/** I/O and exit-code options for executing an existing parse result. */
export interface RunParsedOptions extends ConsoleOptions {
  /** Receives deprecation warnings instead of writing them to stderr. */
  readonly onWarning?: (warning: DeprecationWarning) => void;
  /** Supplies a byte stream to the selected handler. Defaults to process stdin. */
  readonly stdin?: ReadableStream<Uint8Array>;
  /** Receives handler output, help, and version text. run() also writes completion output here. */
  readonly stdout?: OutputWriter;
  /** Receives handler error output, parse errors, and deprecation warnings. */
  readonly stderr?: OutputWriter;
  /** Controls ANSI styling. Parsed argument values are unchanged. */
  readonly color?: boolean;
  /** Supplies a caller-controlled signal exposed to the selected handler. */
  readonly signal?: AbortSignal;
  /** Selects the serialization of framework diagnostics. Defaults to terminal text. */
  readonly diagnostics?: 'text' | 'json';
  /** Overrides parse-failure exit codes with an integer from 1 to 255. Defaults to CliError.exitCode (2). */
  readonly parseErrorExitCode?: number;
}

/** Options for parsing argv and handling the result in one call. */
export interface RunOptions extends RunParsedOptions, ParseOptions {
  /** Arguments to parse. Defaults to `Bun.argv.slice(2)`. */
  readonly argv?: readonly string[];
  /** Controls ANSI styling and the automatic color-flag value. */
  readonly color?: boolean;
}
