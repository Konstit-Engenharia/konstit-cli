import type { ArgumentDefinition } from '../argument/index.js';
import { argumentLongNames } from '../command/parsing/recognition.js';
import type { CommandDefinition } from '../command/schema.js';
import {
  CliError,
  type CliErrorDetails,
  type ErrorKind,
} from '../result/error.js';
import { renderUsage } from './usage.js';

export function commandError(
  kind: ErrorKind,
  message: string,
  definition: CommandDefinition,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[] = [],
  details: Omit<CliErrorDetails, 'commandPath'> = {},
): CliError {
  const usage = renderUsage(definition, path, inheritedArguments);
  const safeMessage = sanitizeDiagnostic(message);
  return new CliError(
    kind,
    safeMessage,
    `error: ${safeMessage}\n\n${usage}\n\nFor more information, try '--help'.\n`,
    2,
    { ...details, commandPath: path },
  );
}

export function sanitizeDiagnostic(message: string): string {
  return message.replace(/[\p{Cc}\p{Cf}]/gu, (character) => {
    if (character === '\n') {
      return '\\n';
    }
    if (character === '\r') {
      return '\\r';
    }
    if (character === '\t') {
      return '\\t';
    }
    const codePoint = character.codePointAt(0);
    return codePoint === undefined ? '' : `\\u{${codePoint.toString(16)}}`;
  });
}

export function suggestTokenCandidates(
  token: string,
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): readonly string[] {
  const candidates = [
    ...[...definition.arguments, ...inheritedArguments].flatMap((argument) => [
      ...argumentLongNames(argument).map((name) => `--${name}`),
      ...(argument.short === undefined ? [] : [`-${argument.short}`]),
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
  return best !== undefined && bestDistance <= limit ? [best] : [];
}

export function suggestToken(
  token: string,
  definition: CommandDefinition,
  inheritedArguments: readonly ArgumentDefinition[] = [],
): string {
  const [suggestion,] = suggestTokenCandidates(token, definition, inheritedArguments);
  return suggestion === undefined ? '' : `; a similar argument exists: '${suggestion}'`;
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
