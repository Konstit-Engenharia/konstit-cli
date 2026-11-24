import type {
  HandledCommand,
  RunOptions,
} from './command/types.js';
import type { OutputChannel } from './terminal/output.js';

/** One captured write to a standard stream. */
export interface InvokeWrite {
  /** The stream that received the write. */
  readonly stream: OutputChannel;
  /** The exact chunk passed to the sink. */
  readonly chunk: string;
}

/** Captured output and exit status from a command invocation. */
export interface InvokeResult {
  /** The exit code returned by the runner. */
  readonly exitCode: number;
  /** Standard output chunks joined in write order. */
  readonly stdout: string;
  /** Standard error chunks joined in write order. */
  readonly stderr: string;
  /** Individual writes in order across both streams. */
  readonly writes: readonly InvokeWrite[];
}

/** Configuration, environment, input, cancellation, and diagnostics options for an in-process command invocation. */
export type InvokeOptions = Pick<RunOptions, 'config' | 'env' | 'stdin' | 'signal' | 'diagnostics'>;

/** Runs a command in process with the supplied options and captures its output. */
export async function invoke(
  cli: HandledCommand,
  argv: readonly string[],
  { config, env, stdin, signal, diagnostics }: InvokeOptions = {},
): Promise<InvokeResult> {
  const chunks: Record<OutputChannel, string[]> = { stdout: [], stderr: [] };
  const writes: InvokeWrite[] = [];
  const capture = (stream: OutputChannel) => (chunk: string): void => {
    chunks[stream].push(chunk);
    writes.push({ stream, chunk });
  };
  const stdout = capture('stdout');
  const stderr = capture('stderr');
  const exitCode = await cli.run({
    argv,
    ...(config === undefined ? {} : { config }),
    ...(env === undefined ? {} : { env }),
    ...(stdin === undefined ? {} : { stdin }),
    ...(signal === undefined ? {} : { signal }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
    stdout,
    stderr,
    output: { stdout, stderr },
  });
  return { exitCode, stdout: chunks.stdout.join(''), stderr: chunks.stderr.join(''), writes: writes.slice() };
}
