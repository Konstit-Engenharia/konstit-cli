import type { AnyArgument } from '../argument/index.js';
import type { ParseOptions } from '../configuration/shape.js';
import type {
  ParseOutcome,
  ParseResult,
} from '../result/error.js';
import {
  Command,
  conditionalDefaultCollectsValues,
} from './configurator.js';
import { prepareCommandExamples } from './examples.js';
import {
  copyCommand,
  getCommandDefinition,
  setCommandDefinition,
} from './store.js';
import type {
  AnyCommand,
  CheckedCommandOptions,
  CommandGroupOptions,
  CommandOptions,
  CommandType,
  EmptyObject,
  FieldsFromArguments,
  GroupNamesFromTuple,
  HandledCommand,
  RunOptions,
  RunParsedOptions,
  StringKeyOf,
  SubcommandsFromTuple,
} from './types.js';
import { validateCommandName } from './validation/definition.js';
import { validateCommandOptions } from './validation/options.js';
import { validateCommandRelations } from './validation/relations.js';

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
    hideStandardFlagsInSubcommandHelp: false,
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
  if (options.hideStandardFlagsInSubcommandHelp !== undefined) {
    configured = configured.hideStandardFlagsInSubcommandHelp(options.hideStandardFlagsInSubcommandHelp);
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
  if (options.examples !== undefined && options.examples.length > 0) {
    const definition = getCommandDefinition(configured);
    configured = new Command(copyCommand(definition, { examples: prepareCommandExamples(definition, options.examples) }));
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
