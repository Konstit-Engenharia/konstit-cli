import type { ArgumentDefinition } from '../../argument/index.js';
import {
  commandError,
  suggestToken,
  suggestTokenCandidates,
} from '../../help/diagnostics.js';
import { createHelpDisplay } from '../../help/render.js';
import {
  ErrorKind,
  type ParseDisplay,
} from '../../result/error.js';
import type { CommandDefinition } from '../schema.js';
import { matchSubcommand } from './recognition.js';
import type { GlobalBinding } from './types.js';

export function hasExactSubcommand(
  definition: CommandDefinition,
  token: string,
): boolean {
  return matchSubcommand(definition, token).kind === 'exact';
}

export function resolveSubcommand(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
  tokenIndex: number,
  redactToken: boolean,
): CommandDefinition | undefined {
  return resolveSubcommandWithArguments(
    definition,
    token,
    path,
    inheritedGlobals.map(({ argument }) => argument),
    tokenIndex,
    redactToken,
  );
}

export function resolveSubcommandWithArguments(
  definition: CommandDefinition,
  token: string,
  path: readonly string[],
  inheritedArguments: readonly ArgumentDefinition[],
  tokenIndex: number,
  redactToken = false,
): CommandDefinition | undefined {
  const match = matchSubcommand(definition, token);
  if (match.kind === 'exact' || match.kind === 'unique') {
    return match.command;
  }
  if (match.kind === 'ambiguous') {
    throw commandError(
      ErrorKind.InvalidSubcommand,
      `subcommand '${redactToken ? '[redacted]' : token}' is ambiguous: ${match.commands.map(({ name }) => name).join(', ')}`,
      definition,
      path,
      inheritedArguments,
      { tokenIndex, suggestions: match.commands.map(({ name }) => name) },
    );
  }
  return undefined;
}

export function renderSubcommandHelp(
  definition: CommandDefinition,
  tokens: readonly string[],
  argvOffset: number,
  path: readonly string[],
  inheritedGlobals: readonly GlobalBinding[],
  parentHidesStandardFlags: boolean,
): ParseDisplay {
  let current = definition;
  let currentPath = [...path];
  let inheritedArguments = inheritedGlobals.map(({ argument }) => argument);
  let hideStandardFlags = parentHidesStandardFlags;

  for (const [tokenIndex, token,] of tokens.entries()) {
    const globalsForChild = [
      ...inheritedArguments,
      ...current.arguments.filter(({ global }) => global),
    ];
    const child = resolveSubcommandWithArguments(
      current,
      token,
      currentPath,
      globalsForChild,
      argvOffset + tokenIndex,
    );
    if (child === undefined) {
      const suggestions = suggestTokenCandidates(token, current, globalsForChild);
      throw commandError(
        ErrorKind.InvalidSubcommand,
        `unrecognized subcommand '${token}'${suggestToken(token, current, globalsForChild)}`,
        current,
        currentPath,
        inheritedArguments,
        {
          tokenIndex: argvOffset + tokenIndex,
          suggestions,
        },
      );
    }
    hideStandardFlags ||= current.hideStandardFlagsInSubcommandHelp;
    current = child;
    currentPath = [...currentPath, child.name];
    inheritedArguments = globalsForChild;
  }
  return createHelpDisplay(current, currentPath, inheritedArguments, { hideStandardFlags });
}
