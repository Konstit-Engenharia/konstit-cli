import type {
  HandledCommand,
  RunOptions,
} from './command.js';
import type { OutputChannel } from './command/output.js';

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

/** Input options for an in-process command invocation. */
export type InvokeOptions = Pick<RunOptions, 'stdin'>;

/** Runs a command in process with optional input and captures runner and handler output. */
export async function invoke(
  cli: HandledCommand,
  argv: readonly string[],
  { stdin }: InvokeOptions = {},
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
    ...(stdin === undefined ? {} : { stdin }),
    stdout,
    stderr,
    output: { stdout, stderr },
  });
  return { exitCode, stdout: chunks.stdout.join(''), stderr: chunks.stderr.join(''), writes: writes.slice() };
}
