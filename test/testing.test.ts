import {
  expect,
  test,
} from 'bun:test';
import { command } from '../src';
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
