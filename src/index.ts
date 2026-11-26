export {
  type ArgumentOptions,
  colorFlag,
  count,
  type CountOptions,
  flag,
  type FlagOptions,
  type NamedArgumentOptions,
  option,
  type OptionOptions,
  positional,
  type PositionalOptions,
  type ValueCountRange,
} from './argument/index.js';
export { command } from './command/index.js';
export type { CommandExample, CommandExampleInput } from './command/schema.js';
export type {
  CommandGroupOptions,
  CommandHandler,
  CommandOptions,
  CommandValidationIssue,
  CommandValidator,
  HandledCommand,
  HandlerContext,
  HandlerResult,
  Infer,
  RequirementConditionInput,
  RunOptions,
  RunParsedOptions,
} from './command/types.js';
export { type CompletionShell, completionShells, isCompletionShell } from './completion/shell.js';
export { loadConfig, loadConfigs } from './configuration/load.js';
export { type CommandConfigSchema, generateConfigSchema } from './configuration/schema.js';
export type { CommandConfig, ConfigValue, ParseOptions } from './configuration/shape.js';
export {
  type ConfigValidationIssue,
  type ConfigValidationIssueKind,
  type ConfigValidationResult,
  validateConfig,
} from './configuration/validation.js';
export { describeCommand } from './metadata/describe.js';
export { type ManPageOptions, renderManPage } from './metadata/man-page.js';
export { type MarkdownOptions, renderMarkdown } from './metadata/markdown.js';
export type {
  ArgumentArityMetadata,
  ArgumentMetadata,
  CommandAliasMetadata,
  CommandMetadata,
  CommandMetadataOptions,
  ConditionalDefaultMetadata,
  ConditionalRequirementMetadata,
  ConditionalSetRequirementMetadata,
  GroupMetadata,
  GroupRequirementMetadata,
  MetadataValue,
  ParserMetadata,
  RequiredUnlessMetadata,
  RequirementMetadata,
  ValueConditionMetadata,
} from './metadata/types.js';
export {
  type CompletionValueHint,
  type EnumParserOptions,
  type EnumValue,
  type KeyValuePair,
  parsers,
  type PathParserOptions,
  type RangeParserOptions,
  type ValueParser,
  type ValueParserOptions,
} from './parser/index.js';
export { type DeprecationWarning, getWarnings } from './result/deprecation.js';
export {
  CliError,
  type CliErrorDetails,
  CommandFailure,
  DisplayKind,
  ErrorKind,
  type ParseDisplay,
  type ParseFailure,
  type ParseOutcome,
  type ParseResult,
  type ParseValue,
} from './result/error.js';
export { getConfigValueFile, getValueSource, type ValueSource } from './result/value-source.js';
export type { ConsoleOptions, ConsoleWriters, HandlerConsole, SyncOutputWriter } from './terminal/console.js';
export type { OutputWriter } from './terminal/output.js';
export type { FileStat, FileStyleOptions, LinkStyleOptions, PathStyleOptions, Style, StyleOptions } from './terminal/style.js';
