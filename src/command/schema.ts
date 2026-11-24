import type { ArgumentDefinition } from '../argument/index.js';
import type {
  CommandHandler,
  CommandValidator,
} from './types.js';

/** A directional relation between two arguments. */
export interface RequirementDefinition {
  /** The argument that triggers the relation. */
  readonly source: string;
  /** The argument affected by the relation. */
  readonly target: string;
}

/** A dependency that compares either the source or target to an expected value. */
export interface ConditionalRequirementDefinition extends RequirementDefinition {
  /** The value compared against the source in requiresIf or the target in requiresValue. */
  readonly expected: unknown;
}

/** A comparison of one argument to a configured value. */
export interface ValueConditionDefinition {
  /** The name of the argument being compared. */
  readonly source: string;
  /** The expected value or collection item. */
  readonly expected: unknown;
}

/** A requirement triggered by matching any or all of a set of value conditions. */
export interface ConditionalSetRequirementDefinition {
  /** The argument required when the conditions match. */
  readonly target: string;
  /** The conditions evaluated for the target. */
  readonly conditions: readonly ValueConditionDefinition[];
  /** Whether any condition or every condition must match. */
  readonly match: 'any' | 'all';
}

/** A requirement that can be waived by supplying alternative arguments. */
export interface RequiredUnlessDefinition {
  /** The argument required when the alternatives do not satisfy the rule. */
  readonly target: string;
  /** The arguments whose presence can waive the requirement. */
  readonly alternatives: readonly string[];
}

/** A fallback triggered by another argument's presence or value. */
export interface ConditionalDefaultDefinition {
  /** The argument that triggers the fallback. */
  readonly source: string;
  /** The value to compare against the source when `hasEquals` is true. */
  readonly equals?: unknown;
  /** The argument that receives the fallback. */
  readonly target: string;
  /** The value to supply when the rule matches. */
  readonly value: unknown;
  /** Whether to compare the source value. Otherwise the rule checks whether the source was supplied. */
  readonly hasEquals: boolean;
}

/** An argument relation that clears a target when its source is explicitly supplied. */
export interface OverrideDefinition extends RequirementDefinition {}

/** An alternate spelling for a command. */
export interface CommandAliasDefinition {
  /** The alias accepted by the parser. */
  readonly name: string;
  /** Whether the alias appears in help and completion. */
  readonly visible: boolean;
}

/** An argument group and its presence, dependency, and conflict rules. */
export interface GroupDefinition {
  /** The group name used in diagnostics. */
  readonly name: string;
  /** The names of arguments in the group. */
  readonly members: readonly string[];
  /** Whether at least one group member must be present. */
  readonly required: boolean;
  /** Whether multiple group members may be present together. */
  readonly multiple: boolean;
  /** Arguments required when a group member is present. */
  readonly requires: readonly string[];
  /** Arguments that cannot be combined with a group member. */
  readonly conflicts: readonly string[];
}

/** Controls whether and how many arguments in a group must be supplied. */
export interface GroupOptions {
  /** At least one member must be present. */
  readonly required?: boolean;
  /** More than one member can be present. The default is false. */
  readonly multiple?: boolean;
}

/** An invocation and its description shown in generated documentation. */
export interface CommandExample {
  /** The command line as it should appear to the reader. */
  readonly command: string;
  /** What the example demonstrates. */
  readonly description: string;
}

/** The normalized command configuration available to completion providers. */
export interface CommandDefinition {
  /** The canonical command name. */
  readonly name: string;
  /** The warning message emitted when the command is invoked. */
  readonly deprecated?: string;
  /** Warning messages keyed by deprecated alias. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** Alternative spellings accepted by the parser. */
  readonly aliases: readonly CommandAliasDefinition[];
  /** The short description shown in help and completion. */
  readonly about?: string;
  /** The extended description shown in full help. */
  readonly longAbout?: string;
  /** The author line shown in help. */
  readonly author?: string;
  /** Text placed before the generated help content. */
  readonly beforeHelp?: string;
  /** Text placed after the generated help content. */
  readonly afterHelp?: string;
  /** Example invocations in display order. */
  readonly examples?: readonly CommandExample[];
  /** Text that replaces the generated usage line. */
  readonly overrideUsage?: string;
  /** Text that replaces the generated help output. */
  readonly overrideHelp?: string;
  /** The text displayed for a version request. */
  readonly version?: string;
  /** The callback invoked after standard parsing and relation checks complete. */
  readonly validate?: CommandValidator<never, string>;
  /** The callback invoked by the runner when this command is selected. */
  readonly handler?: CommandHandler<never>;
  /** Arguments declared directly on this command, in declaration order. */
  readonly arguments: readonly ArgumentDefinition[];
  /** Child commands in declaration order, including hidden commands. */
  readonly subcommands: readonly CommandDefinition[];
  /** Dependencies triggered by the presence of a source argument. */
  readonly requirements: readonly RequirementDefinition[];
  /** Dependencies triggered by a matching source value. */
  readonly conditionalRequirements: readonly ConditionalRequirementDefinition[];
  /** Dependencies that require a target value when a source argument is present. */
  readonly requiresValue: readonly ConditionalRequirementDefinition[];
  /** Dependencies triggered by matching any or all value conditions. */
  readonly conditionalSetRequirements: readonly ConditionalSetRequirementDefinition[];
  /** Requirements waived when any alternative is present. */
  readonly requiredUnless: readonly RequiredUnlessDefinition[];
  /** Requirements waived when all alternatives are present. */
  readonly requiredUnlessAll: readonly RequiredUnlessDefinition[];
  /** Fallbacks triggered by another argument's presence or value. */
  readonly defaultIf: readonly ConditionalDefaultDefinition[];
  /** Arguments that conflict with every other supplied argument. */
  readonly exclusiveArguments: readonly string[];
  /** Relations that clear a target when its source is explicitly provided. */
  readonly overrides: readonly OverrideDefinition[];
  /** Sets of mutually exclusive arguments. */
  readonly conflicts: readonly (readonly string[])[];
  /** Named argument groups declared on this command. */
  readonly groups: readonly GroupDefinition[];
  /** Whether invoking the command requires selecting a subcommand. */
  readonly subcommandRequired: boolean;
  /** Whether CLI-supplied local arguments conflict with a selected subcommand. */
  readonly argsConflictWithSubcommands: boolean;
  /** Whether later occurrences of non-repeatable options and ordinary flags replace earlier values. */
  readonly argsOverrideSelf: boolean;
  /** Whether an invocation with no argument or subcommand displays help. */
  readonly argRequiredElseHelp: boolean;
  /** Whether unambiguous subcommand and alias prefixes are accepted. */
  readonly inferSubcommands: boolean;
  /** Whether the generated `help` subcommand is disabled. */
  readonly disableHelpSubcommand: boolean;
  /** Whether the generated `-h` and `--help` flags are disabled. */
  readonly disableHelpFlag: boolean;
  /** Whether the generated `-V` and `--version` flags are disabled. */
  readonly disableVersionFlag: boolean;
  /** Whether the command is omitted from parent help and completion. */
  readonly hidden: boolean;
}
