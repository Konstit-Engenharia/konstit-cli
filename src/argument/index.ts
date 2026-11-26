/** Public argument factories and their normalized definitions. */
export { colorFlag, count, flag, option, positional } from './factories.js';
export type {
  ArgumentCardinality,
  ArgumentKind,
  ArgumentOptions,
  ArgumentPresence,
  CountOptions,
  FlagOptions,
  NamedArgumentOptions,
  OptionOptions,
  PositionalOptions,
  ValueCountRange,
} from './options.js';
export { ArgumentAction, collectsArgumentValues, getArgumentDefinition } from './runtime.js';
export type {
  AnyArgument,
  AnyGlobalArgument,
  ArgumentDefinition,
  ArgumentName,
  ArgumentOutput,
  ArgumentType,
  GlobalArgument,
} from './types.js';
