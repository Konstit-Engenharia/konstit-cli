import {
  getArgumentDefinition,
  type AnyArgument,
  type AnyGlobalArgument,
  type ArgumentCardinality,
  type ArgumentDefinition,
  type ArgumentKind,
  type ArgumentName,
  type ArgumentOutput,
  type ArgumentType,
} from './argument.js';
import { handlerColorEnabled } from './command/color.js';
import type {
  CommandConfig,
  ParseOptions,
} from './command/config.js';
import type {
  ConsoleOptions,
  HandlerConsole,
} from './command/console.js';
import {
  renderHelp,
  renderUsageText,
} from './command/help.js';
import type { OutputWriter } from './command/output.js';
import {
  parseConfigured,
  tryParseConfigured,
} from './command/parse.js';
import { runConfiguredHandler } from './command/runner.js';
import type {
  CommandDefinition,
  CommandExample,
  GroupDefinition,
  GroupOptions,
  ValueConditionDefinition,
} from './command/schema.js';
import {
  copyCommand,
  getCommandDefinition,
  setCommandDefinition,
} from './command/store.js';
import {
  validateArgument,
  validateCommandAlias,
  validateCommandName,
  validateCommandOptions,
  validateCommandRelations,
} from './command/validation.js';
import type { DeprecationWarning } from './deprecation.js';
import type {
  ParseOutcome,
  ParseResult,
} from './error.js';
import type { Style } from './style.js';

export { getCommandDefinition };
export type { CommandDefinition, CommandExample };
export type { CommandConfig, ConfigValue, ParseOptions } from './command/config.js';

/** A handler exit code from 0 to 255, or no return value for exit code 0. */
// biome-ignore lint/suspicious/noConfusingVoidType: Handlers intentionally support callbacks with no return value.
export type HandlerResult = void | number;

/** Runtime data available to every command handler. */
export interface HandlerContext {
  /** The selected command path, from the root command to the handler. */
  readonly commandPath: readonly string[];
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

type Simplify<Value> = { [Key in keyof Value]: Value[Key]; } & {};
type StringKeyOf<Value> = Extract<keyof Value, string>;

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

type RelationValue<Value> = Exclude<Value, undefined> extends readonly (infer Item)[] ? Item
  : Exclude<Value, undefined>;

/** Compares an argument to a value or collection item of the appropriate type. */
type FieldCondition<
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

type DuplicateArgument<Name extends string> = {
  readonly __typeclap_error__: `Argument '${Name}' is already registered`;
};

type DuplicateSubcommand<Name extends string> = {
  readonly __typeclap_error__: `Subcommand '${Name}' is already registered`;
};

type DuplicateGroup<Name extends string> = {
  readonly __typeclap_error__: `Argument group '${Name}' is already registered`;
};

type EmptyObject = Record<never, never>;

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
type CommandArguments<
  Fields extends object,
  Subcommands extends Record<string, unknown>,
  Required extends boolean,
> = Simplify<Readonly<Fields> & SubcommandField<Subcommands, Required>>;

declare const commandTypeKey: unique symbol;

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

function toValueConditions(
  conditions: readonly (readonly [string, unknown])[],
): readonly ValueConditionDefinition[] {
  return conditions.map(([source, expected,]) => ({ source, expected }));
}

function conditionalDefaultCollectsValues(
  argument: ArgumentDefinition | undefined,
): boolean {
  return argument !== undefined
    && (argument.kind === 'option' || argument.kind === 'positional')
    && (argument.repeatable || argument.trailingVarArg || argument.maxValues !== 1);
}

function validateValueConditions(
  conditions: readonly ValueConditionDefinition[],
): void {
  const duplicate = conditions.some(
    (condition, index) =>
      conditions.findIndex(
        (candidate) =>
          candidate.source === condition.source
          && Object.is(candidate.expected, condition.expected),
      ) !== index,
  );
  if (duplicate) {
    throw new TypeError('A conditional requirement cannot contain duplicate conditions');
  }
}

function updateGroupRelations(
  groups: readonly GroupDefinition[],
  groupName: string,
  relation: 'requires' | 'conflicts',
  targets: readonly string[],
): readonly GroupDefinition[] {
  const group = groups.find(({ name }) => name === groupName);
  if (group === undefined) {
    throw new TypeError(`Unknown argument group: ${groupName}`);
  }
  const combined = [...group[relation], ...targets];
  if (new Set(combined).size !== combined.length) {
    throw new TypeError(`Group '${groupName}' has duplicate ${relation}`);
  }
  return groups.map((current) => current.name === groupName ? { ...current, [relation]: combined } : current);
}

/** Internal immutable command configurator. */
class Command<
  const Name extends string,
  Fields extends object = EmptyObject,
  Subcommands extends Record<string, unknown> = EmptyObject,
  SubcommandRequired extends boolean = false,
  Groups extends string = never,
> implements CommandType<Name, Fields, Subcommands, SubcommandRequired, Groups> {
  declare readonly [commandTypeKey]: readonly [
    Name,
    Fields,
    Subcommands,
    SubcommandRequired,
    Groups,
  ];

  constructor(definition: CommandDefinition) {
    setCommandDefinition(this, definition);
  }

  private with<
    NextFields extends object = Fields,
    NextSubcommands extends Record<string, unknown> = Subcommands,
    NextRequired extends boolean = SubcommandRequired,
    NextGroups extends string = Groups,
  >(
    patch: Partial<CommandDefinition>,
  ): Command<Name, NextFields, NextSubcommands, NextRequired, NextGroups> {
    return new Command(copyCommand(getCommandDefinition(this), patch));
  }

  /** Sets the short command description shown in help and completion. */
  about(text: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ about: text });
  }

  /** Sets the extended command description shown in full help. */
  longAbout(text: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ longAbout: text });
  }

  /** Sets the author line shown in generated help. */
  author(text: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ author: text });
  }

  /** Adds text before the generated help content. */
  beforeHelp(text: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ beforeHelp: text });
  }

  /** Adds text after the generated help content. */
  afterHelp(text: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ afterHelp: text });
  }

  /** Replaces the generated usage line with exact text. */
  overrideUsage(usage: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ overrideUsage: usage });
  }

  /** Replaces all generated help output with exact text. */
  overrideHelp(help: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ overrideHelp: help });
  }

  /** Adds a parseable alias that is hidden from help and completion. */
  alias(alias: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    validateCommandName(alias);
    const definition = getCommandDefinition(this);
    validateCommandAlias(definition, alias);
    return this.with({
      aliases: [...definition.aliases, { name: alias, visible: false }],
    });
  }

  /** Adds a parseable alias that is shown in help and completion. */
  visibleAlias(alias: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    validateCommandName(alias);
    const definition = getCommandDefinition(this);
    validateCommandAlias(definition, alias);
    return this.with({
      aliases: [...definition.aliases, { name: alias, visible: true }],
    });
  }

  /** Accepts an unambiguous prefix of a subcommand name or alias. */
  inferSubcommands(
    enabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ inferSubcommands: enabled });
  }

  /** Rejects explicit local arguments when a subcommand is selected. */
  argsConflictWithSubcommands(
    enabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ argsConflictWithSubcommands: enabled });
  }

  /** Allows later CLI occurrences of non-repeatable options and ordinary flags to replace earlier values. */
  argsOverrideSelf(
    enabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ argsOverrideSelf: enabled });
  }

  /** Disables the generated `help` subcommand. */
  disableHelpSubcommand(
    disabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ disableHelpSubcommand: disabled });
  }

  /** Disables the generated `-h` and `--help` flags. */
  disableHelpFlag(
    disabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ disableHelpFlag: disabled });
  }

  /** Disables the generated `-V` and `--version` flags. */
  disableVersionFlag(
    disabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ disableVersionFlag: disabled });
  }

  /** Sets the version text printed by `-V` and `--version`. */
  version(version: string): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ version });
  }

  /** Hides this command from parent help and completion while keeping it parseable. */
  hide(hidden = true): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ hidden });
  }

  /** Adds an argument and merges its exact output into the parse result. */
  arg<
    const ArgumentName extends string,
    Value,
    Output,
    const Kind extends ArgumentKind,
    const Cardinality extends ArgumentCardinality,
    const Global extends boolean,
  >(
    argument:
      & ArgumentType<ArgumentName, Value, Output, Kind, Cardinality, Global>
      & (ArgumentName extends keyof Fields ? DuplicateArgument<ArgumentName>
        : unknown),
  ): Command<
    Name,
    Simplify<Fields & Record<ArgumentName, Output>>,
    Subcommands,
    SubcommandRequired,
    Groups
  > {
    const definition = getCommandDefinition(this);
    const argumentDefinition = getArgumentDefinition(argument);
    validateArgument(definition, argumentDefinition);
    return this.with<Simplify<Fields & Record<ArgumentName, Output>>>({
      arguments: [...definition.arguments, argumentDefinition],
    });
  }

  /** Adds a subcommand and creates a discriminated union in result.subcommand. */
  subcommand<
    const ChildName extends string,
    ChildFields extends object,
    ChildSubcommands extends Record<string, unknown>,
    ChildRequired extends boolean,
    ChildGroups extends string,
  >(
    child:
      & CommandType<ChildName, ChildFields, ChildSubcommands, ChildRequired, ChildGroups>
      & (ChildName extends keyof Subcommands ? DuplicateSubcommand<ChildName>
        : unknown),
  ): Command<
    Name,
    Fields,
    Simplify<
      & Subcommands
      & Record<
        ChildName,
        CommandType<ChildName, ChildFields, ChildSubcommands, ChildRequired, ChildGroups>
      >
    >,
    SubcommandRequired,
    Groups
  > {
    const definition = getCommandDefinition(this);
    const childDefinition = getCommandDefinition(child);
    const childNames = new Set([
      childDefinition.name,
      ...childDefinition.aliases.map(({ name }) => name),
    ]);
    if (!definition.disableHelpSubcommand && childNames.has('help')) {
      throw new TypeError(
        'Subcommand name or alias \'help\' conflicts with the generated help subcommand',
      );
    }
    const duplicate = definition.subcommands
      .flatMap((current) => [
        current.name,
        ...current.aliases.map(({ name }) => name),
      ])
      .find((name) => childNames.has(name));
    if (duplicate !== undefined) {
      throw new TypeError(`Duplicate subcommand name or alias: ${duplicate}`);
    }
    return this.with<
      Fields,
      Simplify<
        & Subcommands
        & Record<
          ChildName,
          CommandType<ChildName, ChildFields, ChildSubcommands, ChildRequired, ChildGroups>
        >
      >
    >({ subcommands: [...definition.subcommands, childDefinition] });
  }

  /** Makes result.subcommand non-optional. */
  requireSubcommand(): Command<Name, Fields, Subcommands, true, Groups> {
    return this.with<Fields, Subcommands, true>({ subcommandRequired: true });
  }

  /** Displays help when no argument or subcommand was supplied. */
  argRequiredElseHelp(
    enabled = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ argRequiredElseHelp: enabled });
  }

  /** Requires target when source is present. Names are checked by TypeScript. */
  requires<
    const Source extends StringKeyOf<Fields>,
    const Target extends Exclude<StringKeyOf<Fields>, Source>,
  >(
    source: Source,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const definition = getCommandDefinition(this);
    return this.with({
      requirements: [...definition.requirements, { source, target }],
    });
  }

  /** Requires target when source equals expected. */
  requiresIf<
    const Source extends StringKeyOf<Fields>,
    const Target extends Exclude<StringKeyOf<Fields>, Source>,
  >(
    source: Source,
    expected: RelationValue<Fields[Source]>,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const definition = getCommandDefinition(this);
    return this.with({
      conditionalRequirements: [
        ...definition.conditionalRequirements,
        { source, expected, target },
      ],
    });
  }

  /** Requires target when at least one source equals its expected value. */
  requiredIfAny<
    const Conditions extends readonly [
      FieldCondition<Fields, never>,
      ...FieldCondition<Fields, never>[],
    ],
    const Target extends Exclude<StringKeyOf<Fields>, Conditions[number][0]>,
  >(
    conditions: Conditions,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const valueConditions = toValueConditions(conditions);
    validateValueConditions(valueConditions);
    const definition = getCommandDefinition(this);
    return this.with({
      conditionalSetRequirements: [
        ...definition.conditionalSetRequirements,
        { target, conditions: valueConditions, match: 'any' },
      ],
    });
  }

  /** Requires target when every source equals its expected value. */
  requiredIfAll<
    const Conditions extends readonly [
      FieldCondition<Fields, never>,
      ...FieldCondition<Fields, never>[],
    ],
    const Target extends Exclude<StringKeyOf<Fields>, Conditions[number][0]>,
  >(
    conditions: Conditions,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const valueConditions = toValueConditions(conditions);
    validateValueConditions(valueConditions);
    const definition = getCommandDefinition(this);
    return this.with({
      conditionalSetRequirements: [
        ...definition.conditionalSetRequirements,
        { target, conditions: valueConditions, match: 'all' },
      ],
    });
  }

  /** Requires target unless at least one alternative is present. */
  requiredUnlessPresent<
    const Alternatives extends readonly [
      StringKeyOf<Fields>,
      ...StringKeyOf<Fields>[],
    ],
    const Target extends Exclude<StringKeyOf<Fields>, Alternatives[number]>,
  >(
    alternatives: Alternatives,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    if (new Set(alternatives).size !== alternatives.length) {
      throw new TypeError('A required-unless list cannot contain duplicate arguments');
    }
    const definition = getCommandDefinition(this);
    return this.with({
      requiredUnless: [...definition.requiredUnless, { target, alternatives }],
    });
  }

  /** Requires target unless every listed alternative is present. */
  requiredUnlessAll<
    const Alternatives extends readonly [
      StringKeyOf<Fields>,
      ...StringKeyOf<Fields>[],
    ],
    const Target extends Exclude<StringKeyOf<Fields>, Alternatives[number]>,
  >(
    alternatives: Alternatives,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    if (new Set(alternatives).size !== alternatives.length) {
      throw new TypeError('A required-unless-all list cannot contain duplicate arguments');
    }
    const definition = getCommandDefinition(this);
    return this.with({
      requiredUnlessAll: [
        ...definition.requiredUnlessAll,
        { target, alternatives },
      ],
    });
  }

  /** Clears target whenever source is explicitly provided. */
  overrides<
    const Source extends StringKeyOf<Fields>,
    const Target extends Exclude<StringKeyOf<Fields>, Source>,
  >(
    source: Source,
    target: Target,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const definition = getCommandDefinition(this);
    return this.with({
      overrides: [...definition.overrides, { source, target }],
    });
  }

  /** Makes the listed arguments mutually exclusive. Names are checked by TypeScript. */
  conflicts<
    const First extends StringKeyOf<Fields>,
    const Second extends Exclude<StringKeyOf<Fields>, First>,
    const Rest extends readonly Exclude<StringKeyOf<Fields>, First>[],
  >(
    first: First,
    second: Second,
    ...rest: Rest
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const names: readonly string[] = [first, second, ...rest];
    if (new Set(names).size !== names.length) {
      throw new TypeError('A conflict list cannot contain duplicate arguments');
    }
    const definition = getCommandDefinition(this);
    return this.with({
      conflicts: [...definition.conflicts, names],
    });
  }

  /** Makes each listed argument conflict with every other provided argument. */
  exclusive<
    const First extends StringKeyOf<Fields>,
    const Rest extends readonly Exclude<StringKeyOf<Fields>, First>[],
  >(
    first: First,
    ...rest: Rest
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const names: readonly string[] = [first, ...rest];
    const combined = [...getCommandDefinition(this).exclusiveArguments, ...names];
    if (new Set(combined).size !== combined.length) {
      throw new TypeError('An exclusive argument cannot be registered more than once');
    }
    return this.with({ exclusiveArguments: combined });
  }

  /** Defines a clap-style argument group. Member names are checked by TypeScript. */
  group<
    const GroupName extends string,
    const Members extends readonly StringKeyOf<Fields>[],
  >(
    name: GroupName & (GroupName extends Groups ? DuplicateGroup<GroupName> : unknown),
    members: Members,
    options: GroupOptions = {},
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups | GroupName> {
    if (members.length === 0) {
      throw new TypeError(`Argument group '${name}' must contain a member`);
    }
    if (new Set(members).size !== members.length) {
      throw new TypeError(`Argument group '${name}' has duplicate members`);
    }
    const definition = getCommandDefinition(this);
    if (definition.groups.some((group) => group.name === name)) {
      throw new TypeError(`Duplicate argument group: ${name}`);
    }
    return this.with<Fields, Subcommands, SubcommandRequired, Groups | GroupName>({
      groups: [
        ...definition.groups,
        {
          name,
          members,
          required: options.required ?? false,
          multiple: options.multiple ?? false,
          requires: [],
          conflicts: [],
        },
      ],
    });
  }

  /** Requires arguments whenever any member of a group is present. */
  groupRequires<
    const GroupName extends Groups,
    const Target extends StringKeyOf<Fields>,
    const Rest extends readonly Exclude<StringKeyOf<Fields>, Target>[],
  >(
    groupName: GroupName,
    target: Target,
    ...rest: Rest
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const targets: readonly string[] = [target, ...rest];
    return this.with({
      groups: updateGroupRelations(
        getCommandDefinition(this).groups,
        groupName,
        'requires',
        targets,
      ),
    });
  }

  /** Conflicts with arguments whenever any member of a group is present. */
  groupConflicts<
    const GroupName extends Groups,
    const Target extends StringKeyOf<Fields>,
    const Rest extends readonly Exclude<StringKeyOf<Fields>, Target>[],
  >(
    groupName: GroupName,
    target: Target,
    ...rest: Rest
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const targets: readonly string[] = [target, ...rest];
    return this.with({
      groups: updateGroupRelations(
        getCommandDefinition(this).groups,
        groupName,
        'conflicts',
        targets,
      ),
    });
  }

  /** Attaches a callback with the exact parsed argument type at this point. */
  handler<
    Result extends HandlerResult | PromiseLike<HandlerResult>,
  >(
    handler: (
      args: CommandArguments<Fields, Subcommands, SubcommandRequired>,
      context: HandlerContext,
    ) => Result,
  ): HandledCommand<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ handler });
  }

  /** Parses explicit argv. User-facing failures throw CliError. */
  parse(argv: readonly string[], options: ParseOptions = {}): ParseOutcome<Infer<this>> {
    const definition = getCommandDefinition(this);
    return parseConfigured<Infer<this>>(
      definition,
      argv,
      handlerColorEnabled(),
      options,
    );
  }

  /** Parses argv without exceptions for expected CLI outcomes. */
  tryParse(argv: readonly string[], options: ParseOptions = {}): ParseResult<Infer<this>> {
    const definition = getCommandDefinition(this);
    return tryParseConfigured<Infer<this>>(
      definition,
      argv,
      handlerColorEnabled(),
      options,
    );
  }

  /** Parses argv and runs the deepest configured handler. */
  run(argv?: readonly string[]): Promise<number>;
  run(options?: RunOptions): Promise<number>;
  run(argvOrOptions: readonly string[] | RunOptions = {}): Promise<number> {
    const options: RunOptions = Array.isArray(argvOrOptions)
      ? { argv: argvOrOptions }
      : argvOrOptions as RunOptions;
    const argv = options.argv ?? Bun.argv.slice(2);
    if (Bun.env.KONSTIT_CLI_COMPLETE === '1') {
      return import('./dynamic-completion.js').then(
        ({ runDynamicCompletionRequest }) =>
          runDynamicCompletionRequest(this, {
            argv,
            ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
          }),
      );
    }
    const definition = getCommandDefinition(this);
    return runConfiguredHandler(
      definition,
      tryParseConfigured<Infer<this>>(
        definition,
        argv,
        handlerColorEnabled(options),
        options,
      ),
      options,
    );
  }

  /** Executes a result from this command's parse or tryParse without parsing again. */
  runParsed(
    result: ParseResult<Infer<this>>,
    options: RunParsedOptions = {},
  ): Promise<number> {
    return runConfiguredHandler(getCommandDefinition(this), result, options);
  }

  /** Renders the complete help text for this command. */
  renderHelp(): string {
    const definition = getCommandDefinition(this);
    return renderHelp(definition, [definition.name], []);
  }

  /** Renders the usage line for this command. */
  renderUsage(): string {
    const definition = getCommandDefinition(this);
    return renderUsageText(definition, [definition.name], []);
  }
}

type FieldsFromArguments<Arguments extends readonly AnyArgument[]> = Simplify<
  {
    [Value in Arguments[number] as ArgumentName<Value>]: ArgumentOutput<Value>;
  }
>;

type CommandName<Value extends AnyCommand> = Value extends CommandType<infer Name> ? Name : never;

type SubcommandsFromTuple<Subcommands extends readonly AnyCommand[]> = Simplify<
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

/** Requires an argument when another argument matches an expected value. */
type ConditionalArgumentRelation<Fields extends object> = {
  [Source in StringKeyOf<Fields>]: readonly [
    /** The argument whose value is checked. */
    source: Source,
    /** The expected source value or collection item. */
    expected: RelationValue<Fields[Source]>,
    /** The argument required when the source matches. */
    target: Exclude<StringKeyOf<Fields>, Source>,
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

type GroupNamesFromTuple<
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
      : [Name] extends [Seen] ? DuplicateArgument<Name>
      : UniqueArguments<Rest, Seen | Name>
    : unknown
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
  readonly examples?: readonly CommandExample[];
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
  /** Hides this command from parent help and completion. */
  readonly hide?: boolean;
  /** Requires a target whenever its source is present. */
  readonly requires?: readonly BinaryArgumentRelation<
    FieldsFromArguments<Arguments>
  >[];
  /** Requires a target whenever its source equals an expected value. */
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
  /** Makes each listed argument conflict with all other supplied arguments. */
  readonly exclusive?: NonEmptyTuple<
    StringKeyOf<FieldsFromArguments<Arguments>>
  >;
  /** Defines clap-style argument groups and their relations. */
  readonly groups?: Groups;
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

/** Command options with compile-time checks for uniqueness and group membership. */
type CheckedCommandOptions<
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
    /** Arguments in declaration order, with unique names. */
    readonly args?: Arguments & UniqueArguments<Arguments>;
    /** Subcommands in declaration order, with unique names. */
    readonly subcommands?: Subcommands & UniqueSubcommands<Subcommands>;
    /** Requires selecting one of the configured subcommands. */
    readonly subcommandRequired?: SubcommandRequired;
    /** Named argument groups and their dependency and conflict rules. */
    readonly groups?: Groups & CheckedGroups<Groups>;
  };

function emptyCommand<const Name extends string>(
  name: Name,
): Command<Name> {
  validateCommandName(name);
  return new Command(Object.freeze({
    name,
    aliases: Object.freeze([]),
    arguments: Object.freeze([]),
    subcommands: Object.freeze([]),
    requirements: Object.freeze([]),
    conditionalRequirements: Object.freeze([]),
    requiresValue: Object.freeze([]),
    conditionalSetRequirements: Object.freeze([]),
    requiredUnless: Object.freeze([]),
    requiredUnlessAll: Object.freeze([]),
    defaultIf: Object.freeze([]),
    exclusiveArguments: Object.freeze([]),
    overrides: Object.freeze([]),
    conflicts: Object.freeze([]),
    groups: Object.freeze([]),
    subcommandRequired: false,
    argsConflictWithSubcommands: false,
    argsOverrideSelf: false,
    argRequiredElseHelp: false,
    inferSubcommands: false,
    disableHelpSubcommand: false,
    disableHelpFlag: false,
    disableVersionFlag: false,
    hidden: false,
  }));
}

/** Starts an immutable command definition. */
export function command<const Name extends string>(
  name: Name,
): HandledCommand<Name, EmptyObject, EmptyObject, false, never>;
/** Starts an immutable command definition from tuple-based options. */
export function command<
  const Name extends string,
  const Arguments extends readonly AnyArgument[] = readonly [],
  const Subcommands extends readonly AnyCommand[] = readonly [],
  const SubcommandRequired extends boolean = false,
  const Groups extends readonly CommandGroupOptions<
    string,
    StringKeyOf<FieldsFromArguments<Arguments>>
  >[] = readonly [],
>(
  name: Name,
  options: CheckedCommandOptions<
    Arguments,
    Subcommands,
    SubcommandRequired,
    Groups
  >,
): HandledCommand<
  Name,
  FieldsFromArguments<Arguments>,
  SubcommandsFromTuple<Subcommands>,
  SubcommandRequired,
  GroupNamesFromTuple<Groups>
>;
export function command(
  name: string,
  options: CommandOptions<
    readonly AnyArgument[],
    readonly AnyCommand[],
    boolean,
    readonly CommandGroupOptions<string, string>[]
  > = {},
): HandledCommand {
  validateCommandOptions(options);
  let configured = emptyCommand(name);
  if (options.deprecated !== undefined || options.deprecatedAliases !== undefined) {
    configured = new Command(copyCommand(getCommandDefinition(configured), {
      ...(options.deprecated === undefined ? {} : { deprecated: options.deprecated }),
      ...(options.deprecatedAliases === undefined ? {} : {
        deprecatedAliases: Object.freeze({ ...options.deprecatedAliases }),
      }),
    }));
  }
  if (options.about !== undefined) {
    configured = configured.about(options.about);
  }
  if (options.longAbout !== undefined) {
    configured = configured.longAbout(options.longAbout);
  }
  if (options.author !== undefined) {
    configured = configured.author(options.author);
  }
  if (options.beforeHelp !== undefined) {
    configured = configured.beforeHelp(options.beforeHelp);
  }
  if (options.afterHelp !== undefined) {
    configured = configured.afterHelp(options.afterHelp);
  }
  if (options.examples !== undefined && options.examples.length > 0) {
    configured = new Command(copyCommand(getCommandDefinition(configured), {
      examples: Object.freeze(options.examples.map(({ command, description }) => Object.freeze({ command, description }))),
    }));
  }
  if (options.overrideUsage !== undefined) {
    configured = configured.overrideUsage(options.overrideUsage);
  }
  if (options.overrideHelp !== undefined) {
    configured = configured.overrideHelp(options.overrideHelp);
  }
  if (options.disableHelpSubcommand !== undefined) {
    configured = configured.disableHelpSubcommand(options.disableHelpSubcommand);
  }
  if (options.disableHelpFlag !== undefined) {
    configured = configured.disableHelpFlag(options.disableHelpFlag);
  }
  if (options.disableVersionFlag !== undefined) {
    configured = configured.disableVersionFlag(options.disableVersionFlag);
  }
  if (options.version !== undefined) {
    configured = configured.version(options.version);
  }
  for (const alias of options.visibleAliases ?? []) {
    configured = configured.visibleAlias(alias);
  }
  for (const alias of options.aliases ?? []) {
    configured = configured.alias(alias);
  }
  for (const argument of options.args ?? []) {
    configured = configured.arg(argument as never);
  }
  for (const subcommand of options.subcommands ?? []) {
    configured = configured.subcommand(subcommand);
  }
  if (options.inferSubcommands !== undefined) {
    configured = configured.inferSubcommands(options.inferSubcommands);
  }
  if (options.argsConflictWithSubcommands !== undefined) {
    configured = configured.argsConflictWithSubcommands(options.argsConflictWithSubcommands);
  }
  if (options.argsOverrideSelf !== undefined) {
    configured = configured.argsOverrideSelf(options.argsOverrideSelf);
  }
  if (options.subcommandRequired === true) {
    configured = configured.requireSubcommand() as unknown as typeof configured;
  }
  if (options.defaultToHelp !== undefined) {
    configured = configured.argRequiredElseHelp(options.defaultToHelp);
  }
  if (options.hide !== undefined) {
    configured = configured.hide(options.hide);
  }

  validateCommandRelations(options, getCommandDefinition(configured));
  if (options.requiresValue !== undefined) {
    configured = new Command(copyCommand(getCommandDefinition(configured), {
      requiresValue: options.requiresValue.map(([source, target, expected,]) => ({ source, target, expected })),
    }));
  }
  if (options.defaultIf !== undefined) {
    const defaultIf = options.defaultIf as readonly {
      readonly source: string;
      readonly equals?: unknown;
      readonly target: string;
      readonly value: unknown;
    }[];
    const currentDefinition = getCommandDefinition(configured);
    const argumentsByName = new Map(
      currentDefinition.arguments.map((argument) => [argument.name, argument]),
    );
    configured = new Command(copyCommand(currentDefinition, {
      defaultIf: Object.freeze(defaultIf.map((rule) =>
        Object.freeze({
          source: rule.source,
          ...(Object.hasOwn(rule, 'equals') ? { equals: rule.equals } : {}),
          target: rule.target,
          value: conditionalDefaultCollectsValues(argumentsByName.get(rule.target))
              && Array.isArray(rule.value)
            ? Object.freeze([...rule.value])
            : rule.value,
          hasEquals: Object.hasOwn(rule, 'equals'),
        })
      )),
    })) as unknown as typeof configured;
  }

  for (const [source, target,] of options.requires ?? []) {
    configured = configured.requires(source as never, target as never);
  }
  for (const [source, expected, target,] of options.requiresIf ?? []) {
    configured = configured.requiresIf(
      source as never,
      expected as never,
      target as never,
    );
  }
  for (const { conditions, target } of options.requiredIfAny ?? []) {
    configured = configured.requiredIfAny(conditions as never, target as never);
  }
  for (const { conditions, target } of options.requiredIfAll ?? []) {
    configured = configured.requiredIfAll(conditions as never, target as never);
  }
  for (const { alternatives, target } of options.requiredUnlessPresent ?? []) {
    configured = configured.requiredUnlessPresent(
      alternatives as never,
      target as never,
    );
  }
  for (const { alternatives, target } of options.requiredUnlessAll ?? []) {
    configured = configured.requiredUnlessAll(
      alternatives as never,
      target as never,
    );
  }
  for (const [source, target,] of options.overrides ?? []) {
    configured = configured.overrides(source as never, target as never);
  }
  for (const conflict of options.conflicts ?? []) {
    const [first, second, ...rest] = conflict;
    configured = configured.conflicts(
      first as never,
      second as never,
      ...rest as never,
    );
  }
  if (options.exclusive !== undefined) {
    const [first, ...rest] = options.exclusive;
    configured = configured.exclusive(first as never, ...rest as never);
  }
  for (const group of options.groups ?? []) {
    configured = configured.group(
      group.name,
      group.members as never,
      {
        ...(group.required === undefined ? {} : { required: group.required }),
        ...(group.multiple === undefined ? {} : { multiple: group.multiple }),
      },
    ) as unknown as typeof configured;
    if (group.requires !== undefined && group.requires.length > 0) {
      const [first, ...rest] = group.requires;
      configured = configured.groupRequires(
        group.name as never,
        first as never,
        ...rest as never,
      );
    }
    if (group.conflicts !== undefined && group.conflicts.length > 0) {
      const [first, ...rest] = group.conflicts;
      configured = configured.groupConflicts(
        group.name as never,
        first as never,
        ...rest as never,
      );
    }
  }
  if (options.validate !== undefined) {
    configured = new Command(copyCommand(getCommandDefinition(configured), { validate: options.validate }));
  }
  if (options.handler !== undefined) {
    return terminalCommand(configured.handler(options.handler as never));
  }
  return terminalCommand(configured);
}

interface InternalTerminalCommand {
  parse(argv: readonly string[], options?: ParseOptions): ParseOutcome<unknown>;
  tryParse(argv: readonly string[], options?: ParseOptions): ParseResult<unknown>;
  run(argv?: readonly string[]): Promise<number>;
  run(options?: RunOptions): Promise<number>;
  runParsed(result: ParseResult<unknown>, options?: RunParsedOptions): Promise<number>;
  renderHelp(): string;
  renderUsage(): string;
}

function terminalCommand(configured: InternalTerminalCommand): HandledCommand {
  const terminal = Object.freeze({
    parse: (argv: readonly string[], options?: ParseOptions) => configured.parse(argv, options),
    tryParse: (argv: readonly string[], options?: ParseOptions) => configured.tryParse(argv, options),
    run: (argvOrOptions?: readonly string[] | RunOptions) =>
      Array.isArray(argvOrOptions)
        ? configured.run(argvOrOptions)
        : configured.run((argvOrOptions ?? {}) as RunOptions),
    runParsed: (result: ParseResult<unknown>, options?: RunParsedOptions) => configured.runParsed(result, options),
    renderHelp: () => configured.renderHelp(),
    renderUsage: () => configured.renderUsage(),
  });
  setCommandDefinition(
    terminal,
    getCommandDefinition(configured as unknown as CommandType),
  );
  return terminal as unknown as HandledCommand;
}

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
  /** Overrides parse-failure exit codes with an integer from 1 to 255. Defaults to CliError.exitCode (2). */
  readonly parseErrorExitCode?: number;
}

/** Options for parsing argv and handling the result in one call. */
export interface RunOptions extends RunParsedOptions {
  /** Arguments to parse. Defaults to `Bun.argv.slice(2)`. */
  readonly argv?: readonly string[];
  /** Controls ANSI styling and the automatic color-flag value. */
  readonly color?: boolean;
  /** Caller supplied values used below CLI and environment values. */
  readonly config?: CommandConfig;
}
