import type { Environment } from '../../command/environment.js';
import type { CommandType } from '../../command/types.js';
import type { CommandConfig } from '../../configuration/shape.js';
import {
  CliError,
  ErrorKind,
} from '../../result/error.js';
import {
  writeOutput,
  type OutputWriter,
} from '../../terminal/output.js';
import { resolveCompletion } from './resolve.js';
import type { DynamicCompletionResult } from './types.js';

/** Internal inputs used by Command.run for one shell completion request. */
export interface DynamicCompletionRequestOptions {
  /** Arguments after the executable, including the incomplete word. */
  readonly argv?: readonly string[];
  /** Index of the incomplete word. Defaults to the final argv item. */
  readonly cursor?: number;
  readonly argumentFiles?: boolean;
  readonly env?: Environment;
  /** Configuration values used below CLI and environment values. */
  readonly config?: CommandConfig;
  readonly stdout?: OutputWriter;
}

/** Resolves and writes the shell request detected by Command.run. */
export async function runDynamicCompletionRequest(
  configuredCommand: CommandType,
  options: DynamicCompletionRequestOptions = {},
): Promise<number> {
  let result: DynamicCompletionResult;
  try {
    result = await resolveCompletion(
      configuredCommand,
      options.argv ?? Bun.argv.slice(2),
      {
        ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
        ...(options.argumentFiles === undefined ? {} : { argumentFiles: options.argumentFiles }),
        ...(options.config === undefined ? {} : { config: options.config }),
      },
      options.env ?? Bun.env,
    );
  } catch (error) {
    if (error instanceof CliError && error.kind === ErrorKind.InvalidArgumentFile) {
      return 0;
    }
    throw error;
  }
  if (result.candidates.length > 0) {
    const output = `${
      result.candidates.map(({ value, description }) => `${encodeProtocolField(value)}\t${encodeProtocolField(description ?? '')}`).join(
        '\n',
      )
    }\n`;
    await writeOutput('stdout', output, options.stdout);
  }
  return 0;
}

function encodeProtocolField(value: string): string {
  return Buffer.from(value).toString('hex');
}
