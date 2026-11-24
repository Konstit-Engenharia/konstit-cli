/** Receives one output chunk. The runner awaits the result and ignores its value. */
export type OutputWriter = (chunk: string) => unknown;

export type OutputChannel = 'stdout' | 'stderr';

export async function writeOutput(channel: OutputChannel, chunk: string, writer?: OutputWriter): Promise<void> {
  if (writer === undefined) {
    await Bun.write(Bun[channel], chunk);
  } else {
    await writer(chunk);
  }
}
