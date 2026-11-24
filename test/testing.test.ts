import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  CommandFailure,
  option,
  parsers,
} from '../src';
import { invoke } from '../src/testing';

test('invoke captures synchronous and awaited writes in order and returns the handler exit code', async () => {
  const cli = command('tool', {
    subcommands: [command('work', {
      handler: async (_args, { output, stdout, stderr }) => {
        await stdout('starting ');
        output.warn('warning');
        output.info('processed %d', 3);
        await stderr('details');
        return 7;
      },
    })],
    subcommandRequired: true,
  });

  expect(await invoke(cli, ['work'])).toEqual({
    exitCode: 7,
    stdout: 'starting processed 3\n',
    stderr: 'warning\ndetails',
    writes: [
      { stream: 'stdout', chunk: 'starting ' },
      { stream: 'stderr', chunk: 'warning\n' },
      { stream: 'stdout', chunk: 'processed 3\n' },
      { stream: 'stderr', chunk: 'details' },
    ],
  });
});

test('invoke captures help and parse failures in separate invocations', async () => {
  const cli = command('tool', { handler: () => 7 });
  const [help, failure,] = await Promise.all([invoke(cli, ['--help']), invoke(cli, ['--unknown'])]);

  expect(help).toEqual({
    exitCode: 0,
    stdout: cli.renderHelp(),
    stderr: '',
    writes: [{ stream: 'stdout', chunk: cli.renderHelp() }],
  });
  expect(failure.exitCode).toBe(2);
  expect(failure.stdout).toBe('');
  expect(failure.stderr).toContain('--unknown');
  expect(failure.writes).toEqual([{ stream: 'stderr', chunk: failure.stderr }]);
});

test('invoke supplies stdin while capturing the handler output', async () => {
  const stdin = new Blob(['first\nsecond\n']).stream();
  const cli = command('echo', {
    handler: async (_args, context) => {
      expect(context.stdin).toBe(stdin);
      await context.stdout(await new Response(context.stdin).text());
    },
  });
  expect(await invoke(cli, [], { stdin })).toEqual({
    exitCode: 0,
    stdout: 'first\nsecond\n',
    stderr: '',
    writes: [{ stream: 'stdout', chunk: 'first\nsecond\n' }],
  });
});

test('invoke supplies configuration only to the current invocation', async () => {
  const cli = command('serve', {
    args: [option('port', parsers.integer, { default: 3000 })],
    handler: ({ port }, { output }) => output.log(port),
  });
  const config = { values: { port: '8080' } };

  expect(await invoke(cli, [], { config })).toEqual({
    exitCode: 0,
    stdout: '8080\n',
    stderr: '',
    writes: [{ stream: 'stdout', chunk: '8080\n' }],
  });
  expect((await invoke(cli, ['--port', '9000'], { config })).stdout).toBe('9000\n');
  expect((await invoke(cli, [])).stdout).toBe('3000\n');
});

test('invoke isolates environment variables across concurrent invocations', async () => {
  const envName = 'KONSTIT_INVOKE_PORT';
  const original = Bun.env[envName];
  const cli = command('serve', {
    args: [option('port', parsers.integer, { env: envName, default: 3000 })],
    handler: async ({ port }, { stdout }) => {
      await stdout(String(port));
      expect(Bun.env[envName]).toBe(original);
    },
  });
  const results = await Promise.all([
    invoke(cli, [], { env: { [envName]: '8080' } }),
    invoke(cli, [], { env: { [envName]: '9000' } }),
    invoke(cli, [], { env: {}, config: { values: { port: '4000' } } }),
  ]);
  expect(results.map(({ exitCode, stdout }) => [exitCode, stdout])).toEqual([[0, '8080'], [0, '9000'], [0, '4000']]);
  expect(Bun.env[envName]).toBe(original);
});

test('invoke captures a handler failure alongside earlier output', async () => {
  const cli = command('tool', {
    handler: (_args, { output }) => {
      output.log('Starting');
      throw new CommandFailure('Could not finish.', 9);
    },
  });
  expect(await invoke(cli, [])).toEqual({
    exitCode: 9,
    stdout: 'Starting\n',
    stderr: 'Could not finish.\n',
    writes: [
      { stream: 'stdout', chunk: 'Starting\n' },
      { stream: 'stderr', chunk: 'Could not finish.\n' },
    ],
  });
});
