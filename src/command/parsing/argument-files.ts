import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  dirname,
  resolve,
} from 'node:path';
import {
  commandError,
  sanitizeDiagnostic,
} from '../../help/diagnostics.js';
import {
  CliError,
  ErrorKind,
  type CliErrorDetails,
} from '../../result/error.js';
import type { CommandDefinition } from '../schema.js';

const maxDepth = 32;

interface ArgumentOrigin {
  readonly tokenIndex: number;
  readonly argumentFile?: NonNullable<CliErrorDetails['argumentFile']>;
}

export function expandArgumentFiles(
  definition: CommandDefinition,
  argv: readonly string[],
): { readonly tokens: string[]; readonly origins: readonly ArgumentOrigin[]; } {
  const tokens: string[] = [];
  const origins: ArgumentOrigin[] = [];
  const activeFiles = new Set<string>();

  function fail(message: string, origin: ArgumentOrigin): never {
    throw commandError(ErrorKind.InvalidArgumentFile, `${message}${fileLocation(origin)}`, definition, [definition.name], [], origin);
  }

  function expand(token: string, directory: string, origin: ArgumentOrigin): void {
    if (token.length < 2 || !token.startsWith('@') || token.startsWith('@@')) {
      tokens.push(token.startsWith('@@') ? token.slice(1) : token);
      origins.push(origin);
      return;
    }

    const path = resolve(directory, token.slice(1));
    if (activeFiles.size >= maxDepth) {
      fail(`argument file '${path}' exceeds the maximum nesting depth of ${maxDepth}`, origin);
    }
    let canonicalPath: string;
    try {
      canonicalPath = realpathSync(path);
    } catch {
      fail(`could not resolve argument file '${path}'`, origin);
    }
    if (activeFiles.has(canonicalPath)) {
      fail(`argument file '${path}' includes itself`, origin);
    }

    let bytes: Uint8Array;
    try {
      bytes = readArgumentFile(canonicalPath);
    } catch {
      fail(`could not read argument file '${path}' as a regular file`, origin);
    }
    let contents: string;
    try {
      contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail(`argument file '${path}' is not valid UTF-8`, origin);
    }

    const lines = contents.split(/\r\n|\n|\r/u);
    if (lines.at(-1) === '') {
      lines.pop();
    }
    const fileDirectory = dirname(path);
    activeFiles.add(canonicalPath);
    for (const [index, line,] of lines.entries()) {
      expand(line, fileDirectory, { tokenIndex: origin.tokenIndex, argumentFile: { path, line: index + 1 } });
    }
    activeFiles.delete(canonicalPath);
  }

  const cwd = process.cwd();
  for (const [tokenIndex, token,] of argv.entries()) {
    expand(token, cwd, { tokenIndex });
  }
  return { tokens, origins };
}

function readArgumentFile(path: string): Uint8Array {
  const file = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(file).isFile()) {
      throw new TypeError('Expected a regular file');
    }
    return readFileSync(file);
  } finally {
    closeSync(file);
  }
}

function fileLocation({ argumentFile }: ArgumentOrigin): string {
  return argumentFile === undefined ? '' : ` (from '${argumentFile.path}', line ${argumentFile.line})`;
}

export function locateArgumentFileError(error: CliError, origins: readonly ArgumentOrigin[]): CliError {
  const origin = error.tokenIndex === undefined ? undefined : origins[error.tokenIndex];
  if (origin === undefined || (origin.tokenIndex === error.tokenIndex && origin.argumentFile === undefined)) {
    return error;
  }

  const location = sanitizeDiagnostic(fileLocation(origin));
  const output = error.output.replace('\n', () => `${location}\n`);
  const { argumentName, commandPath, suggestions, relatedArguments } = error;
  return new CliError(error.kind, error.message + location, output, error.exitCode, {
    ...origin,
    ...(argumentName === undefined ? {} : { argumentName }),
    commandPath,
    suggestions,
    relatedArguments,
  });
}
