import {
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import assert from 'node:assert/strict';
import {
  PassThrough,
  Writable,
} from 'node:stream';
import {
  CliError,
  command,
  ErrorKind,
  getValueSource,
  option,
  parsers,
  positional,
  type PromptRequest,
} from '../src';
import { promptConfiguredResult } from '../src/command/prompt';
import { getCommandDefinition } from '../src/command/store';

describe('interactive prompts', () => {
  test('prompts for a required option and reparses the response', async () => {
    const requests: PromptRequest[] = [];
    const handler = mock((args: { readonly name: string; }) => {
      expect(args.name).toBe('Ada');
    });
    const cli = command('tool', {
      args: [option('name', parsers.string, { required: true, prompt: 'Name' })],
      handler,
    });

    expect(
      await cli.run({
        argv: [],
        prompt: (request) => {
          requests.push(request);
          return 'Ada';
        },
      }),
    ).toBe(0);
    expect(requests).toEqual([{
      argumentName: 'name',
      commandPath: ['tool'],
      message: 'Name',
      sensitive: false,
    }]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('fills a missing option value in place and preserves parser validation', async () => {
    const responses = ['8080'];
    const received: number[] = [];
    const cli = command('tool', {
      args: [option('port', parsers.integer, { short: 'p', prompt: true })],
      handler: ({ port }) => {
        received.push(port as number);
      },
    });

    expect(
      await cli.run({
        argv: ['-p'],
        prompt: () => responses.shift(),
      }),
    ).toBe(0);
    expect(received).toEqual([8080]);

    const invalid = await cli.run({
      argv: [],
      prompt: () => 'not-a-port',
      stderr: () => {},
      color: false,
    });
    expect(invalid).toBe(2);
    expect(
      await cli.run({
        argv: ['--port', 'not-a-port'],
        prompt: () => 'unexpected',
        stderr: () => {},
        color: false,
      }),
    ).toBe(2);
  });

  test('handles missing values for equals-only long and short spellings', async () => {
    const received: string[] = [];
    const long = command('long', {
      args: [option('name', parsers.string, { requireEquals: true, prompt: true })],
      handler: ({ name }) => {
        received.push(name as string);
      },
    });
    const short = command('short', {
      args: [option('name', parsers.string, { short: 'n', requireEquals: true, prompt: true })],
      handler: ({ name }) => {
        received.push(name as string);
      },
    });
    expect(await long.run({ argv: ['--name'], prompt: () => 'long' })).toBe(0);
    expect(await short.run({ argv: ['-n'], prompt: () => 'short' })).toBe(0);
    expect(received).toEqual(['long', 'short']);
  });

  test('records prompted provenance while filling a long option value', async () => {
    let source: unknown;
    const cli = command('tool', {
      args: [option('name', parsers.string, { prompt: true })],
      handler: (args) => {
        source = getValueSource(args, 'name');
      },
    });
    expect(await cli.run({ argv: ['--name'], prompt: () => 'Ada' })).toBe(0);
    expect(source).toBe('prompt');
  });

  test('prompts every missing scalar option in a nested command scope', async () => {
    const requests: string[] = [];
    const cli = command('tool', {
      subcommands: [command('deploy', {
        args: [
          option('region', parsers.string, { required: true, prompt: true }),
          option('account', parsers.string, { required: true, prompt: 'Account' }),
        ],
        handler: (args) => {
          expect(args).toEqual({ region: 'eu', account: 'ops' });
        },
      })],
    });
    expect(
      await cli.run({
        argv: ['deploy'],
        prompt: ({ argumentName, commandPath }) => {
          requests.push(`${commandPath.join(' ')}:${argumentName}`);
          return argumentName === 'region' ? 'eu' : 'ops';
        },
      }),
    ).toBe(0);
    expect(requests).toEqual(['tool deploy:region', 'tool deploy:account']);
  });

  test('prompts optional values and exposes sensitivity', async () => {
    const requests: PromptRequest[] = [];
    const cli = command('tool', {
      args: [
        option('token', parsers.string, { prompt: true, sensitive: true }),
        option('name', parsers.string, { prompt: 'Your name' }),
        option('unused', parsers.string),
      ],
      handler: (args) => {
        expect(args).toEqual({ token: 'secret', name: 'Ada', unused: undefined });
      },
    });

    expect(
      await cli.run({
        argv: [],
        prompt: (request) => {
          requests.push(request);
          return request.argumentName === 'token' ? 'secret' : 'Ada';
        },
      }),
    ).toBe(0);
    expect(requests.map(({ argumentName, message, sensitive }) => ({ argumentName, message, sensitive }))).toEqual([
      { argumentName: 'token', message: 'token', sensitive: true },
      { argumentName: 'name', message: 'Your name', sensitive: false },
    ]);
  });

  test('prompts an optional value in a selected child command', async () => {
    let received: string | undefined;
    const cli = command('tool', {
      subcommands: [command('deploy', {
        args: [option('region', parsers.string, { prompt: true })],
        handler: ({ region }) => {
          received = region;
        },
      })],
    });
    expect(await cli.run({ argv: ['deploy'], prompt: () => 'eu' })).toBe(0);
    expect(received).toBe('eu');
  });

  test('prompts a child option while carrying inherited globals', async () => {
    const cli = command('tool', {
      args: [option('profile', parsers.string, { global: true })],
      subcommands: [command('deploy', {
        args: [option('region', parsers.string, { prompt: true })],
        handler: ({ region }) => {
          expect(region).toBe('eu');
        },
      })],
    });
    expect(
      await cli.run({
        argv: ['--profile', 'ops', 'deploy', '--region'],
        prompt: ({ argumentName }) => {
          expect(argumentName).toBe('region');
          return 'eu';
        },
      }),
    ).toBe(0);
  });

  test('does not reprompt an explicitly supplied dependency source', async () => {
    const requested: string[] = [];
    const cli = command('tool', {
      args: [
        option('format', parsers.enum(['text', 'json']), { prompt: true }),
        option('schema', parsers.string, { prompt: true }),
      ],
      requiresIf: [['format', 'json', 'schema']],
      handler: ({ format, schema }) => {
        expect(format).toBe('json');
        expect(schema).toBe('schema.json');
      },
    });
    expect(
      await cli.run({
        argv: ['--format', 'json'],
        prompt: ({ argumentName }) => {
          requested.push(argumentName);
          return 'schema.json';
        },
      }),
    ).toBe(0);
    expect(requested).toEqual(['schema']);
  });

  test('does not prompt supplied values, displays, or noninteractive failures', async () => {
    const prompt = mock(() => 'unexpected');
    const cli = command('tool', {
      version: '1.0.0',
      args: [option('name', parsers.string, { prompt: true, required: true })],
      handler: () => {},
    });

    expect(await cli.run({ argv: ['--name', 'Ada'], prompt })).toBe(0);
    expect(await cli.run({ argv: ['--help'], prompt })).toBe(0);
    expect(await cli.run({ argv: [], interactive: true, stderr: () => {}, color: false })).toBe(2);
    expect(prompt).toHaveBeenCalledTimes(0);
  });

  test('returns the original failure when prompting is cancelled', async () => {
    const cli = command('tool', {
      args: [option('name', parsers.string, { required: true, prompt: true })],
      handler: () => {},
    });
    const stderr = mock((_text: string) => {});
    expect(await cli.run({ argv: [], prompt: () => undefined, stderr, color: false })).toBe(2);
    expect(stderr.mock.calls[0]?.[0]).toContain('required arguments');
  });

  test('accepts prompt metadata only for value arguments', () => {
    expect(() => option('name', parsers.string, { prompt: 1 } as never)).toThrow(
      'option argument option \'prompt\' must be a boolean or string',
    );
    expect(() => positional('name', parsers.string, { prompt: true } as never)).toThrow(
      'positional arguments cannot configure prompt',
    );
    expect(() => {
      // @ts-expect-error Prompted options must accept one scalar value.
      return option('tags', parsers.string, { prompt: true, repeatable: true });
    }).toThrow('Prompted options must accept one scalar value');
    expect(() => {
      // @ts-expect-error Prompted options must accept one scalar value.
      return option('values', parsers.string, { prompt: true, numArgs: { min: 0 } });
    }).toThrow('Prompted options must accept one scalar value');
    expect(() =>
      command('tool', {
        args: [option('name', parsers.string, { prompt: true })],
        handler: () => {},
      }).parse([])
    ).not.toThrow();
    expect(getValueSource({ name: 'Ada' }, 'name')).toBeUndefined();
    expect(ErrorKind.MissingRequiredArgument).toBe('missing-required-argument');
  });

  test('uses the built-in prompt on a TTY and closes the readline interface', async () => {
    const input = new PassThrough();
    const outputChunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, callback) {
        outputChunks.push(String(chunk));
        callback();
      },
    });
    Object.defineProperty(input, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(output, 'isTTY', { value: true, configurable: true });
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process, 'stderr');
    Object.defineProperty(process, 'stdin', { value: input, configurable: true, writable: true });
    Object.defineProperty(process, 'stderr', { value: output, configurable: true, writable: true });
    try {
      const cli = command('tool', {
        args: [option('name', parsers.string, { required: true, prompt: 'Name' })],
        handler: ({ name }) => {
          expect(name).toBe('Ada');
        },
      });
      const running = cli.run({ argv: [], interactive: true });
      input.end('Ada\n');
      expect(await running).toBe(0);
      expect(outputChunks.join('')).toContain('Name ');
    } finally {
      if (stdinDescriptor !== undefined) {
        Object.defineProperty(process, 'stdin', stdinDescriptor);
      }
      if (stderrDescriptor !== undefined) {
        Object.defineProperty(process, 'stderr', stderrDescriptor);
      }
    }
  });

  test('cancels a built-in prompt when the input reaches EOF', async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    Object.defineProperty(input, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(output, 'isTTY', { value: true, configurable: true });
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process, 'stderr');
    Object.defineProperty(process, 'stdin', { value: input, configurable: true, writable: true });
    Object.defineProperty(process, 'stderr', { value: output, configurable: true, writable: true });
    try {
      const cli = command('tool', {
        args: [option('name', parsers.string, { required: true, prompt: true })],
        handler: () => {},
      });
      const running = cli.run({ argv: [], interactive: true, color: false, stderr: () => {} });
      setTimeout(() => input.end(), 0);
      expect(await running).toBe(2);
    } finally {
      input.destroy();
      if (stdinDescriptor !== undefined) {
        Object.defineProperty(process, 'stdin', stdinDescriptor);
      }
      if (stderrDescriptor !== undefined) {
        Object.defineProperty(process, 'stderr', stderrDescriptor);
      }
    }
  });

  test('cancels a built-in prompt when its signal aborts', async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    Object.defineProperty(input, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(output, 'isTTY', { value: true, configurable: true });
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process, 'stderr');
    Object.defineProperty(process, 'stdin', { value: input, configurable: true, writable: true });
    Object.defineProperty(process, 'stderr', { value: output, configurable: true, writable: true });
    try {
      const controller = new AbortController();
      const cli = command('tool', {
        args: [option('name', parsers.string, { required: true, prompt: true })],
        handler: () => {},
      });
      const running = cli.run({
        argv: [],
        interactive: true,
        signal: controller.signal,
        color: false,
        stderr: () => {},
      });
      setTimeout(() => controller.abort(), 0);
      expect(await running).toBe(2);
      const alreadyAborted = new AbortController();
      alreadyAborted.abort();
      expect(
        await cli.run({
          argv: [],
          interactive: true,
          signal: alreadyAborted.signal,
          color: false,
          stderr: () => {},
        }),
      ).toBe(2);
    } finally {
      input.destroy();
      if (stdinDescriptor !== undefined) {
        Object.defineProperty(process, 'stdin', stdinDescriptor);
      }
      if (stderrDescriptor !== undefined) {
        Object.defineProperty(process, 'stderr', stderrDescriptor);
      }
    }
  });

  test('requires an injected callback for sensitive built-in prompts', async () => {
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    Object.defineProperty(input, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(output, 'isTTY', { value: true, configurable: true });
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
    const stderrDescriptor = Object.getOwnPropertyDescriptor(process, 'stderr');
    Object.defineProperty(process, 'stdin', { value: input, configurable: true, writable: true });
    Object.defineProperty(process, 'stderr', { value: output, configurable: true, writable: true });
    try {
      const cli = command('tool', {
        args: [option('token', parsers.string, { required: true, prompt: true, sensitive: true })],
        handler: () => {},
      });
      await assert.rejects(
        cli.run({ argv: [], interactive: true }),
        /Sensitive interactive prompts require the RunOptions\.prompt callback/,
      );
    } finally {
      if (stdinDescriptor !== undefined) {
        Object.defineProperty(process, 'stdin', stdinDescriptor);
      }
      if (stderrDescriptor !== undefined) {
        Object.defineProperty(process, 'stderr', stderrDescriptor);
      }
    }
  });

  test('keeps malformed command paths and subcommand selections as non-prompting failures', async () => {
    const definition = command('tool', {
      args: [option('name', parsers.string, { prompt: true })],
    });
    const internal = getCommandDefinition(definition);
    const error = new CliError(
      ErrorKind.MissingRequiredArgument,
      'missing',
      'missing\n',
      2,
      { commandPath: ['tool', 'unknown'], argumentName: 'name' },
    );
    const failed = await promptConfiguredResult(
      internal,
      [],
      { ok: false, type: 'error', error },
      true,
      { prompt: () => 'Ada' },
    );
    expect(failed).toMatchObject({ type: 'error', error });
    const noArgument = new CliError(
      ErrorKind.NoEquals,
      'missing equals',
      'missing equals\n',
      2,
      { commandPath: ['tool'] },
    );
    const unchanged = await promptConfiguredResult(
      internal,
      [],
      { ok: false, type: 'error', error: noArgument },
      true,
      { prompt: () => 'Ada' },
    );
    expect(unchanged).toMatchObject({ type: 'error', error: noArgument });
    const malformedValue = await promptConfiguredResult(
      internal,
      [],
      { ok: true, type: 'value', value: { subcommand: { name: 'unknown', args: {} } } },
      true,
      { prompt: () => 'Ada' },
    );
    expect(malformedValue.type).toBe('value');
  });
});
