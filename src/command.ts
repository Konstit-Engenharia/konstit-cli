import {
  ArgumentAction,
  getArgumentDefinition,
  type AnyArgument,
  type AnyGlobalArgument,
  type ArgumentCardinality,
  type ArgumentDefinition,
  type ArgumentKind,
  type ArgumentName,
  type ArgumentOutput,
  type ArgumentType,
} from './argument';
import {
  CliError,
  DisplayKind,
  ErrorKind,
  type ParseDisplay,
  type ParseOutcome,
  type ParseResult,
} from './error';
import { parsers } from './parser';

class DisplayRequest {
  constructor(readonly outcome: ParseDisplay) {}
}

interface RequirementDefinition {
  readonly source: string;
  readonly target: string;
}

interface ConditionalRequirementDefinition extends RequirementDefinition {
  readonly expected: unknown;
}

interface ValueConditionDefinition {
  readonly source: string;
  readonly expected: unknown;
}

interface ConditionalSetRequirementDefinition {
  readonly target: string;
  readonly conditions: readonly ValueConditionDefinition[];
  readonly match: 'any' | 'all';
}

interface RequiredUnlessDefinition {
  readonly target: string;
  readonly alternatives: readonly string[];
}

interface OverrideDefinition extends RequirementDefinition {}

interface CommandAliasDefinition {
  readonly name: string;
  readonly visible: boolean;
}

interface GroupDefinition {
  readonly name: string;
  readonly members: readonly string[];
  readonly required: boolean;
  readonly multiple: boolean;
  readonly requires: readonly string[];
  readonly conflicts: readonly string[];
}

interface GroupOptions {
  /** At least one member must be present. */
  readonly required?: boolean;
  /** More than one member can be present. The default is false. */
  readonly multiple?: boolean;
}

// biome-ignore lint/suspicious/noConfusingVoidType: Handlers intentionally support callbacks with no return value.
export type HandlerResult = void | number;

/** Runtime data available to every command handler. */
export interface HandlerContext {
  /** The selected command path, from the root command to the handler. */
  readonly commandPath: readonly string[];
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

export interface CommandDefinition {
  readonly name: string;
  readonly aliases: readonly CommandAliasDefinition[];
  readonly about?: string;
  readonly longAbout?: string;
  readonly author?: string;
  readonly beforeHelp?: string;
  readonly afterHelp?: string;
  readonly overrideUsage?: string;
  readonly overrideHelp?: string;
  readonly version?: string;
  readonly handler?: CommandHandler<never>;
  readonly arguments: readonly ArgumentDefinition[];
  readonly subcommands: readonly CommandDefinition[];
  readonly requirements: readonly RequirementDefinition[];
  readonly conditionalRequirements: readonly ConditionalRequirementDefinition[];
  readonly conditionalSetRequirements: readonly ConditionalSetRequirementDefinition[];
  readonly requiredUnless: readonly RequiredUnlessDefinition[];
  readonly requiredUnlessAll: readonly RequiredUnlessDefinition[];
  readonly exclusiveArguments: readonly string[];
  readonly overrides: readonly OverrideDefinition[];
  readonly conflicts: readonly (readonly string[])[];
  readonly groups: readonly GroupDefinition[];
  readonly subcommandRequired: boolean;
  readonly argRequiredElseHelp: boolean;
  readonly inferSubcommands: boolean;
  readonly disableHelpSubcommand: boolean;
  readonly disableHelpFlag: boolean;
  readonly disableVersionFlag: boolean;
  readonly hidden: boolean;
}

type Simplify<Value> = { [Key in keyof Value]: Value[Key]; } & {};
type StringKeyOf<Value> = Extract<keyof Value, string>;
type RelationValue<Value> = Exclude<Value, undefined> extends readonly (infer Item)[] ? Item
  : Exclude<Value, undefined>;

type FieldCondition<
  Fields extends object,
  Excluded extends StringKeyOf<Fields>,
> = {
  [Source in Exclude<StringKeyOf<Fields>, Excluded>]: readonly [
    source: Source,
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

type ParsedSubcommand<Subcommands extends Record<string, unknown>> = {
  [Name in StringKeyOf<Subcommands>]: Subcommands[Name] extends AnyCommand ? {
      readonly name: Name;
      readonly args: Infer<Subcommands[Name]>;
    }
    : never;
}[StringKeyOf<Subcommands>];

type SubcommandField<
  Subcommands extends Record<string, unknown>,
  Required extends boolean,
> = StringKeyOf<Subcommands> extends never ? EmptyObject
  : {
    readonly subcommand: Required extends true ? ParsedSubcommand<Subcommands>
      : ParsedSubcommand<Subcommands> | undefined;
  };

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
  readonly [commandTypeKey]: readonly [
    Name,
    Fields,
    Subcommands,
    SubcommandRequired,
    Groups,
  ];
}

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
  parse(argv: readonly string[]): ParseOutcome<Infer<this>>;
  /** Parses argv without exceptions for expected CLI outcomes. */
  tryParse(argv: readonly string[]): ParseResult<Infer<this>>;
  /** Parses argv and runs the deepest configured handler. */
  run(argv?: readonly string[]): Promise<number>;
  /** Parses configured argv and runs the deepest configured handler. */
  run(options?: RunOptions): Promise<number>;
  /** Renders the complete help text for this command. */
  renderHelp(): string;
  /** Renders the usage line for this command. */
  renderUsage(): string;
}

/** Gets the exact result returned by a configured Command. */
export type Infer<ConfiguredCommand extends AnyCommand> = ConfiguredCommand extends CommandType<
  infer _Name,
  infer Fields,
  infer Subcommands,
  infer Required,
  infer _Groups
> ? CommandArguments<Fields, Subcommands, Required>
  : never;

const commandDefinitions = new WeakMap<object, CommandDefinition>();

/** Gets the runtime definition for internal parser and completion code. */
export function getCommandDefinition(command: CommandType): CommandDefinition {
  const definition = commandDefinitions.get(command);
  if (definition === undefined) {
    throw new TypeError('Expected a command created by command()');
  }
  return definition;
}

function copyCommand(
  definition: CommandDefinition,
  patch: Partial<CommandDefinition>,
): CommandDefinition {
  const merged = { ...definition, ...patch };
  const copied = Object.freeze({
    ...merged,
    aliases: Object.freeze(
      merged.aliases.map((alias) => Object.freeze({ ...alias })),
    ),
    arguments: Object.freeze([...merged.arguments]),
    subcommands: Object.freeze([...merged.subcommands]),
    requirements: Object.freeze(
      merged.requirements.map((requirement) => Object.freeze({ ...requirement })),
    ),
    conditionalRequirements: Object.freeze(
      merged.conditionalRequirements.map((requirement) => Object.freeze({ ...requirement })),
    ),
    conditionalSetRequirements: Object.freeze(
      merged.conditionalSetRequirements.map((requirement) =>
        Object.freeze({
          ...requirement,
          conditions: Object.freeze(
            requirement.conditions.map((condition) => Object.freeze({ ...condition })),
          ),
        })
      ),
    ),
    requiredUnless: Object.freeze(
      merged.requiredUnless.map((requirement) =>
        Object.freeze({
          ...requirement,
          alternatives: Object.freeze([...requirement.alternatives]),
        })
      ),
    ),
    requiredUnlessAll: Object.freeze(
      merged.requiredUnlessAll.map((requirement) =>
        Object.freeze({
          ...requirement,
          alternatives: Object.freeze([...requirement.alternatives]),
        })
      ),
    ),
    exclusiveArguments: Object.freeze([...merged.exclusiveArguments]),
    overrides: Object.freeze(
      merged.overrides.map((override) => Object.freeze({ ...override })),
    ),
    conflicts: Object.freeze(
      merged.conflicts.map((conflict) => Object.freeze([...conflict])),
    ),
    groups: Object.freeze(
      merged.groups.map((group) =>
        Object.freeze({
          ...group,
          members: Object.freeze([...group.members]),
          requires: Object.freeze([...group.requires]),
          conflicts: Object.freeze([...group.conflicts]),
        })
      ),
    ),
  });
  validateBuiltInCollisions(copied, []);
  return copied;
}

function toValueConditions(
  conditions: readonly (readonly [string, unknown])[],
): readonly ValueConditionDefinition[] {
  return conditions.map(([source, expected,]) => ({ source, expected }));
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
    commandDefinitions.set(this, definition);
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
  parse(argv: readonly string[]): ParseOutcome<Infer<this>> {
    try {
      const definition = getCommandDefinition(this);
      const value = parseDefinition(
        definition,
        [...argv],
        [definition.name],
        [],
      ) as Infer<this>;
      return { ok: true, type: 'value', value };
    } catch (error) {
      if (error instanceof DisplayRequest) {
        return error.outcome;
      }
      throw error;
    }
  }

  /** Parses argv without exceptions for expected CLI outcomes. */
  tryParse(argv: readonly string[]): ParseResult<Infer<this>> {
    try {
      return this.parse(argv);
    } catch (error) {
      if (error instanceof CliError) {
        return { ok: false, type: 'error', error };
      }
      throw error;
    }
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
      return import('./dynamic-completion').then(
        ({ runDynamicCompletionRequest }) =>
          runDynamicCompletionRequest(this, {
            argv,
            ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
          }),
      );
    }
    return runConfiguredHandler(getCommandDefinition(this), this.tryParse(argv), options);
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

type BinaryArgumentRelation<Fields extends object> = {
  [Source in StringKeyOf<Fields>]: readonly [
    source: Source,
    target: Exclude<StringKeyOf<Fields>, Source>,
  ];
}[StringKeyOf<Fields>];

type ConditionalArgumentRelation<Fields extends object> = {
  [Source in StringKeyOf<Fields>]: readonly [
    source: Source,
    expected: RelationValue<Fields[Source]>,
    target: Exclude<StringKeyOf<Fields>, Source>,
  ];
}[StringKeyOf<Fields>];

type ConditionalSetRelation<Fields extends object> = {
  [Target in StringKeyOf<Fields>]: {
    readonly conditions: NonEmptyTuple<FieldCondition<Fields, Target>>;
    readonly target: Target;
  };
}[StringKeyOf<Fields>];

type RequiredUnlessRelation<Fields extends object> = {
  [Target in StringKeyOf<Fields>]: {
    readonly alternatives: NonEmptyTuple<
      Exclude<StringKeyOf<Fields>, Target>
    >;
    readonly target: Target;
  };
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
  /** Attaches a callback with the exact configured argument type. */
  readonly handler?: CommandHandler<
    CommandArguments<
      FieldsFromArguments<Arguments>,
      SubcommandsFromTuple<Subcommands>,
      SubcommandRequired
    >
  >;
}

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
    readonly args?: Arguments & UniqueArguments<Arguments>;
    readonly subcommands?: Subcommands & UniqueSubcommands<Subcommands>;
    readonly subcommandRequired?: SubcommandRequired;
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
    conditionalSetRequirements: Object.freeze([]),
    requiredUnless: Object.freeze([]),
    requiredUnlessAll: Object.freeze([]),
    exclusiveArguments: Object.freeze([]),
    overrides: Object.freeze([]),
    conflicts: Object.freeze([]),
    groups: Object.freeze([]),
    subcommandRequired: false,
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
  if (options.handler !== undefined) {
    return terminalCommand(configured.handler(options.handler as never));
  }
  return terminalCommand(configured);
}

interface InternalTerminalCommand {
  parse(argv: readonly string[]): ParseOutcome<unknown>;
  tryParse(argv: readonly string[]): ParseResult<unknown>;
  run(argv?: readonly string[]): Promise<number>;
  run(options?: RunOptions): Promise<number>;
  renderHelp(): string;
  renderUsage(): string;
}

function terminalCommand(configured: InternalTerminalCommand): HandledCommand {
  const terminal = Object.freeze({
    parse: (argv: readonly string[]) => configured.parse(argv),
    tryParse: (argv: readonly string[]) => configured.tryParse(argv),
    run: (argvOrOptions?: readonly string[] | RunOptions) =>
      Array.isArray(argvOrOptions)
        ? configured.run(argvOrOptions)
        : configured.run((argvOrOptions ?? {}) as RunOptions),
    renderHelp: () => configured.renderHelp(),
    renderUsage: () => configured.renderUsage(),
  });
  commandDefinitions.set(
    terminal,
    getCommandDefinition(configured as unknown as CommandType),
  );
  return terminal as unknown as HandledCommand;
}

const commandOptionKeys = new Set([
  'version',
  'about',
  'longAbout',
  'author',
  'beforeHelp',
  'afterHelp',
  'overrideUsage',
  'overrideHelp',
  'aliases',
  'visibleAliases',
  'args',
  'subcommands',
  'inferSubcommands',
  'subcommandRequired',
  'defaultToHelp',
  'disableHelpSubcommand',
  'disableHelpFlag',
  'disableVersionFlag',
  'hide',
  'requires',
  'requiresIf',
  'requiredIfAny',
  'requiredIfAll',
  'requiredUnlessPresent',
  'requiredUnlessAll',
  'overrides',
  'conflicts',
  'exclusive',
  'groups',
  'handler',
]);

const commandStringOptionKeys = [
  'version',
  'about',
  'longAbout',
  'author',
  'beforeHelp',
  'afterHelp',
  'overrideUsage',
  'overrideHelp',
] as const;

const commandBooleanOptionKeys = [
  'inferSubcommands',
  'subcommandRequired',
  'defaultToHelp',
  'disableHelpSubcommand',
  'disableHelpFlag',
  'disableVersionFlag',
  'hide',
] as const;

const conditionalSetKeys = new Set(['conditions', 'target']);
const requiredUnlessKeys = new Set(['alternatives', 'target']);
const commandGroupKeys = new Set([
  'name',
  'members',
  'required',
  'multiple',
  'requires',
  'conflicts',
]);

function validateClosedObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  context: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const unsupported = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupported !== undefined) {
    throw new TypeError(`${context} contains unsupported field '${unsupported}'`);
  }
}

function validateOptionalString(
  options: Record<string, unknown>,
  key: string,
): void {
  const value = options[key];
  if (value !== undefined && typeof value !== 'string') {
    throw new TypeError(`Command option '${key}' must be a string`);
  }
}

function validateOptionalBoolean(
  options: Record<string, unknown>,
  key: string,
): void {
  const value = options[key];
  if (value !== undefined && typeof value !== 'boolean') {
    throw new TypeError(`Command option '${key}' must be a boolean`);
  }
}

function validateArray(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array`);
  }
  return value;
}

function validateStringArray(
  value: unknown,
  context: string,
  minimum = 0,
): readonly string[] {
  const values = validateArray(value, context);
  if (values.length < minimum) {
    throw new TypeError(`${context} must contain at least ${minimum} value(s)`);
  }
  if (values.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${context} must contain only argument names`);
  }
  return values as readonly string[];
}

function validateTuple(
  value: unknown,
  length: number,
  context: string,
): readonly unknown[] {
  const tuple = validateArray(value, context);
  if (tuple.length !== length) {
    throw new TypeError(`${context} must contain exactly ${length} values`);
  }
  return tuple;
}

function validateBinaryRelations(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    const tuple = validateTuple(relation, 2, `${context} entry`);
    if (typeof tuple[0] !== 'string' || typeof tuple[1] !== 'string') {
      throw new TypeError(`${context} entries must contain argument names`);
    }
  }
}

function validateConditionalRelations(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    const tuple = validateTuple(relation, 3, `${context} entry`);
    if (typeof tuple[0] !== 'string' || typeof tuple[2] !== 'string') {
      throw new TypeError(`${context} entries must contain argument names`);
    }
  }
}

function validateConditions(value: unknown, context: string): void {
  const conditions = validateArray(value, context);
  if (conditions.length === 0) {
    throw new TypeError(`${context} must contain a condition`);
  }
  for (const condition of conditions) {
    const tuple = validateTuple(condition, 2, `${context} entry`);
    if (typeof tuple[0] !== 'string') {
      throw new TypeError(`${context} entries must start with an argument name`);
    }
  }
}

function validateConditionalSets(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    validateClosedObject(relation, conditionalSetKeys, `${context} entry`);
    validateConditions(relation.conditions, `${context} conditions`);
    if (typeof relation.target !== 'string') {
      throw new TypeError(`${context} target must be an argument name`);
    }
  }
}

function validateRequiredUnless(value: unknown, context: string): void {
  for (const relation of validateArray(value, context)) {
    validateClosedObject(relation, requiredUnlessKeys, `${context} entry`);
    validateStringArray(
      relation.alternatives,
      `${context} alternatives`,
      1,
    );
    if (typeof relation.target !== 'string') {
      throw new TypeError(`${context} target must be an argument name`);
    }
  }
}

function validateConflictSets(value: unknown): void {
  for (const conflict of validateArray(value, 'Command option \'conflicts\'')) {
    validateStringArray(conflict, 'Command option \'conflicts\' entry', 2);
  }
}

function validateGroups(value: unknown): void {
  for (const group of validateArray(value, 'Command option \'groups\'')) {
    validateClosedObject(group, commandGroupKeys, 'Command group');
    if (typeof group.name !== 'string') {
      throw new TypeError('Command group name must be a string');
    }
    validateStringArray(group.members, `Argument group '${group.name}' members`, 1);
    if (group.required !== undefined && typeof group.required !== 'boolean') {
      throw new TypeError(`Argument group '${group.name}' required must be a boolean`);
    }
    if (group.multiple !== undefined && typeof group.multiple !== 'boolean') {
      throw new TypeError(`Argument group '${group.name}' multiple must be a boolean`);
    }
    if (group.requires !== undefined) {
      validateStringArray(group.requires, `Argument group '${group.name}' requirements`);
    }
    if (group.conflicts !== undefined) {
      validateStringArray(group.conflicts, `Argument group '${group.name}' conflicts`);
    }
  }
}

function validateCommandOptions(options: unknown): void {
  validateClosedObject(options, commandOptionKeys, 'Command configuration');
  for (const key of commandStringOptionKeys) {
    validateOptionalString(options, key);
  }
  for (const key of commandBooleanOptionKeys) {
    validateOptionalBoolean(options, key);
  }
  for (const key of ['aliases', 'visibleAliases'] as const) {
    if (options[key] !== undefined) {
      validateStringArray(options[key], `Command option '${key}'`);
    }
  }
  for (const key of ['args', 'subcommands'] as const) {
    if (options[key] !== undefined) {
      validateArray(options[key], `Command option '${key}'`);
    }
  }
  if (
    options.subcommandRequired === true
    && (options.subcommands === undefined
      || (options.subcommands as readonly unknown[]).length === 0)
  ) {
    throw new TypeError(
      'A command with subcommandRequired enabled must define at least one subcommand',
    );
  }
  if (options.requires !== undefined) {
    validateBinaryRelations(options.requires, 'Command option \'requires\'');
  }
  if (options.requiresIf !== undefined) {
    validateConditionalRelations(options.requiresIf, 'Command option \'requiresIf\'');
  }
  if (options.requiredIfAny !== undefined) {
    validateConditionalSets(options.requiredIfAny, 'Command option \'requiredIfAny\'');
  }
  if (options.requiredIfAll !== undefined) {
    validateConditionalSets(options.requiredIfAll, 'Command option \'requiredIfAll\'');
  }
  if (options.requiredUnlessPresent !== undefined) {
    validateRequiredUnless(
      options.requiredUnlessPresent,
      'Command option \'requiredUnlessPresent\'',
    );
  }
  if (options.requiredUnlessAll !== undefined) {
    validateRequiredUnless(
      options.requiredUnlessAll,
      'Command option \'requiredUnlessAll\'',
    );
  }
  if (options.overrides !== undefined) {
    validateBinaryRelations(options.overrides, 'Command option \'overrides\'');
  }
  if (options.conflicts !== undefined) {
    validateConflictSets(options.conflicts);
  }
  if (options.exclusive !== undefined) {
    validateStringArray(options.exclusive, 'Command option \'exclusive\'', 1);
  }
  if (options.groups !== undefined) {
    validateGroups(options.groups);
  }
  if (options.handler !== undefined && typeof options.handler !== 'function') {
    throw new TypeError('Command option \'handler\' must be a function');
  }
}

function validateArgumentReference(
  names: ReadonlySet<string>,
  name: string,
  context: string,
): void {
  if (!names.has(name)) {
    throw new TypeError(`${context} references unknown argument '${name}'`);
  }
}

function validateDistinctRelation(
  names: ReadonlySet<string>,
  source: string,
  target: string,
  context: string,
): void {
  validateArgumentReference(names, source, context);
  validateArgumentReference(names, target, context);
  if (source === target) {
    throw new TypeError(`${context} cannot target its source argument '${source}'`);
  }
}

function validateNoDuplicateNames(values: readonly string[], context: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${context} cannot contain duplicate arguments`);
  }
}

interface RuntimeConditionalSetRelation {
  readonly conditions: readonly (readonly [string, unknown])[];
  readonly target: string;
}

function validateCommandRelations(
  options: CommandOptions<
    readonly AnyArgument[],
    readonly AnyCommand[],
    boolean,
    readonly CommandGroupOptions<string, string>[]
  >,
  definition: CommandDefinition,
): void {
  const names = new Set(definition.arguments.map(({ name }) => name));
  for (const [source, target,] of options.requires ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requires\'');
  }
  for (const [source, , target,] of options.requiresIf ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'requiresIf\'');
  }
  for (
    const { conditions, target } of (options.requiredIfAny ?? []) as readonly RuntimeConditionalSetRelation[]
  ) {
    const context = 'Command option \'requiredIfAny\'';
    validateArgumentReference(names, target, context);
    for (const [source,] of conditions) {
      validateDistinctRelation(names, source, target, context);
    }
  }
  for (
    const { conditions, target } of (options.requiredIfAll ?? []) as readonly RuntimeConditionalSetRelation[]
  ) {
    const context = 'Command option \'requiredIfAll\'';
    validateArgumentReference(names, target, context);
    for (const [source,] of conditions) {
      validateDistinctRelation(names, source, target, context);
    }
  }
  for (
    const [context, relations,] of [
      ['Command option \'requiredUnlessPresent\'', options.requiredUnlessPresent],
      ['Command option \'requiredUnlessAll\'', options.requiredUnlessAll],
    ] as const
  ) {
    for (const { alternatives, target } of relations ?? []) {
      validateArgumentReference(names, target, context);
      validateNoDuplicateNames(alternatives, context);
      for (const alternative of alternatives) {
        validateDistinctRelation(names, alternative, target, context);
      }
    }
  }
  for (const [source, target,] of options.overrides ?? []) {
    validateDistinctRelation(names, source, target, 'Command option \'overrides\'');
  }
  for (const conflict of options.conflicts ?? []) {
    validateNoDuplicateNames(conflict, 'Command option \'conflicts\'');
    for (const name of conflict) {
      validateArgumentReference(names, name, 'Command option \'conflicts\'');
    }
  }
  if (options.exclusive !== undefined) {
    validateNoDuplicateNames(options.exclusive, 'Command option \'exclusive\'');
    for (const name of options.exclusive) {
      validateArgumentReference(names, name, 'Command option \'exclusive\'');
    }
  }
  for (const group of options.groups ?? []) {
    validateNoDuplicateNames(group.members, `Argument group '${group.name}'`);
    for (const member of group.members) {
      validateArgumentReference(names, member, `Argument group '${group.name}'`);
    }
    for (const target of group.requires ?? []) {
      validateArgumentReference(
        names,
        target,
        `Argument group '${group.name}' requirements`,
      );
    }
    for (const target of group.conflicts ?? []) {
      validateArgumentReference(
        names,
        target,
        `Argument group '${group.name}' conflicts`,
      );
    }
  }
}

function validateCommandName(name: unknown): void {
  if (typeof name !== 'string') {
    throw new TypeError('Invalid command name: expected a string');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new TypeError(`Invalid command name: ${JSON.stringify(name)}`);
  }
}

function validateCommandAlias(definition: CommandDefinition, alias: string): void {
  if (alias === definition.name || definition.aliases.some(({ name }) => name === alias)) {
    throw new TypeError(`Duplicate command alias: ${alias}`);
  }
}

function validateArgument(
  commandDefinition: CommandDefinition,
  argument: ArgumentDefinition,
): void {
  const all = commandDefinition.arguments;
  if (all.some(({ name }) => name === argument.name)) {
    throw new TypeError(`Duplicate argument: ${argument.name}`);
  }
  if (argument.kind === 'positional') {
    if (argument.short !== undefined || argument.long !== undefined) {
      throw new TypeError(`Positional '${argument.name}' cannot have option names`);
    }
    const positionals = all.filter(({ kind }) => kind === 'positional');
    if (argument.maxValues === 0) {
      throw new TypeError(`Positional '${argument.name}' must accept at least one value`);
    }
    const previous = positionals.at(-1);
    if (
      previous !== undefined
      && (previous.repeatable || previous.trailingVarArg || previous.maxValues === null)
    ) {
      throw new TypeError(
        `No positional can follow repeatable or unbounded '${previous.name}'`,
      );
    }
    if (
      argument.presence === 'required'
      && positionals.some(({ presence }) => presence !== 'required')
    ) {
      throw new TypeError('A required positional cannot follow an optional positional');
    }
  }

  if (argument.kind !== 'positional' && argument.trailingVarArg) {
    throw new TypeError(`Named argument '${argument.name}' cannot be trailing`);
  }
  if (argument.kind === 'positional' && argument.global) {
    throw new TypeError(`Positional '${argument.name}' cannot be global`);
  }

  const reservedLongs = new Set([
    ...(commandDefinition.disableHelpFlag ? [] : ['help']),
    ...(commandDefinition.version === undefined || commandDefinition.disableVersionFlag
      ? []
      : ['version']),
  ]);
  const reservedShorts = new Set([
    ...(commandDefinition.disableHelpFlag ? [] : ['h']),
    ...(commandDefinition.version === undefined || commandDefinition.disableVersionFlag
      ? []
      : ['V']),
  ]);
  const argumentLongs = [argument.long, ...argument.aliases].filter(
    (value): value is string => value !== undefined,
  );
  if (new Set(argumentLongs).size !== argumentLongs.length) {
    throw new TypeError(`Argument '${argument.name}' has duplicate long options`);
  }
  for (const long of argumentLongs) {
    if (reservedLongs.has(long)) {
      throw new TypeError(`Option '--${long}' is reserved`);
    }
    if (all.some((current) => current.long === long || current.aliases.includes(long))) {
      throw new TypeError(`Duplicate long option: --${long}`);
    }
  }
  if (argument.short !== undefined) {
    if (reservedShorts.has(argument.short)) {
      throw new TypeError(`Option '-${argument.short}' is reserved`);
    }
    if (all.some(({ short }) => short === argument.short)) {
      throw new TypeError(`Duplicate short option: -${argument.short}`);
    }
  }
}

function validateBuiltInCollisions(
  definition: CommandDefinition,
  inheritedGlobals: readonly ArgumentDefinition[],
): void {
  const available = [...definition.arguments, ...inheritedGlobals];
  if (
    !definition.disableHelpFlag && available.some(
      (argument) =>
        argument.short === 'h'
        || argument.long === 'help'
        || argument.aliases.includes('help'),
    )
  ) {
    throw new TypeError('Help flags conflict with an existing argument');
  }
  if (
    definition.version !== undefined
    && !definition.disableVersionFlag
    && available.some(
      (argument) =>
        argument.short === 'V'
        || argument.long === 'version'
        || argument.aliases.includes('version'),
    )
  ) {
    throw new TypeError('Version flags conflict with an existing argument');
  }

  const globals = [
    ...inheritedGlobals,
    ...definition.arguments.filter(({ global }) => global),
  ];
  for (const child of definition.subcommands) {
    validateBuiltInCollisions(child, globals);
  }
}

interface ParseState {
  readonly values: Record<string, unknown>;
  readonly provided: Set<string>;
  readonly cliProvided: Set<string>;
  readonly valueCounts: Record<string, number>;
  positionalIndex: number;
  subcommand?: { readonly name: string; readonly args: Record<string, unknown>; };
}

interface GlobalBinding {
  readonly argument: ArgumentDefinition;
  readonly state: ParseState;
}

function parseDefinition(
  definition: CommandDefinition,
  argv: string[],
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
): Record<string, unknown> {
  const state: ParseState = {
    values: {},
    provided: new Set(),
    cliProvided: new Set(),
    valueCounts: {},
    positionalIndex: 0,
  };
  const positionals = definition.arguments.filter(({ kind }) => kind === 'positional');
  initializeValues(definition, state);
  validateGlobalArguments(definition, inheritedGlobals);
  const localGlobals = definition.arguments
    .filter(({ global }) => global)
    .map((argument) => ({ argument, state }));
  const globals = [...inheritedGlobals, ...localGlobals];

  let index = 0;
  let optionsEnabled = true;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) {
      break;
    }

    if (optionsEnabled && token === '--') {
      optionsEnabled = false;
      index += 1;
      continue;
    }
    if (
      optionsEnabled
      && !definition.disableHelpFlag
      && (token === '--help' || token === '-h')
    ) {
      throw new DisplayRequest({
        ok: true,
        type: 'display',
        kind: DisplayKind.Help,
        output: renderHelp(
          definition,
          path,
          inheritedGlobals.map(({ argument }) => argument),
        ),
      });
    }
    if (
      optionsEnabled
      && !definition.disableVersionFlag
      && definition.version !== undefined
      && (token === '--version' || token === '-V')
    ) {
      throw new DisplayRequest({
        ok: true,
        type: 'display',
        kind: DisplayKind.Version,
        output: `${definition.name} ${definition.version}\n`,
      });
    }
    const positionalArgument = currentPositional(positionals, state);
    const consumeAsPositional = optionsEnabled
      && positionalArgument !== undefined
      && acceptsOptionLookingPositional(
        positionalArgument,
        token,
        definition,
        state,
        inheritedGlobals,
      );
    if (
      optionsEnabled
      && !consumeAsPositional
      && token.startsWith('--')
      && token.length > 2
    ) {
      index = parseLongOption(
        definition,
        argv,
        index,
        token,
        path,
        state,
        inheritedGlobals,
      );
      continue;
    }
    if (
      optionsEnabled
      && !consumeAsPositional
      && token.startsWith('-')
      && token !== '-'
    ) {
      index = parseShortOptions(
        definition,
        argv,
        index,
        token,
        path,
        state,
        inheritedGlobals,
      );
      continue;
    }

    if (optionsEnabled && !consumeAsPositional) {
      if (
        token === 'help'
        && definition.subcommands.length > 0
        && !definition.disableHelpSubcommand
        && !hasExactSubcommand(definition, token)
      ) {
        throw new DisplayRequest({
          ok: true,
          type: 'display',
          kind: DisplayKind.Help,
          output: renderSubcommandHelp(
            definition,
            argv.slice(index + 1),
            path,
            inheritedGlobals,
          ),
        });
      }
      const child = resolveSubcommand(definition, token, path, inheritedGlobals);
      if (child !== undefined) {
        state.subcommand = Object.freeze({
          name: child.name,
          args: parseDefinition(
            child,
            argv.slice(index + 1),
            [...path, child.name],
            globals,
          ),
        });
        index = argv.length;
        break;
      }
    }

    if (positionalArgument === undefined) {
      const suggestion = suggestToken(
        token,
        definition,
        inheritedGlobals.map(({ argument }) => argument),
      );
      const kind = definition.subcommands.length > 0
        ? ErrorKind.InvalidSubcommand
        : ErrorKind.UnknownArgument;
      throw commandError(
        kind,
        `unexpected argument '${token}'${suggestion}`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
      );
    }
    if (positionalArgument.valueTerminator === token) {
      state.positionalIndex += 1;
      index += 1;
      continue;
    }
    storePositionalValue(positionalArgument, token, definition, path, state);
    const count = state.valueCounts[positionalArgument.name] ?? 0;
    if (
      !positionalArgument.repeatable
      && positionalArgument.maxValues !== null
      && count >= positionalArgument.maxValues
    ) {
      state.positionalIndex += 1;
    }
    if (positionalArgument.trailingVarArg) {
      optionsEnabled = false;
    }
    index += 1;
  }

  applyEnvironmentFallbacks(definition, state, path);
  applyOverrides(definition, state);
  validateParsedValues(
    definition,
    path,
    state,
    inheritedGlobals.map(({ argument }) => argument),
  );
  if (definition.subcommands.length > 0) {
    state.values.subcommand = state.subcommand;
  }
  for (const value of Object.values(state.values)) {
    if (Array.isArray(value)) {
      Object.freeze(value);
    }
  }
  return Object.freeze(state.values);
}

function initializeValues(
  definition: CommandDefinition,
  state: ParseState,
): void {
  for (const argument of definition.arguments) {
    if (argument.repeatable || argument.trailingVarArg) {
      state.values[argument.name] = [];
    } else if (argument.presence === 'default') {
      state.values[argument.name] = argument.defaultValue;
    } else {
      state.values[argument.name] = undefined;
    }
  }
}

function applyEnvironmentFallbacks(
  definition: CommandDefinition,
  state: ParseState,
  path: readonly string[],
): void {
  const overriddenTargets = new Set(
    definition.overrides
      .filter(({ source }) => state.cliProvided.has(source))
      .map(({ target }) => target),
  );
  for (const argument of definition.arguments) {
    if (
      argument.env === undefined
      || state.cliProvided.has(argument.name)
      || overriddenTargets.has(argument.name)
    ) {
      continue;
    }
    const raw = Bun.env[argument.env];
    if (raw === undefined) {
      continue;
    }
    const display = `env:${argument.env}`;
    if (argument.kind === 'flag') {
      state.values[argument.name] = parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        parsers.boolean,
        true,
      );
      state.provided.add(argument.name);
      continue;
    }
    if (argument.kind === 'count') {
      const count = parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        parsers.integer,
        true,
      );
      if (typeof count !== 'number' || count < 0) {
        throw commandError(
          ErrorKind.InvalidValue,
          `invalid value for '${display}'`,
          definition,
          path,
        );
      }
      state.values[argument.name] = count;
      state.provided.add(argument.name);
      continue;
    }

    const values = splitRawValue(argument, raw);
    const delimiterCanExpandSingle = argument.repeatable && argument.maxValues === 1;
    if (
      !delimiterCanExpandSingle
      && argument.maxValues !== null
      && values.length > argument.maxValues
    ) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
        definition,
        path,
      );
    }
    storeRawValues(argument, values, display, definition, path, state, true);
    state.cliProvided.delete(argument.name);
  }
}

function acceptsOptionLookingPositional(
  argument: ArgumentDefinition,
  token: string,
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): boolean {
  if (token === '--' || token === '-' || !token.startsWith('-')) {
    return false;
  }
  if (hasDeclaredOption(token, definition, state, inheritedGlobals)) {
    return false;
  }
  return argument.allowHyphenValues
    || (argument.allowNegativeNumbers && isNegativeNumberToken(token));
}

function hasDeclaredOption(
  token: string,
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): boolean {
  const bindings = availableArgumentBindings(definition, state, inheritedGlobals);
  if (token.startsWith('--')) {
    const name = token.slice(2).split('=', 1)[0];
    return bindings.some(
      ({ argument }) => argument.long === name || argument.aliases.includes(name ?? ''),
    );
  }
  const short = Array.from(token.slice(1))[0];
  return short !== undefined && bindings.some(({ argument }) => argument.short === short);
}

function currentPositional(
  positionals: readonly ArgumentDefinition[],
  state: ParseState,
): ArgumentDefinition | undefined {
  return positionals[state.positionalIndex];
}

function availableArgumentBindings(
  definition: CommandDefinition,
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): readonly GlobalBinding[] {
  return [
    ...definition.arguments.map((argument) => ({ argument, state })),
    ...inheritedGlobals,
  ];
}

function validateGlobalArguments(
  definition: CommandDefinition,
  inheritedGlobals: readonly GlobalBinding[],
): void {
  for (const local of definition.arguments) {
    for (const { argument: global } of inheritedGlobals) {
      const localLongs = [local.long, ...local.aliases].filter(
        (value): value is string => value !== undefined,
      );
      const globalLongs = [global.long, ...global.aliases].filter(
        (value): value is string => value !== undefined,
      );
      if (
        (local.short !== undefined && local.short === global.short)
        || localLongs.some((name) => globalLongs.includes(name))
      ) {
        throw new TypeError(
          `Argument '${local.name}' conflicts with inherited global '${global.name}'`,
        );
      }
    }
  }
}

function hasExactSubcommand(
  definition: CommandDefinition,
  token: string,
): boolean {
  return definition.subcommands.some(
    (child) => child.name === token || child.aliases.some(({ name }) => name === token),
  );
}

function resolveSubcommand(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
): CommandDefinition | undefined {
  return resolveSubcommandWithArguments(
    definition,
    token,
    path,
    inheritedGlobals.map(({ argument }) => argument),
  );
}

function resolveSubcommandWithArguments(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
): CommandDefinition | undefined {
  const exact = definition.subcommands.find(
    (child) => child.name === token || child.aliases.some(({ name }) => name === token),
  );
  if (exact !== undefined || !definition.inferSubcommands) {
    return exact;
  }

  const matches = definition.subcommands.filter(
    (child) =>
      child.name.startsWith(token)
      || child.aliases.some(({ name }) => name.startsWith(token)),
  );
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw commandError(
      ErrorKind.InvalidSubcommand,
      `subcommand '${token}' is ambiguous: ${matches.map(({ name }) => name).join(', ')}`,
      definition,
      path,
      inheritedArguments,
    );
  }
  return undefined;
}

function renderSubcommandHelp(
  definition: CommandDefinition,
  tokens: readonly string[],
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
): string {
  let current = definition;
  let currentPath = [...path];
  let inheritedArguments = inheritedGlobals.map(({ argument }) => argument);

  for (const token of tokens) {
    const globalsForChild = [
      ...inheritedArguments,
      ...current.arguments.filter(({ global }) => global),
    ];
    const child = resolveSubcommandWithArguments(
      current,
      token,
      currentPath,
      globalsForChild,
    );
    if (child === undefined) {
      throw commandError(
        ErrorKind.InvalidSubcommand,
        `unrecognized subcommand '${token}'${suggestToken(token, current, globalsForChild)}`,
        current,
        currentPath,
        inheritedArguments,
      );
    }
    current = child;
    currentPath = [...currentPath, child.name];
    inheritedArguments = globalsForChild;
  }
  return renderHelp(current, currentPath, inheritedArguments);
}

function parseLongOption(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const equalIndex = token.indexOf('=');
  const name = token.slice(2, equalIndex === -1 ? undefined : equalIndex);
  const inlineValue = equalIndex === -1 ? undefined : token.slice(equalIndex + 1);
  const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
    ({ argument }) => argument.long === name || argument.aliases.includes(name),
  );
  if (binding === undefined || binding.argument.kind === 'positional') {
    throw commandError(
      ErrorKind.UnknownArgument,
      `unexpected argument '--${name}'${
        suggestToken(
          `--${name}`,
          definition,
          inheritedGlobals.map(({ argument }) => argument),
        )
      }`,
      definition,
      path,
      inheritedGlobals.map(({ argument }) => argument),
    );
  }
  const { argument } = binding;
  if (argument.kind === 'flag' || argument.kind === 'count') {
    if (inlineValue !== undefined) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '--${name}' does not accept a value`,
        definition,
        path,
      );
    }
    storeSwitch(
      argument,
      `--${name}`,
      definition,
      path,
      binding.state,
      inheritedGlobals.map(({ argument: inherited }) => inherited),
    );
    return index + 1;
  }
  if (argument.requireEquals && inlineValue === undefined) {
    if (argument.hasDefaultMissingValue) {
      storeParsedValues(
        argument,
        [argument.defaultMissingValue],
        `--${name}`,
        definition,
        path,
        binding.state,
      );
      return index + 1;
    }
    throw commandError(
      ErrorKind.NoEquals,
      `an equals sign is required for '--${name}=<VALUE>'`,
      definition,
      path,
      inheritedGlobals.map(({ argument }) => argument),
    );
  }
  const consumed = consumeOptionValues(
    argument,
    argv,
    index,
    inlineValue,
    definition,
    path,
    `--${name}`,
    inheritedGlobals.map(({ argument }) => argument),
  );
  if (consumed.values.length === 0 && argument.hasDefaultMissingValue) {
    storeParsedValues(
      argument,
      [argument.defaultMissingValue],
      `--${name}`,
      definition,
      path,
      binding.state,
    );
  } else {
    storeRawValues(
      argument,
      consumed.values,
      `--${name}`,
      definition,
      path,
      binding.state,
    );
  }
  return consumed.nextIndex;
}

function parseShortOptions(
  definition: CommandDefinition,
  argv: readonly string[],
  index: number,
  token: string,
  path: readonly string[],
  state: ParseState,
  inheritedGlobals: readonly GlobalBinding[],
): number {
  const cluster = Array.from(token.slice(1));
  for (let clusterIndex = 0; clusterIndex < cluster.length; clusterIndex += 1) {
    const short = cluster[clusterIndex];
    if (short === undefined) {
      continue;
    }
    const binding = availableArgumentBindings(definition, state, inheritedGlobals).find(
      ({ argument }) => argument.short === short,
    );
    if (binding === undefined || binding.argument.kind === 'positional') {
      throw commandError(
        ErrorKind.UnknownArgument,
        `unexpected argument '-${short}'${
          suggestToken(
            `-${short}`,
            definition,
            inheritedGlobals.map(({ argument }) => argument),
          )
        }`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
      );
    }
    const { argument } = binding;
    if (argument.kind === 'flag' || argument.kind === 'count') {
      storeSwitch(
        argument,
        `-${short}`,
        definition,
        path,
        binding.state,
        inheritedGlobals.map(({ argument: inherited }) => inherited),
      );
      continue;
    }
    const attached = cluster.slice(clusterIndex + 1).join('');
    if (argument.requireEquals && attached === '') {
      if (argument.hasDefaultMissingValue) {
        storeParsedValues(
          argument,
          [argument.defaultMissingValue],
          `-${short}`,
          definition,
          path,
          binding.state,
        );
        return index + 1;
      }
      throw commandError(
        ErrorKind.NoEquals,
        `an attached value is required for '-${short}<VALUE>'`,
        definition,
        path,
        inheritedGlobals.map(({ argument }) => argument),
      );
    }
    const consumed = consumeOptionValues(
      argument,
      argv,
      index,
      attached === '' ? undefined : attached,
      definition,
      path,
      `-${short}`,
      inheritedGlobals.map(({ argument }) => argument),
    );
    if (consumed.values.length === 0 && argument.hasDefaultMissingValue) {
      storeParsedValues(
        argument,
        [argument.defaultMissingValue],
        `-${short}`,
        definition,
        path,
        binding.state,
      );
    } else {
      storeRawValues(
        argument,
        consumed.values,
        `-${short}`,
        definition,
        path,
        binding.state,
      );
    }
    return consumed.nextIndex;
  }
  return index + 1;
}

interface ConsumedOptionValues {
  readonly values: readonly string[];
  readonly nextIndex: number;
}

function consumeOptionValues(
  argument: ArgumentDefinition,
  argv: readonly string[],
  optionIndex: number,
  inlineValue: string | undefined,
  definition: CommandDefinition,
  path: readonly string[],
  display: string,
  inheritedArguments: readonly ArgumentDefinition[],
): ConsumedOptionValues {
  const values: string[] = [];
  let rawCount = 0;
  let nextIndex = optionIndex + 1;

  const append = (raw: string): void => {
    const parts = splitRawValue(argument, raw);
    const delimiterCanExpandSingle = argument.repeatable && argument.maxValues === 1;
    if (
      !delimiterCanExpandSingle
      && argument.maxValues !== null
      && values.length + parts.length > argument.maxValues
    ) {
      throw commandError(
        ErrorKind.TooManyValues,
        `argument '${display}' accepts at most ${argument.maxValues} value(s)`,
        definition,
        path,
        inheritedArguments,
      );
    }
    values.push(...parts);
    rawCount += 1;
  };

  if (inlineValue !== undefined) {
    append(inlineValue);
  }
  while (
    (argument.maxValues === null || values.length < argument.maxValues)
    && !(argument.repeatable && argument.maxValues === 1 && rawCount >= 1)
  ) {
    const raw = argv[nextIndex];
    if (raw === undefined) {
      break;
    }
    if (argument.valueTerminator === raw) {
      nextIndex += 1;
      break;
    }
    if (
      shouldStopOptionValues(argument, raw)
      || (
        values.length >= argument.minValues
        && resolveSubcommandWithArguments(
            definition,
            raw,
            path,
            inheritedArguments,
          ) !== undefined
      )
    ) {
      break;
    }
    append(raw);
    nextIndex += 1;
  }

  if (values.length < argument.minValues) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${display}' requires at least ${argument.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
    );
  }
  return { values, nextIndex };
}

function shouldStopOptionValues(argument: ArgumentDefinition, token: string): boolean {
  if (argument.allowHyphenValues) {
    return false;
  }
  if (argument.allowNegativeNumbers && isNegativeNumberToken(token)) {
    return false;
  }
  return token === '--' || (token.startsWith('-') && token !== '-');
}

function isNegativeNumberToken(token: string): boolean {
  return /^-(?:\d|\.\d)/.test(token);
}

function splitRawValue(argument: ArgumentDefinition, raw: string): readonly string[] {
  return argument.valueDelimiter === undefined
    ? [raw]
    : raw.split(argument.valueDelimiter);
}

function storePositionalValue(
  argument: ArgumentDefinition,
  raw: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
): void {
  const values = splitRawValue(argument, raw);
  const currentCount = state.valueCounts[argument.name] ?? 0;
  if (
    !argument.repeatable
    && argument.maxValues !== null
    && currentCount + values.length > argument.maxValues
  ) {
    throw commandError(
      ErrorKind.TooManyValues,
      `argument '${displayArgument(argument)}' accepts at most ${argument.maxValues} value(s)`,
      definition,
      path,
    );
  }
  storeRawValues(argument, values, raw, definition, path, state);
}

function storeRawValues(
  argument: ArgumentDefinition,
  rawValues: readonly string[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  redactRaw = false,
): void {
  storeParsedValues(
    argument,
    rawValues.map((raw) =>
      parseWith(
        argument,
        raw,
        display,
        definition,
        path,
        argument.parser,
        redactRaw,
      )
    ),
    display,
    definition,
    path,
    state,
  );
}

function storeParsedValues(
  argument: ArgumentDefinition,
  values: readonly unknown[],
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
): void {
  const collectsValues = argument.repeatable
    || argument.trailingVarArg
    || argument.maxValues !== 1;
  if (
    argument.env !== undefined
    && state.provided.has(argument.name)
    && !state.cliProvided.has(argument.name)
  ) {
    state.values[argument.name] = collectsValues ? [] : undefined;
    state.provided.delete(argument.name);
    delete state.valueCounts[argument.name];
  }
  if (
    argument.kind === 'option'
    && !argument.repeatable
    && state.cliProvided.has(argument.name)
  ) {
    throw commandError(
      ErrorKind.ArgumentConflict,
      `argument '${display}' cannot be used more than once`,
      definition,
      path,
    );
  }

  if (collectsValues) {
    const current = state.values[argument.name];
    if (current === undefined) {
      state.values[argument.name] = [...values];
    } else if (Array.isArray(current)) {
      current.push(...values);
    } else {
      throw new Error(`Internal parser state for '${argument.name}' is not an array`);
    }
  } else if (values.length > 0) {
    state.values[argument.name] = values[0];
  }
  state.valueCounts[argument.name] = (state.valueCounts[argument.name] ?? 0) + values.length;
  state.provided.add(argument.name);
  state.cliProvided.add(argument.name);
}

function storeSwitch(
  argument: ArgumentDefinition,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  if (
    argument.action === ArgumentAction.Help
    || argument.action === ArgumentAction.HelpShort
    || argument.action === ArgumentAction.HelpLong
  ) {
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
      output: renderHelp(
        definition,
        path,
        inheritedArguments,
        argument.action !== ArgumentAction.HelpShort,
      ),
    });
  }
  if (argument.action === ArgumentAction.Version) {
    if (definition.version === undefined) {
      throw new TypeError(
        `Command '${path.join(' ')}' must define a version for '${display}'`,
      );
    }
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Version,
      output: `${definition.name} ${definition.version}\n`,
    });
  }
  if (
    argument.env !== undefined
    && state.provided.has(argument.name)
    && !state.cliProvided.has(argument.name)
  ) {
    state.values[argument.name] = argument.defaultValue;
    state.provided.delete(argument.name);
  }
  if (
    argument.action === ArgumentAction.SetTrue
    || argument.action === ArgumentAction.SetFalse
  ) {
    if (state.cliProvided.has(argument.name)) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `argument '${display}' cannot be used more than once`,
        definition,
        path,
      );
    }
    state.values[argument.name] = argument.action === ArgumentAction.SetTrue;
  } else if (argument.action === ArgumentAction.Count) {
    const current = state.values[argument.name];
    state.values[argument.name] = typeof current === 'number' ? current + 1 : 1;
  } else {
    throw new Error(`Action '${argument.action}' is not a switch action`);
  }
  state.provided.add(argument.name);
  state.cliProvided.add(argument.name);
}

function parseWith(
  argument: ArgumentDefinition,
  raw: string,
  display: string,
  definition: CommandDefinition,
  path: readonly string[],
  overrideParser = argument.parser,
  redactRaw = false,
): unknown {
  if (overrideParser === undefined) {
    throw new Error(`Argument '${argument.name}' has no value parser`);
  }
  try {
    return overrideParser.parse(raw);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw commandError(
      ErrorKind.InvalidValue,
      redactRaw
        ? `invalid value for '${display}'`
        : `invalid value '${raw}' for '${display}': ${detail}`,
      definition,
      path,
    );
  }
}

function applyOverrides(
  definition: CommandDefinition,
  state: ParseState,
): void {
  for (const { source, target } of definition.overrides) {
    if (!state.cliProvided.has(source)) {
      continue;
    }
    const argument = definition.arguments.find(({ name }) => name === target);
    if (argument === undefined) {
      continue;
    }
    state.values[target] = argument.repeatable || argument.trailingVarArg
      ? []
      : argument.presence === 'default'
      ? argument.defaultValue
      : undefined;
    state.provided.delete(target);
    state.cliProvided.delete(target);
    delete state.valueCounts[target];
  }
}

function matchesRelationValue(actual: unknown, expected: unknown): boolean {
  return Array.isArray(actual)
    ? actual.some((value) => Object.is(value, expected))
    : Object.is(actual, expected);
}

function validateParsedValues(
  definition: CommandDefinition,
  path: readonly string[],
  state: ParseState,
  inheritedArguments: readonly ArgumentDefinition[],
): void {
  const missing = definition.arguments
    .filter((argument) => argument.presence === 'required' && !state.provided.has(argument.name))
    .map(displayArgument);
  if (missing.length > 0) {
    throw commandError(
      ErrorKind.MissingRequiredArgument,
      `the following required arguments were not provided: ${missing.join(', ')}`,
      definition,
      path,
      inheritedArguments,
    );
  }
  const tooShort = definition.arguments.find(
    (argument) =>
      (argument.kind === 'option' || argument.kind === 'positional')
      && state.provided.has(argument.name)
      && (state.valueCounts[argument.name] ?? 0) < argument.minValues,
  );
  if (tooShort !== undefined) {
    throw commandError(
      ErrorKind.TooFewValues,
      `argument '${displayArgument(tooShort)}' requires at least ${tooShort.minValues} value(s)`,
      definition,
      path,
      inheritedArguments,
    );
  }
  if (
    definition.argRequiredElseHelp
    && state.provided.size === 0
    && state.subcommand === undefined
  ) {
    throw new DisplayRequest({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
      output: renderHelp(definition, path, inheritedArguments),
    });
  }
  if (definition.subcommandRequired && state.subcommand === undefined) {
    throw commandError(
      ErrorKind.MissingSubcommand,
      'a subcommand is required but one was not provided',
      definition,
      path,
      inheritedArguments,
    );
  }

  for (const { source, target } of definition.requirements) {
    if (state.provided.has(source) && !state.provided.has(target)) {
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}'`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const { source, expected, target } of definition.conditionalRequirements) {
    if (
      matchesRelationValue(state.values[source], expected)
      && !state.provided.has(target)
    ) {
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, source)}' requires '${displayName(definition, target)}' when its value is '${
          String(expected)
        }'`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const requirement of definition.conditionalSetRequirements) {
    const matches = requirement.conditions.map(({ source, expected }) =>
      state.provided.has(source)
      && matchesRelationValue(state.values[source], expected)
    );
    const matched = requirement.match === 'any'
      ? matches.some(Boolean)
      : matches.every(Boolean);
    if (matched && !state.provided.has(requirement.target)) {
      const joiner = requirement.match === 'any' ? ' or ' : ' and ';
      const conditions = requirement.conditions
        .map(({ source, expected }) => `'${displayName(definition, source)}=${String(expected)}'`)
        .join(joiner);
      throw commandError(
        ErrorKind.MissingDependency,
        `argument '${displayName(definition, requirement.target)}' is required when ${conditions}`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const { target, alternatives } of definition.requiredUnless) {
    if (
      !state.provided.has(target)
      && !alternatives.some((name) => state.provided.has(name))
    ) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `argument '${displayName(definition, target)}' is required unless ${
          alternatives.map((name) => `'${displayName(definition, name)}'`).join(' or ')
        } is present`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const { target, alternatives } of definition.requiredUnlessAll) {
    if (
      !state.provided.has(target)
      && !alternatives.every((name) => state.provided.has(name))
    ) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `argument '${displayName(definition, target)}' is required unless all of ${
          alternatives.map((name) => `'${displayName(definition, name)}'`).join(' and ')
        } are present`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const exclusive of definition.exclusiveArguments) {
    if (!state.provided.has(exclusive)) {
      continue;
    }
    const others = [...state.provided].filter((name) => name !== exclusive);
    if (others.length > 0) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `argument '${displayName(definition, exclusive)}' cannot be used with ${
          others.map((name) => `'${displayName(definition, name)}'`).join(' and ')
        }`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const conflict of definition.conflicts) {
    const present = conflict.filter((name) => state.provided.has(name));
    if (present.length > 1) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `arguments ${present.map((name) => `'${displayName(definition, name)}'`).join(' and ')} cannot be used together`,
        definition,
        path,
        inheritedArguments,
      );
    }
  }
  for (const group of definition.groups) {
    const present = group.members.filter((name) => state.provided.has(name));
    if (group.required && present.length === 0) {
      throw commandError(
        ErrorKind.MissingRequiredArgument,
        `one of group '${group.name}' is required: ${group.members.map((name) => displayName(definition, name)).join(', ')}`,
        definition,
        path,
        inheritedArguments,
      );
    }
    if (!group.multiple && present.length > 1) {
      throw commandError(
        ErrorKind.ArgumentConflict,
        `arguments in group '${group.name}' cannot be used together: ${present.map((name) => displayName(definition, name)).join(', ')}`,
        definition,
        path,
        inheritedArguments,
      );
    }
    if (present.length > 0) {
      const missingRequirement = group.requires.find(
        (name) => !state.provided.has(name),
      );
      if (missingRequirement !== undefined) {
        throw commandError(
          ErrorKind.MissingDependency,
          `argument group '${group.name}' requires '${displayName(definition, missingRequirement)}'`,
          definition,
          path,
          inheritedArguments,
        );
      }
      const conflict = group.conflicts.find((name) => state.provided.has(name));
      if (conflict !== undefined) {
        throw commandError(
          ErrorKind.ArgumentConflict,
          `argument group '${group.name}' conflicts with '${displayName(definition, conflict)}'`,
          definition,
          path,
          inheritedArguments,
        );
      }
    }
  }
}

function displayArgument(argument: ArgumentDefinition): string {
  if (argument.kind === 'positional') {
    return `<${argument.name}>`;
  }
  if (argument.long !== undefined) {
    return `--${argument.long}`;
  }
  if (argument.short !== undefined) {
    return `-${argument.short}`;
  }
  return argument.name;
}

function displayName(definition: CommandDefinition, name: string): string {
  const argument = definition.arguments.find((candidate) => candidate.name === name);
  return argument === undefined ? name : displayArgument(argument);
}

function commandError(
  kind: ErrorKind,
  message: string,
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
): CliError {
  const usage = renderUsage(definition, path, inheritedArguments);
  return new CliError(
    kind,
    message,
    `error: ${message}\n\n${usage}\n\nFor more information, try '--help'.\n`,
  );
}

function suggestToken(
  token: string,
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): string {
  const candidates = [
    ...[...definition.arguments, ...inheritedArguments].flatMap((argument) => [
      ...(argument.long === undefined ? [] : [`--${argument.long}`]),
      ...(argument.short === undefined ? [] : [`-${argument.short}`]),
      ...argument.aliases.map((alias) => `--${alias}`),
    ]),
    ...definition.subcommands.flatMap((child) => [
      child.name,
      ...child.aliases.map(({ name }) => name),
    ]),
  ];
  let best: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = editDistance(token, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  const limit = Math.max(1, Math.floor(token.length / 3));
  return best !== undefined && bestDistance <= limit ? `; a similar argument exists: '${best}'` : '';
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] ?? 0;
      const deletion = previous[rightIndex] ?? 0;
      const insertion = current[rightIndex - 1] ?? 0;
      current[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? substitution
        : 1 + Math.min(substitution, deletion, insertion);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? 0;
}

function renderUsageText(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
): string {
  if (definition.overrideUsage !== undefined) {
    return definition.overrideUsage;
  }
  const allArguments = [...definition.arguments, ...inheritedArguments];
  const requiredOptions = allArguments.filter(
    (argument) =>
      argument.kind !== 'positional'
      && argument.presence === 'required'
      && !argument.hidden,
  );
  const options = allArguments.some(
    ({ kind, presence, hidden }) =>
      kind !== 'positional'
      && presence !== 'required'
      && !hidden,
  );
  const requiredOptionUsage = requiredOptions.map((argument) => `${displayArgument(argument)}${renderValueCount(argument)}`);
  const positionalUsage = definition.arguments
    .filter(({ kind, hidden }) => kind === 'positional' && !hidden)
    .map((argument) => {
      const name = argument.valueName ?? argument.name.toUpperCase();
      return renderPositionalCount(argument, name);
    });
  return [
    path.join(' '),
    ...(options ? ['[OPTIONS]'] : []),
    ...requiredOptionUsage,
    ...positionalUsage,
    ...(definition.subcommands.some(({ hidden }) => !hidden) ? ['<COMMAND>'] : []),
  ].join(' ');
}

function renderUsage(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
): string {
  return `Usage: ${renderUsageText(definition, path, inheritedArguments)}`;
}

function renderHelp(
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  includeLongAbout = true,
): string {
  if (definition.overrideHelp !== undefined) {
    return definition.overrideHelp;
  }

  const lines: string[] = [];
  if (definition.beforeHelp !== undefined) {
    lines.push(definition.beforeHelp);
  }
  if (definition.about !== undefined) {
    lines.push(definition.about, '');
  }
  if (definition.author !== undefined) {
    lines.push(`Author: ${definition.author}`, '');
  }
  lines.push(renderUsage(definition, path, inheritedArguments));

  const positionals = definition.arguments.filter(
    (argument) => argument.kind === 'positional' && !argument.hidden,
  );
  if (positionals.length > 0) {
    lines.push('', 'Arguments:');
    const entries: Array<readonly [string, string]> = positionals.map((argument) => {
      const name = argument.valueName ?? argument.name.toUpperCase();
      const label = renderPositionalCount(argument, name);
      return [`  ${label}`, annotateHelp(argument)] as const;
    });
    pushAligned(lines, entries);
  }

  const subcommands = definition.subcommands.filter(({ hidden }) => !hidden);
  if (subcommands.length > 0) {
    lines.push('', 'Commands:');
    const commandEntries: Array<readonly [string, string]> = subcommands.map((child) => {
      const aliases = child.aliases
        .filter(({ visible }) => visible)
        .map(({ name }) => name);
      const label = aliases.length === 0
        ? child.name
        : `${child.name} (aliases: ${aliases.join(', ')})`;
      return [`  ${label}`, child.about ?? ''] as const;
    });
    if (subcommands.length > 0 && !definition.disableHelpSubcommand) {
      commandEntries.push(['  help', 'Print help for a subcommand']);
    }
    pushAligned(lines, commandEntries);
  }

  const options = [...definition.arguments, ...inheritedArguments].filter(
    (argument) => argument.kind !== 'positional' && !argument.hidden,
  );
  const entries: Array<readonly [string, string]> = options.map((argument) => {
    const names = [
      ...(argument.short === undefined ? [] : [`-${argument.short}`]),
      ...(argument.long === undefined ? [] : [`--${argument.long}`]),
    ].join(', ');
    const value = argument.kind !== 'option'
      ? ''
      : argument.requireEquals
      ? renderEqualsValueCount(argument)
      : renderValueCount(argument);
    return [`  ${names}${value}`, annotateHelp(argument)] as const;
  });
  if (!definition.disableHelpFlag) {
    entries.push(['  -h, --help', 'Print help']);
  }
  if (definition.version !== undefined && !definition.disableVersionFlag) {
    entries.push(['  -V, --version', 'Print version']);
  }
  if (entries.length > 0) {
    lines.push('', 'Options:');
    pushAligned(lines, entries);
  }
  if (includeLongAbout && definition.longAbout !== undefined) {
    lines.push('', definition.longAbout);
  }
  if (definition.afterHelp !== undefined) {
    lines.push('', definition.afterHelp);
  }
  return `${lines.join('\n')}\n`;
}

function valueLabel(argument: ArgumentDefinition): string {
  return argument.valueName ?? argument.parser?.label ?? 'VALUE';
}

const expandedValueCountLimit = 8;

function compactValueCount(
  minimum: number,
  maximum: number | null,
): string | undefined {
  if (
    minimum <= expandedValueCountLimit
    && (maximum === null || maximum <= expandedValueCountLimit)
  ) {
    return undefined;
  }
  if (maximum === null) {
    return `{${minimum}..}`;
  }
  return minimum === maximum ? `{${minimum}}` : `{${minimum}..${maximum}}`;
}

function renderValueCount(
  argument: ArgumentDefinition,
  minimum = argument.minValues,
): string {
  if (argument.kind !== 'option' || argument.maxValues === 0) {
    return '';
  }
  const label = `<${valueLabel(argument)}>`;
  const compact = compactValueCount(minimum, argument.maxValues);
  if (compact !== undefined) {
    return ` ${label}${compact}${argument.repeatable ? '...' : ''}`;
  }
  if (argument.maxValues === null) {
    if (minimum === 0) {
      return ` [${label}...]`;
    }
    const required = Array<string>(Math.max(0, minimum - 1)).fill(label);
    return ` ${[...required, `${label}...`].join(' ')}`;
  }
  const required = Array<string>(minimum).fill(label);
  const optional = Array<string>(argument.maxValues - minimum).fill(
    `[${label}]`,
  );
  const values = [...required, ...optional];
  const repeated = argument.repeatable ? '...' : '';
  return values.length === 0 ? '' : ` ${values.join(' ')}${repeated}`;
}

function renderEqualsValueCount(argument: ArgumentDefinition): string {
  const minimum = argument.minValues === 0 && argument.maxValues !== 0
    ? 1
    : argument.minValues;
  const values = renderValueCount(argument, minimum).trimStart();
  return argument.minValues === 0 ? `[=${values}]` : `=${values}`;
}

function renderPositionalCount(
  argument: ArgumentDefinition,
  name: string,
): string {
  const label = `<${name}>`;
  const optionalLabel = `[${name}]`;
  const compact = compactValueCount(argument.minValues, argument.maxValues);
  if (compact !== undefined) {
    const compactLabel = argument.presence === 'required' ? label : optionalLabel;
    return `${compactLabel}${compact}${argument.repeatable ? '...' : ''}`;
  }
  if (argument.maxValues === null) {
    if (argument.presence !== 'required') {
      if (argument.minValues <= 1) {
        return `${optionalLabel}...`;
      }
      const values = Array<string>(argument.minValues - 1).fill(label);
      return `[${[...values, `${label}...`].join(' ')}]`;
    }
    const required = Array<string>(
      Math.max(0, argument.minValues - 1),
    ).fill(label);
    return [...required, `${label}...`].join(' ');
  }
  const requiredCount = argument.presence === 'required' ? argument.minValues : 0;
  const required = Array<string>(requiredCount).fill(label);
  const optional = Array<string>(
    argument.maxValues - requiredCount,
  ).fill(optionalLabel);
  const repeated = argument.repeatable ? '...' : '';
  return `${[...required, ...optional].join(' ')}${repeated}`;
}

function annotateHelp(argument: ArgumentDefinition): string {
  const annotations: string[] = [];
  if (argument.help !== undefined) {
    annotations.push(argument.help);
  }
  if (argument.env !== undefined) {
    annotations.push(`[env: ${argument.env}]`);
  }
  if (
    argument.presence === 'default'
    && argument.kind !== 'flag'
    && argument.kind !== 'count'
  ) {
    annotations.push(`[default: ${String(argument.defaultValue)}]`);
  }
  return annotations.join(' ');
}

function pushAligned(lines: string[], entries: readonly (readonly [string, string])[]): void {
  const width = Math.max(0, ...entries.map(([label,]) => Bun.stringWidth(label)));
  for (const [label, description,] of entries) {
    const padding = ' '.repeat(width - Bun.stringWidth(label));
    lines.push(description === '' ? label : `${label}${padding}  ${description}`);
  }
}

export interface RunOptions {
  /** Arguments to parse. Defaults to Bun.argv without the executable. */
  readonly argv?: readonly string[];
  /** Receives help, version, and completion output. */
  readonly stdout?: (output: string) => void;
  /** Receives user-facing parse errors. */
  readonly stderr?: (output: string) => void;
  /** Controls ANSI styling for help. The default detects an interactive terminal. */
  readonly color?: boolean;
}

interface SelectedCommand {
  readonly definition: CommandDefinition;
  readonly args: Record<string, unknown>;
  readonly globals: readonly SelectedGlobal[];
  readonly path: readonly string[];
}

interface SelectedGlobal {
  readonly argument: ArgumentDefinition;
  readonly value: unknown;
}

function selectDeepestCommand(
  definition: CommandDefinition,
  args: Record<string, unknown>,
  path: readonly string[],
  inheritedGlobals: readonly SelectedGlobal[] = [],
): SelectedCommand {
  const globals = [
    ...inheritedGlobals,
    ...definition.arguments
      .filter((argument) => argument.global && Object.hasOwn(args, argument.name))
      .map((argument) => ({ argument, value: args[argument.name] })),
  ];
  const parsedSubcommand = args.subcommand;
  if (
    typeof parsedSubcommand !== 'object'
    || parsedSubcommand === null
    || !('name' in parsedSubcommand)
    || !('args' in parsedSubcommand)
    || typeof parsedSubcommand.name !== 'string'
    || typeof parsedSubcommand.args !== 'object'
    || parsedSubcommand.args === null
  ) {
    return { definition, args, globals, path };
  }

  const child = definition.subcommands.find(
    ({ name }) => name === parsedSubcommand.name,
  );
  if (child === undefined) {
    throw new Error(
      `Internal parser result references unknown subcommand '${parsedSubcommand.name}'`,
    );
  }
  return selectDeepestCommand(
    child,
    parsedSubcommand.args as Record<string, unknown>,
    [...path, child.name],
    globals,
  );
}

function writeParseFailure(error: CliError, options: RunOptions): number {
  const write = options.stderr ?? ((output: string) => console.error(output.trimEnd()));
  write(error.output);
  return error.exitCode;
}

const helpAnsi = Object.freeze({ strong: '\x1b[1m', reset: '\x1b[0m' });
const helpAccent = '#0891b2';

function helpPalette(forceColor: boolean): {
  readonly heading: string;
  readonly label: string;
  readonly strong: string;
  readonly reset: string;
} {
  const format = forceColor ? 'ansi-16m' : 'ansi';
  const accent = Bun.color(helpAccent, format) ?? '';
  return {
    heading: `${helpAnsi.strong}${accent}`,
    label: accent,
    ...helpAnsi,
  };
}

function shouldStyleHelp(options: RunOptions): boolean {
  return options.color
    ?? (
      options.stdout === undefined
      && process.stdout.isTTY === true
      && Bun.env.NO_COLOR === undefined
      && Bun.env.TERM !== 'dumb'
    );
}

function hasHelpOverride(
  definition: CommandDefinition,
  output: string,
): boolean {
  return definition.overrideHelp === output
    || definition.subcommands.some((child) => hasHelpOverride(child, output));
}

function styleHelp(output: string, forceColor: boolean): string {
  const palette = helpPalette(forceColor);
  let entrySection = false;
  return output.split('\n').map((line) => {
    if (/^(Arguments|Commands|Options):$/.test(line)) {
      entrySection = true;
      return `${palette.heading}${line}${palette.reset}`;
    }
    if (line === '') {
      entrySection = false;
      return line;
    }
    if (line.startsWith('Usage: ')) {
      return `${palette.heading}Usage:${palette.reset} ${palette.strong}${line.slice(7)}${palette.reset}`;
    }
    if (line.startsWith('Author: ')) {
      return `${palette.heading}Author:${palette.reset} ${line.slice(8)}`;
    }
    if (entrySection && line.startsWith('  ')) {
      const content = line.slice(2);
      const described = /^(.*?\S)( {2,})(\S.*)$/.exec(content);
      if (described !== null) {
        const label = described[1] ?? '';
        const spacing = described[2] ?? '';
        const description = described[3] ?? '';
        return `  ${palette.label}${label}${palette.reset}${spacing}${description}`;
      }
      return `  ${palette.label}${content}${palette.reset}`;
    }
    return line;
  }).join('\n');
}

function writeDisplay(
  definition: CommandDefinition,
  display: ParseDisplay,
  options: RunOptions,
): number {
  const write = options.stdout ?? ((output: string) => console.log(output.trimEnd()));
  const output = display.kind === DisplayKind.Help
      && shouldStyleHelp(options)
      && !hasHelpOverride(definition, display.output)
    ? styleHelp(display.output, options.color === true)
    : display.output;
  write(output);
  return 0;
}

function normalizeHandlerExitCode(value: HandlerResult): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new RangeError('A command handler exit code must be an integer from 0 to 255');
  }
  return value;
}

async function runConfiguredHandler<Args extends object>(
  definition: CommandDefinition,
  result: ParseResult<Args>,
  options: RunOptions,
): Promise<number> {
  if (result.type === 'error') {
    return writeParseFailure(result.error, options);
  }
  if (result.type === 'display') {
    return writeDisplay(definition, result, options);
  }

  const selected = selectDeepestCommand(
    definition,
    result.value as Record<string, unknown>,
    [definition.name],
  );
  if (selected.definition.handler === undefined) {
    throw new TypeError(
      `No handler is configured for command '${selected.path.join(' ')}'`,
    );
  }
  const context: HandlerContext = Object.freeze({
    commandPath: Object.freeze([...selected.path]),
    global<ArgumentType extends AnyGlobalArgument>(argument: ArgumentType) {
      const argumentDefinition = getArgumentDefinition(argument);
      if (!argumentDefinition.global) {
        throw new TypeError(`Argument '${argumentDefinition.name}' is not global`);
      }
      const binding = selected.globals.find(
        (candidate) => candidate.argument === argumentDefinition,
      );
      if (binding === undefined) {
        throw new TypeError(
          `Global argument '${argumentDefinition.name}' is not registered for command '${selected.path.join(' ')}'`,
        );
      }
      return binding.value as ArgumentOutput<ArgumentType>;
    },
  });
  const exitCode = await selected.definition.handler(selected.args as never, context);
  return normalizeHandlerExitCode(exitCode);
}
