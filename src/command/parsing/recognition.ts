import type { ArgumentDefinition } from '../../argument/index.js';
import type { CommandDefinition } from '../../command/index.js';

export const commandWords = { kind: 'command' } as const;
export const literalWords = { kind: 'literal' } as const;

export type WordState = typeof commandWords | typeof literalWords;

export interface OptionValueState {
  readonly kind: 'option-values';
  readonly argument: ArgumentDefinition;
  consumed: number;
}

export type ArgvState = WordState | OptionValueState;
type WordKind = 'end-options' | 'long-option' | 'short-options' | 'command-word' | 'positional';
type OptionValueAction = 'take-value' | 'take-terminator' | 'resume-command';

export function recognizeWord(
  state: WordState,
  word: string,
  consumeAsPositional: boolean,
): WordKind {
  if (state.kind === 'literal') {
    return 'positional';
  }
  if (word === '--') {
    return 'end-options';
  }
  if (consumeAsPositional) {
    return 'positional';
  }
  if (word.startsWith('--')) {
    return 'long-option';
  }
  return word !== '-' && word.startsWith('-') ? 'short-options' : 'command-word';
}

export function recognizeOptionValue(
  { argument, consumed }: OptionValueState,
  word: string,
  isSubcommand: (word: string) => boolean,
): OptionValueAction {
  if (argument.valueTerminator === word) {
    return 'take-terminator';
  }
  if (stopsOptionValueCollection(argument, word) || (consumed >= argument.minValues && isSubcommand(word))) {
    return 'resume-command';
  }
  return 'take-value';
}

export function optionAcceptsMoreValues({ argument, consumed }: OptionValueState): boolean {
  return argument.maxValues === null || consumed < argument.maxValues;
}

export interface LongOptionToken {
  readonly name: string;
  readonly inlineValue?: string;
}

export type SubcommandMatch =
  | { readonly kind: 'none'; }
  | { readonly kind: 'exact'; readonly command: CommandDefinition; }
  | { readonly kind: 'unique'; readonly command: CommandDefinition; }
  | { readonly kind: 'ambiguous'; readonly commands: readonly CommandDefinition[]; };

export function argumentLongNames(
  argument: ArgumentDefinition,
): readonly string[] {
  return [argument.long, argument.negativeLong, ...argument.aliases].filter(
    (value): value is string => value !== undefined,
  );
}

export function parseLongOptionToken(token: string): LongOptionToken {
  const equalsIndex = token.indexOf('=');
  return equalsIndex === -1
    ? { name: token.slice(2) }
    : { name: token.slice(2, equalsIndex), inlineValue: token.slice(equalsIndex + 1) };
}

export function parseShortOptionCluster(token: string): readonly string[] {
  return Array.from(token.slice(1));
}

export function isNegativeNumberToken(token: string): boolean {
  return /^-(?:\d|\.\d)/.test(token);
}

export function splitArgumentValue(
  argument: ArgumentDefinition,
  raw: string,
): readonly string[] {
  return argument.valueDelimiter === undefined
    ? [raw]
    : raw.split(argument.valueDelimiter);
}

function stopsOptionValueCollection(
  argument: ArgumentDefinition,
  token: string,
): boolean {
  if (argument.allowHyphenValues) {
    return false;
  }
  if (argument.allowNegativeNumbers && isNegativeNumberToken(token)) {
    return false;
  }
  return token === '--' || (token.startsWith('-') && token !== '-');
}

export function matchSubcommand(
  definition: CommandDefinition,
  token: string,
): SubcommandMatch {
  const exact = definition.subcommands.find(
    (child) => child.name === token || child.aliases.some(({ name }) => name === token),
  );
  if (exact !== undefined) {
    return { kind: 'exact', command: exact };
  }
  if (!definition.inferSubcommands) {
    return { kind: 'none' };
  }

  const commands = definition.subcommands.filter(
    (child) =>
      child.name.startsWith(token)
      || child.aliases.some(({ name }) => name.startsWith(token)),
  );
  if (commands.length === 1) {
    return { kind: 'unique', command: commands[0] as CommandDefinition };
  }
  return commands.length === 0
    ? { kind: 'none' }
    : { kind: 'ambiguous', commands };
}
