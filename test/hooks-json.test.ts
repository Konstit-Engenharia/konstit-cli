import {
  expect,
  test,
} from 'bun:test';
import assert from 'node:assert/strict';
import {
  command,
  CommandFailure,
  hookToken,
  option,
  parsers,
} from '../src';
import {
  generateCompletion,
  resolveDynamicCompletion,
} from '../src/completion';
import { invoke } from '../src/testing';

test('serializes a structured handler result when the opt-in JSON flag is supplied', async () => {
  let calls = 0;
  const cli = command('tool', {
    enableJsonFlag: true,
    handler: (_args, { output, stdout }) => {
      calls += 1;
      output.info('progress');
      void stdout('raw progress');
      return { ok: true, values: [1, 2] };
    },
  });

  expect(await invoke(cli, ['--json'])).toMatchObject({
    exitCode: 0,
    stdout: '{"ok":true,"values":[1,2]}\n',
    stderr: '',
  });
  expect(calls).toBe(1);
  expect((await invoke(cli, [])).stdout).toBe('progress\nraw progress');
  expect(cli.renderHelp()).toContain('--json');
  expect(generateCompletion(cli, 'bash')).toContain('--json');
  expect(generateCompletion(cli, 'fish')).toContain('--json');
  expect((await resolveDynamicCompletion(cli, [''])).candidates).toContainEqual({
    value: '--json',
    description: 'Print handler result as JSON',
  });
});

test('reserves the JSON flag and keeps it unavailable unless enabled', () => {
  expect(() =>
    command('tool', {
      enableJsonFlag: true,
      args: [option('json', parsers.string)],
    })
  ).toThrow('Option \'--json\' is reserved');
  expect(() =>
    command('tool', {
      args: [option('json', parsers.string)],
    })
  ).not.toThrow();
  expect(() =>
    command('tool', {
      args: [option('json', parsers.string, { global: true })],
      subcommands: [command('child', {
        enableJsonFlag: true,
      })],
    })
  ).toThrow('JSON flag conflicts');
});

test('keeps the JSON flag scoped to its command and carries it to the selected handler', async () => {
  const cli = command('tool', {
    enableJsonFlag: true,
    subcommands: [command('work', { handler: () => ({ done: true }) })],
  });
  const parsed = cli.parse(['--json', 'work']);
  const output: string[] = [];
  expect(
    await cli.runParsed(parsed, {
      stdout: (chunk) => {
        output.push(chunk);
      },
    }),
  ).toBe(0);
  expect(output).toEqual(['{"done":true}\n']);
  expect(cli.tryParse(['work', '--json'])).toMatchObject({ type: 'error' });
  expect((await resolveDynamicCompletion(cli, ['work', '--j'])).candidates).toEqual([]);
});

test('rejects structured results on commands without JSON enabled and invalid JSON encodings', async () => {
  const disabled = command('tool', { handler: () => ({ done: true }) });
  await assert.rejects(invoke(disabled, []), /A command handler exit code/);
  const invalid = command('tool', {
    enableJsonFlag: true,
    handler: () => ({ toJSON: () => undefined }) as never,
  });
  await assert.rejects(invoke(invalid, ['--json']), /must serialize to a JSON value/);
});

test('runs nested setup hooks in order and cleanup hooks in reverse order', async () => {
  const events: string[] = [];
  const resource = hookToken<{ readonly name: string; }>('resource');
  const cli = command('tool', {
    setup: ({ provide }) => {
      events.push('root setup');
      provide(resource, { name: 'shared' });
    },
    cleanup: () => {
      events.push('root cleanup');
    },
    subcommands: [command('work', {
      setup: ({ get }) => {
        events.push(`child setup ${get(resource).name}`);
      },
      cleanup: () => {
        events.push('child cleanup');
      },
      handler: (_args, { get }) => {
        events.push(`handler ${get(resource).name}`);
        throw new CommandFailure('failed', 9);
      },
    })],
  });

  expect(await invoke(cli, ['work'])).toMatchObject({ exitCode: 9, stderr: 'failed\n' });
  expect(events).toEqual([
    'root setup',
    'child setup shared',
    'handler shared',
    'child cleanup',
    'root cleanup',
  ]);
});

test('runs cleanup-only hooks and reports missing hook values', async () => {
  const events: string[] = [];
  const token = hookToken<string>('missing');
  const cli = command('tool', {
    cleanup: () => {
      events.push('cleanup');
    },
    handler: (_args, { get }) => {
      get(token);
    },
  });

  await assert.rejects(invoke(cli, []), /No hook value 'missing' has been provided/);
  expect(events).toEqual(['cleanup']);
});

test('propagates cleanup failures after running the handler', async () => {
  const events: string[] = [];
  const cli = command('tool', {
    setup: () => {
      events.push('setup');
    },
    cleanup: () => {
      events.push('cleanup');
      throw new Error('cleanup failed');
    },
    handler: () => {
      events.push('handler');
    },
  });

  await assert.rejects(invoke(cli, []), /cleanup failed/);
  expect(events).toEqual(['setup', 'handler', 'cleanup']);
});

test('cleans up completed ancestor setup when a descendant setup fails', async () => {
  const events: string[] = [];
  const cli = command('tool', {
    setup: () => {
      events.push('root setup');
    },
    cleanup: () => {
      events.push('root cleanup');
    },
    subcommands: [command('work', {
      setup: () => {
        throw new CommandFailure('setup failed', 8);
      },
      cleanup: () => {
        events.push('child cleanup');
      },
      handler: () => {
        events.push('handler');
      },
    })],
  });
  expect(await invoke(cli, ['work'])).toMatchObject({ exitCode: 8, stderr: 'setup failed\n' });
  expect(events).toEqual(['root setup', 'root cleanup']);
});

test('allows setup hooks without cleanup hooks', async () => {
  const events: string[] = [];
  const cli = command('tool', {
    setup: () => {
      events.push('setup');
    },
    handler: () => {
      events.push('handler');
    },
  });
  expect(await invoke(cli, [])).toMatchObject({ exitCode: 0 });
  expect(events).toEqual(['setup', 'handler']);
});
