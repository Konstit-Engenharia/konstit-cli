import { getCommandDefinition } from '../command/store.js';
import type { CommandType } from '../command/types.js';
import { runDynamicCompletionScript } from './dynamic/script.js';
import type { CompletionShell } from './shell.js';
import { generateBash } from './static/bash.js';
import { generateFish } from './static/fish.js';
import { flattenCommands } from './static/model.js';
import { generatePowerShell } from './static/powershell.js';
import { generateZsh } from './static/zsh.js';

/** Settings for generating a shell completion script. */
export interface CompletionOptions {
  /** Command name or path users enter in the shell. Defaults to the configured command name. */
  readonly executable?: string;
  /** Invokes the CLI to resolve candidates at completion time. Defaults to false. */
  readonly dynamic?: boolean;
}

/** Generates a standalone completion script from a configured command. */
export function generateCompletion(
  configuredCommand: CommandType,
  shell: CompletionShell,
  options: CompletionOptions = {},
): string {
  const definition = getCommandDefinition(configuredCommand);
  const executable = options.executable ?? definition.name;
  validateExecutable(executable);
  if (options.dynamic) {
    return runDynamicCompletionScript(shell, executable);
  }
  const nodes = flattenCommands(definition);

  switch (shell) {
    case 'bash':
      return generateBash(nodes, executable);
    case 'zsh':
      return generateZsh(nodes, executable);
    case 'fish':
      return generateFish(nodes, executable);
    case 'powershell':
      return generatePowerShell(nodes, executable);
    default:
      throw new RangeError(`Unsupported completion shell: ${String(shell)}`);
  }
}

function validateExecutable(executable: string): void {
  if (
    executable.length === 0
    || executable.startsWith('-')
    || executable.includes('\0')
    || executable.includes('\n')
    || executable.includes('\r')
  ) {
    throw new TypeError(`Invalid completion executable: ${JSON.stringify(executable)}`);
  }
}
