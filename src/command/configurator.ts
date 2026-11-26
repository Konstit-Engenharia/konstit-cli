import {
  getArgumentDefinition,
  type ArgumentCardinality,
  type ArgumentKind,
  type ArgumentType,
} from '../argument/index.js';
import type { ParseOptions } from '../configuration/shape.js';
import { renderHelp } from '../help/render.js';
import { renderUsageText } from '../help/usage.js';
import type {
  ParseOutcome,
  ParseResult,
} from '../result/error.js';
import { handlerColorEnabled } from '../terminal/color.js';
import { readEnv } from './environment.js';
import {
  parseConfigured,
  tryParseConfigured,
} from './parse.js';
import { runConfiguredHandler } from './runner.js';
import type {
  CommandDefinition,
  GroupDefinition,
  GroupOptions,
  ValueConditionDefinition,
} from './schema.js';
import {
  copyCommand,
  getCommandDefinition,
  setCommandDefinition,
} from './store.js';
import type {
  CommandArguments,
  CommandType,
  commandTypeKey,
  DuplicateArgument,
  DuplicateGroup,
  DuplicateSubcommand,
  EmptyObject,
  FieldCondition,
  HandledCommand,
  HandlerContext,
  HandlerResult,
  Infer,
  RelationValue,
  RequiresIfValueCount,
  RunOptions,
  RunParsedOptions,
  Simplify,
  StringKeyOf,
} from './types.js';
import {
  validateArgument,
  validateCommandAlias,
  validateCommandName,
} from './validation/definition.js';

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
export class Command<
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

  /** Hides generated help and version flags and color switches from descendant help text. */
  hideStandardFlagsInSubcommandHelp(
    hidden = true,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    return this.with({ hideStandardFlagsInSubcommandHelp: hidden });
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

  /** Requires a target when the source matches, optionally constraining its total value count. */
  requiresIf<
    const Source extends StringKeyOf<Fields>,
    const Target extends Exclude<StringKeyOf<Fields>, Source>,
  >(
    source: Source,
    expected: RelationValue<Fields[Source]>,
    target: Target,
    valueCount?: RequiresIfValueCount,
  ): Command<Name, Fields, Subcommands, SubcommandRequired, Groups> {
    const definition = getCommandDefinition(this);
    return this.with({
      conditionalRequirements: [
        ...definition.conditionalRequirements,
        { source, expected, target, ...(valueCount === undefined ? {} : { valueCount: Object.freeze({ ...valueCount }) }) },
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
      handlerColorEnabled(options),
      options,
    );
  }

  /** Parses argv without exceptions for expected CLI outcomes. */
  tryParse(argv: readonly string[], options: ParseOptions = {}): ParseResult<Infer<this>> {
    const definition = getCommandDefinition(this);
    return tryParseConfigured<Infer<this>>(
      definition,
      argv,
      handlerColorEnabled(options),
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
    const env = options.env ?? Bun.env;
    if (readEnv(env, 'KONSTIT_CLI_COMPLETE') === '1') {
      return import('../completion/dynamic.js').then(
        ({ runDynamicCompletionRequest }) =>
          runDynamicCompletionRequest(this, {
            argv,
            env,
            ...(options.config === undefined ? {} : { config: options.config }),
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
