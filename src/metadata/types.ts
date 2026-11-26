import type { ArgumentDefinition } from '../argument/index.js';
import type { CommandExample } from '../command/schema.js';
import type {
  CompletionValueHint,
  EnumValue,
} from '../parser/index.js';

/** Values that can be copied into public command metadata without callbacks. */
export type MetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly MetadataValue[]
  | {
    /** Each string-keyed property must also be representable as metadata. */
    readonly [key: string]: MetadataValue;
  };

/** The static portion of a value parser exposed by command metadata. */
export interface ParserMetadata {
  /** The parser's default value placeholder in usage and help. */
  readonly label: string;
  /** Raw input strings offered as completions. */
  readonly completions?: readonly string[];
  /** The file or directory fallback for value completion. */
  readonly completionHint?: CompletionValueHint;
  /** The canonical enum choices and their accepted aliases. */
  readonly choices?: readonly EnumValue[];
  /** Whether enum values and aliases are matched case-insensitively. */
  readonly ignoreCase?: boolean;
}

/** Minimum and maximum values consumed by one argument. A null maximum is unbounded. */
export interface ArgumentArityMetadata {
  /** The minimum number of values accepted per occurrence. */
  readonly min: number;
  /** The maximum number of values accepted per occurrence, or null if unbounded. */
  readonly max: number | null;
}

/** A parseable command argument with executable callbacks removed. */
export interface ArgumentMetadata {
  /** The key used for this argument in parsed values. */
  readonly name: string;
  /** Whether the argument is an option, positional, flag, or counter. */
  readonly kind: ArgumentDefinition['kind'];
  /** What the parser does when the argument is supplied. */
  readonly action: ArgumentDefinition['action'];
  /** Whether the flag controls automatic color selection. */
  readonly color: boolean;
  /** The short spelling without its leading hyphen. */
  readonly short?: string;
  /** The long spelling without its leading hyphens. */
  readonly long?: string;
  /** The long spelling that disables a color flag, without leading hyphens. */
  readonly negativeLong?: string;
  /** Additional long spellings without leading hyphens. */
  readonly aliases: readonly string[];
  /** The warning message emitted when the argument is supplied explicitly. */
  readonly deprecated?: string;
  /** Warning messages keyed by deprecated long alias. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** The description shown in help. */
  readonly help?: string;
  /** The heading under which this argument is rendered in generated help and documentation. */
  readonly helpHeading?: string;
  /** The value placeholder shown in usage and help. */
  readonly valueName?: string;
  /** The argument's requiredness or default status. */
  readonly presence: ArgumentDefinition['presence'];
  /** Whether the argument's presence mode is `default`, even if its value cannot be copied. */
  readonly hasDefaultValue: boolean;
  /** The scalar fallback when the argument is absent, if representable as metadata. */
  readonly defaultValue?: MetadataValue;
  /** The collection fallback when the argument is absent, if representable as metadata. */
  readonly defaultValues?: readonly MetadataValue[];
  /** The fallback for an option used without a value, if representable as metadata. */
  readonly defaultMissingValue?: MetadataValue;
  /** Whether a missing-value fallback was configured, even if its value cannot be copied. */
  readonly hasDefaultMissingValue: boolean;
  /** Whether values are collected across repeated occurrences. */
  readonly repeatable: boolean;
  /** Present when the option rejects duplicate parsed values. */
  readonly unique?: true;
  /** The minimum number of values accepted per occurrence. */
  readonly minValues: number;
  /** The maximum number of values accepted per occurrence, or null if unbounded. */
  readonly maxValues: number | null;
  /** The minimum and maximum accepted value counts. */
  readonly arity: ArgumentArityMetadata;
  /** The delimiter used to split raw values before parsing. */
  readonly valueDelimiter?: string;
  /** The token that ends value collection for the argument. */
  readonly valueTerminator?: string;
  /** Whether the option requires `--option=value` syntax. */
  readonly requireEquals: boolean;
  /** Whether values may begin with a hyphen. */
  readonly allowHyphenValues: boolean;
  /** Whether negative numeric tokens are accepted as values. */
  readonly allowNegativeNumbers: boolean;
  /** Whether this positional can capture trailing tokens that look like options. */
  readonly trailingVarArg: boolean;
  /** Whether the argument is inherited by descendant commands. */
  readonly global: boolean;
  /** Whether the argument is omitted from help and completion. */
  readonly hidden: boolean;
  /** Marks an argument whose defaults and parser value metadata are private. */
  readonly sensitive?: true;
  /** The environment variable used as a fallback. */
  readonly env?: string;
  /** The argument's explicit file or directory completion hint. */
  readonly completionHint?: CompletionValueHint;
  /** Whether the argument has a dynamic value completer. */
  readonly hasDynamicCompletion: boolean;
  /** The static information for this argument's value parser. */
  readonly parser?: ParserMetadata;
}

/** A command alias with no reference to the command's executable definition. */
export interface CommandAliasMetadata {
  /** The alternative spelling accepted by the parser. */
  readonly name: string;
  /** Whether the alias appears in help and completion. */
  readonly visible: boolean;
}

/** A directional relation between two arguments, such as a dependency or override. */
export interface RequirementMetadata {
  /** The argument that triggers the relation. */
  readonly source: string;
  /** The argument affected by the relation. */
  readonly target: string;
}

/** A requirement that compares either the source or target to an expected value. */
export interface ConditionalRequirementMetadata extends RequirementMetadata {
  /** The comparison value, omitted if it cannot be represented as metadata. */
  readonly expected?: MetadataValue;
}

/** A comparison between a parsed argument and a configured value. */
export interface ValueConditionMetadata {
  /** The name of the argument being compared. */
  readonly source: string;
  /** The expected value, omitted if it cannot be represented as metadata. */
  readonly expected?: MetadataValue;
}

/** A requirement triggered by matching any or all of a set of value conditions. */
export interface ConditionalSetRequirementMetadata {
  /** The argument required when the conditions match. */
  readonly target: string;
  /** The conditions evaluated for the target. */
  readonly conditions: readonly ValueConditionMetadata[];
  /** Whether any condition or every condition must match. */
  readonly match: 'any' | 'all';
}

/** A requirement that can be waived by supplying alternative arguments. */
export interface RequiredUnlessMetadata {
  /** The argument required when the alternatives do not satisfy the rule. */
  readonly target: string;
  /** The arguments whose presence can waive the requirement. */
  readonly alternatives: readonly string[];
}

/** An argument group and its presence, dependency, and conflict rules. */
export interface GroupMetadata {
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

/** Options shared by metadata export and documentation renderers. */
export interface CommandMetadataOptions {
  /** Includes hidden arguments, aliases, and subcommands in the result. */
  readonly includeHidden?: boolean;
}

/** A conditional fallback, with unsupported values omitted from metadata. */
export interface ConditionalDefaultMetadata {
  /** The argument that triggers the fallback. */
  readonly source: string;
  /** The argument that receives the fallback. */
  readonly target: string;
  /** Whether the rule compares the source to a configured value. */
  readonly hasEquals: boolean;
  /** The comparison value if configured and representable as metadata. */
  readonly equals?: MetadataValue;
  /** The fallback value if representable as metadata. */
  readonly value?: MetadataValue;
}

/** An immutable, callback-free description of one command and its descendants. */
export interface CommandMetadata {
  /** The canonical command name. */
  readonly name: string;
  /** Canonical command names from the root to this command. */
  readonly path: readonly string[];
  /** The warning message emitted when the command is invoked. */
  readonly deprecated?: string;
  /** Warning messages keyed by deprecated alias. */
  readonly deprecatedAliases?: Readonly<Record<string, string>>;
  /** Alternative spellings accepted by the parser. */
  readonly aliases: readonly CommandAliasMetadata[];
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
  /** Arguments declared directly on this command. */
  readonly arguments: readonly ArgumentMetadata[];
  /** Global arguments inherited from ancestor commands, in canonical order. */
  readonly inheritedArguments: readonly ArgumentMetadata[];
  /** The child commands included in this description. */
  readonly subcommands: readonly CommandMetadata[];
  /** Dependencies triggered by the presence of a source argument. */
  readonly requirements: readonly RequirementMetadata[];
  /** Dependencies triggered by a matching source value. */
  readonly conditionalRequirements: readonly ConditionalRequirementMetadata[];
  /** Each provided source requires its target to match the expected value. */
  readonly requiresValue: readonly ConditionalRequirementMetadata[];
  /** Fallbacks triggered by another argument's presence or value. */
  readonly defaultIf: readonly ConditionalDefaultMetadata[];
  /** Dependencies triggered by matching any or all value conditions. */
  readonly conditionalSetRequirements: readonly ConditionalSetRequirementMetadata[];
  /** Requirements waived when any alternative is present. */
  readonly requiredUnless: readonly RequiredUnlessMetadata[];
  /** Requirements waived when all alternatives are present. */
  readonly requiredUnlessAll: readonly RequiredUnlessMetadata[];
  /** Arguments that conflict with every other supplied argument. */
  readonly exclusiveArguments: readonly string[];
  /** Relations that clear a target when its source is explicitly provided. */
  readonly overrides: readonly RequirementMetadata[];
  /** Sets of mutually exclusive arguments. */
  readonly conflicts: readonly (readonly string[])[];
  /** Named argument groups declared on this command. */
  readonly groups: readonly GroupMetadata[];
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
