import {
  expect,
  spyOn,
  test,
} from 'bun:test';
import * as fs from 'node:fs';
import {
  command,
  type ConsoleWriters,
  type HandlerConsole,
  type SyncOutputWriter,
} from '../src';

test('console methods finish synchronously and use independent sinks for nested handlers', async () => {
  const events: string[] = [];
  const cli = command('tool', {
    subcommands: [command('work', {
      handler: async (_args, context) => {
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.output)).toBe(true);
        expect(Object.isFrozen(context.style)).toBe(true);
        expect(context.output.log('one  ')).toBeUndefined();
        expect(events).toEqual(['console out one  \n']);
        context.output.info('files: %d', 2);
        context.output.debug('debug', { ready: true });
        context.output.debug();
        context.output.warn('warning', false);
        context.output.error('%s\n', 'failure');
        await context.stdout('six');
        context.output.log('seven', 7);
        await context.stderr('eight');
      },
    })],
  });
  const options = {
    color: false,
    output: {
      stdout: (text: string) => events.push(`console out ${text}`),
      stderr: (text: string) => events.push(`console err ${text}`),
    },
    stdout: async (text: string) => {
      await Promise.resolve();
      events.push(`async out ${text}`);
    },
    stderr: async (text: string) => {
      await Promise.resolve();
      events.push(`async err ${text}`);
    },
  };
  expect(await cli.runParsed(cli.parse(['work']), options)).toBe(0);
  expect(events).toEqual([
    'console out one  \n',
    'console out files: 2\n',
    'console out debug { ready: true }\n',
    'console out \n',
    'console err warning false\n',
    'console err failure\n\n',
    'async out six',
    'console out seven 7\n',
    'async err eight',
  ]);
  events.length = 0;
  expect(await cli.run({ ...options, argv: ['--help'] })).toBe(0);
  expect(events).toEqual([`async out ${cli.renderHelp()}`]);
});

test('console failures throw at the call site and escape the runner when uncaught', async () => {
  const failure = new Error('sink failure');
  const write = () => {
    throw failure;
  };
  const cli = command('tool', {
    handler: (_args, { output }) => {
      expect(() => output.debug('handled')).toThrow(failure);
      output.error('unhandled');
    },
  });
  // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
  await expect(cli.run({ argv: [], color: false, output: { stdout: write, stderr: write } })).rejects.toBe(failure);
});

test('default console sinks finish partial byte writes on both descriptors', async () => {
  const chunks: { descriptor: number; bytes: Buffer; }[] = [];
  const write = spyOn(fs, 'writeSync').mockImplementation((...args: unknown[]) => {
    const [descriptor, bytes, offset, length,] = args as [number, Buffer, number, number];
    const count = Math.min(3, length);
    chunks.push({ descriptor, bytes: Buffer.from(bytes.subarray(offset, offset + count)) });
    return count;
  });
  try {
    const cli = command('tool', {
      handler: (_args, { output }) => {
        output.log('ação 🙂  ');
        expect(Buffer.concat(chunks.map(({ bytes }) => bytes)).toString()).toBe('ação 🙂  \n');
        output.warn('warning');
      },
    });
    expect(await cli.run({ argv: [], color: false })).toBe(0);
    expect(Buffer.concat(chunks.filter(({ descriptor }) => descriptor === 1).map(({ bytes }) => bytes)).toString()).toBe('ação 🙂  \n');
    expect(Buffer.concat(chunks.filter(({ descriptor }) => descriptor === 2).map(({ bytes }) => bytes)).toString()).toBe('warning\n');
    write.mockImplementation(() => 0);
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(cli.run({ argv: [], color: false })).rejects.toThrow('made no progress');
    const failure = Object.assign(new Error('closed pipe'), { code: 'EPIPE' });
    write.mockImplementation(() => {
      throw failure;
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(cli.run({ argv: [], color: false })).rejects.toBe(failure);
  } finally {
    write.mockRestore();
  }
});

function _checkConsoleWriterTypes() {
  const chunks: string[] = [];
  const writer: SyncOutputWriter = (text) => chunks.push(text);
  const writers: ConsoleWriters = { stdout: writer, stderr: () => {} };
  // @ts-expect-error synchronous sinks reject promises
  const _asyncWriter: SyncOutputWriter = async (_text: string) => {};
  void command('tool', {
    handler: async (_args, context) => {
      const output: HandlerConsole = context.output;
      // biome-ignore lint/suspicious/noConfusingVoidType: Assert the public synchronous return type.
      const _logged: void = output.log('line');
      const written: Promise<void> = context.stdout('chunk');
      await written;
    },
  }).run({ output: writers });
}
