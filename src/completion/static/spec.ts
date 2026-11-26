import type { ArgumentDefinition } from '../../argument/types.js';
import { shellQuote } from '../quotes.js';

export function shellMaximum(argument: ArgumentDefinition): number {
  return argument.trailingVarArg ? -1 : argument.maxValues ?? -1;
}

export function shellOptionSpec(argument: ArgumentDefinition): string {
  return [
    argument.minValues,
    shellMaximum(argument),
    argument.requireEquals ? 1 : 0,
    encodeShellDelimiter(argument.valueDelimiter),
    argument.allowHyphenValues ? 1 : 0,
    argument.allowNegativeNumbers ? 1 : 0,
    argument.repeatable && argument.maxValues === 1 ? 1 : 0,
    encodeShellDelimiter(argument.valueTerminator),
  ].join('\t');
}

export function shellPositionalSpec(argument: ArgumentDefinition): string {
  return [
    shellMaximum(argument),
    encodeShellDelimiter(argument.valueDelimiter),
    argument.allowHyphenValues ? 1 : 0,
    argument.allowNegativeNumbers ? 1 : 0,
    argument.repeatable ? 1 : 0,
    encodeShellDelimiter(argument.valueTerminator),
    argument.trailingVarArg ? 1 : 0,
  ].join('\t');
}

export function encodeShellDelimiter(delimiter: string | undefined): string {
  return delimiter === undefined ? '-' : Buffer.from(delimiter).toString('hex');
}

export function casePatterns(id: string, tokens: readonly string[]): string {
  return tokens.map((token) => shellQuote(`${id}:${token}`)).join('|');
}
