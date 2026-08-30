import type { ArgumentDefinition } from '../argument.js';
import type { CommandHandler } from '../command.js';

export interface RequirementDefinition {
  readonly source: string;
  readonly target: string;
}

export interface ConditionalRequirementDefinition extends RequirementDefinition {
  readonly expected: unknown;
}

export interface ValueConditionDefinition {
  readonly source: string;
  readonly expected: unknown;
}

export interface ConditionalSetRequirementDefinition {
  readonly target: string;
  readonly conditions: readonly ValueConditionDefinition[];
  readonly match: 'any' | 'all';
}

export interface RequiredUnlessDefinition {
  readonly target: string;
  readonly alternatives: readonly string[];
}

export interface OverrideDefinition extends RequirementDefinition {}

export interface CommandAliasDefinition {
  readonly name: string;
  readonly visible: boolean;
}

export interface GroupDefinition {
  readonly name: string;
  readonly members: readonly string[];
  readonly required: boolean;
  readonly multiple: boolean;
  readonly requires: readonly string[];
  readonly conflicts: readonly string[];
}

export interface GroupOptions {
  /** At least one member must be present. */
  readonly required?: boolean;
  /** More than one member can be present. The default is false. */
  readonly multiple?: boolean;
}

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
