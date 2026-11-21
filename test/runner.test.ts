import {
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import {
  CliError,
  colorFlag,
  command,
  ErrorKind,
  flag,
  option,
  parsers,
  type RunOptions,
  type RunParsedOptions,
} from '../src';

describe('runner exit codes', () => {
  test('uses one scoped command tree and preserves handler status 2', async () => {
    const build = mock((_args: object) => 2);
    const clean = mock((_args: object) => 2);
    const cli = command('kmake', {
      argsConflictWithSubcommands: true,
      args: [flag('dryRun', { long: 'dry-run', short: 'n' })],
      handler: build,
      subcommands: [command('clean', {
        args: [flag('dryRun', { long: 'dry-run', short: 'n' })],
        handler: clean,
      })],
    });
    const stderr = mock((_output: string) => {});
    const stdout = mock(() => {});
    const options: RunOptions = { parseErrorExitCode: 1, stderr, stdout };

    expect(await cli.run({ ...options, argv: ['-n', 'clean'] })).toBe(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(build).not.toHaveBeenCalled();
    expect(clean).not.toHaveBeenCalled();
    expect(await cli.run({ ...options, argv: ['-n'] })).toBe(2);
    expect(await cli.run({ ...options, argv: ['clean', '-n'] })).toBe(2);
    expect(build).toHaveBeenCalledTimes(1);
    expect(clean).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0]?.[0]).toEqual({ dryRun: true, subcommand: undefined });
    expect(clean.mock.calls[0]?.[0]).toEqual({ dryRun: true });
    expect(stdout).not.toHaveBeenCalled();
  });

  test.each([1, 255])('uses parse error status %s without changing CliError', async (parseErrorExitCode) => {
    const handler = mock(() => {});
    const cli = command('tool', { handler });
    const result = cli.tryParse(['--unknown']);
    const stderr = mock((_output: string) => {});
    const options: RunParsedOptions = { parseErrorExitCode, stderr, color: false };

    expect(await cli.runParsed(result, options)).toBe(parseErrorExitCode);
    expect(await cli.run({ ...options, argv: ['--unknown'] })).toBe(parseErrorExitCode);
    expect(await cli.runParsed(result, { stderr, color: false })).toBe(2);
    expect(result).toMatchObject({ type: 'error', error: { exitCode: 2 } });
    if (result.type === 'error') {
      expect(stderr.mock.calls).toEqual([[result.error.output], [result.error.output], [result.error.output]]);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  test('applies explicit color settings to parse failures without a color flag', async () => {
    const cli = command('tool', { handler: () => {} });
    const result = cli.tryParse(['--unknown']);
    const stderr = mock((_output: string) => {});

    expect(await cli.runParsed(result, { stderr, color: true })).toBe(2);
    expect(stderr.mock.calls[0]?.[0].includes('\x1b[')).toBe(Bun.env.NO_COLOR === undefined);
  });

  test.each([-1, 0, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid parse error status %s before dispatch',
    async (code) => {
      const handler = mock(() => {});
      const stdout = mock(() => {});
      const stderr = mock(() => {});
      const cli = command('tool', { handler });
      const options = { parseErrorExitCode: code, stdout, stderr };
      for (const argv of [[], ['--help'], ['--unknown']]) {
        // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
        await expect(cli.run({ ...options, argv })).rejects.toThrow('parseErrorExitCode must be an integer from 1 to 255');
        // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
        await expect(cli.runParsed(cli.tryParse(argv), options)).rejects.toThrow(RangeError);
      }
      expect(handler).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).not.toHaveBeenCalled();
    },
  );

  test('does not remap exceptions thrown by handlers, including CliError', async () => {
    const failure = new CliError(ErrorKind.InvalidValue, 'handler failure', 'handler failure\n');
    const stderr = mock(() => {});
    const cli = command('tool', {
      handler: () => {
        throw failure;
      },
    });
    const options = { parseErrorExitCode: 1, stderr };
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(cli.run({ ...options, argv: [] })).rejects.toBe(failure);
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(cli.runParsed(cli.parse([]), options)).rejects.toBe(failure);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('runner writers', () => {
  test('lets the handler handle a failed stream write and choose its exit code', async () => {
    const brokenPipe = Object.assign(new Error('closed pipe'), { code: 'EPIPE' });
    const cli = command('stream', {
      handler: async (_args, { stdout }) => {
        try {
          await stdout('row\n');
        } catch (error) {
          if (error === brokenPipe) {
            return 0;
          }
          throw error;
        }
        return 1;
      },
    });
    expect(await cli.run({ argv: [], stdout: () => Promise.reject(brokenPipe) })).toBe(0);
  });

  test.each(['run', 'runParsed'] as const)('%s awaits writes in order for nested handlers and parse failures', async (method) => {
    const events: string[] = [];
    const cli = command('tool', {
      subcommands: [command('read', {
        deprecated: 'Use show.',
        args: [flag('old', { deprecated: 'Use --new.' })],
        handler: async (_args, { stdout, stderr }) => {
          events.push('handler');
          await stdout('first ');
          await stdout('\n\n');
          await stderr('last');
          return 7;
        },
      })],
    });
    const write = async (channel: string, chunk: string) => {
      await Bun.sleep(1);
      events.push(`${channel} ${chunk}`);
      return chunk.length;
    };
    const options = {
      color: false,
      stdout: (chunk: string) => write('out', chunk),
      stderr: (chunk: string) => write('err', chunk),
    };
    const run = (argv: readonly string[]) => method === 'run' ? cli.run({ ...options, argv }) : cli.runParsed(cli.tryParse(argv), options);
    const warnings = [
      'err warning: command \'read\' is deprecated: Use show.\n',
      'err warning: argument \'old\' is deprecated: Use --new.\n',
    ];
    expect(await run(['read', '--old'])).toBe(7);
    expect(events).toEqual([...warnings, 'handler', 'out first ', 'out \n\n', 'err last']);
    events.length = 0;
    expect(await run(['read', '--old', '--unknown'])).toBe(2);
    expect(events).toEqual([...warnings, expect.stringContaining('err error: unexpected argument \'--unknown\'')]);
    events.length = 0;
    expect(await run(['--help'])).toBe(0);
    expect(events).toEqual([`out ${cli.renderHelp()}`]);
  });

  test.each(['run', 'runParsed'] as const)('%s propagates writer failures before returning or dispatching', async (method) => {
    const failure = new Error('write failed');
    const handler = mock(() => 0);
    const cli = command('tool', { version: '1', args: [flag('old', { deprecated: 'Use --new.' })], handler });
    const write = () => Promise.reject(failure);
    const options = { stdout: write, stderr: write };
    for (const argv of [['--version'], ['--unknown'], ['--old']]) {
      const result = method === 'run' ? cli.run({ ...options, argv }) : cli.runParsed(cli.tryParse(argv), options);
      // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
      await expect(result).rejects.toBe(failure);
    }
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('reusable parse results', () => {
  test.each(['run', 'parse', 'tryParse'] as const)('%s parses each supplied value once for root and nested handlers', async (method) => {
    const parseValue = mock((input: string) => input);
    const parser = parsers.custom('VALUE', parseValue);
    const profile = option('profile', parser, { global: true });
    const region = option('region', parser, { global: true });
    const build = mock(() => 2);
    const received: unknown[] = [];
    const cli = command('tool', {
      argsConflictWithSubcommands: true,
      args: [profile, option('target', parser)],
      handler: build,
      subcommands: [command('cache', {
        args: [region],
        subcommands: [command('clean', {
          aliases: ['prune'],
          args: [option('target', parser)],
          handler: async (args, context) => {
            await Promise.resolve();
            received.push({ args, path: context.commandPath, profile: context.global(profile), region: context.global(region) });
            return 2;
          },
        })],
      })],
    });
    const options = { parseErrorExitCode: 1 };
    const rootArgv = ['--target', 'all'];
    const childArgv = ['--profile', 'dev', 'cache', 'prune', '--region', 'us', '--target', 'old'];
    for (const argv of [rootArgv, childArgv]) {
      const result = method === 'run'
        ? await cli.run({ ...options, argv })
        : await cli.runParsed(cli[method](argv), options);
      expect(result).toBe(2);
    }
    expect(parseValue.mock.calls).toEqual([['all'], ['dev'], ['us'], ['old']]);
    expect(build).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{
      args: { target: 'old' },
      path: ['tool', 'cache', 'clean'],
      profile: 'dev',
      region: 'us',
    }]);
  });

  test('passes the original parsed object and keeps its resolved color value', async () => {
    const handler = mock((_args: object) => {});
    const cli = command('tool', { args: [colorFlag('color')], handler });
    const parsed = cli.parse(['--color']);
    expect(parsed.type).toBe('value');
    expect(await cli.runParsed(parsed, { color: false })).toBe(0);
    if (parsed.type === 'value') {
      expect(handler.mock.calls[0]?.[0]).toBe(parsed.value);
      expect(parsed.value.color).toBe(Bun.env.NO_COLOR === undefined);
    }
  });

  test.each(['--help', '--version'])('writes a stored %s request without a handler', async (argument) => {
    const cli = command('tool', { version: '1.0.0' });
    const result = cli.parse([argument]);
    const stdout = mock((_output: string) => {});
    const stderr = mock(() => {});
    expect(await cli.runParsed(result, { stdout, stderr, color: false, parseErrorExitCode: 1 })).toBe(0);
    expect(result.type).toBe('display');
    if (result.type === 'display') {
      expect(stdout.mock.calls).toEqual([[result.output]]);
    }
    expect(stderr).not.toHaveBeenCalled();
  });

  test.each(['--color', '--no-color'])('retains %s metadata for stored help and failures', async (switchName) => {
    const cli = command('tool', { args: [colorFlag('color')] });
    const stdout = mock((_output: string) => {});
    const stderr = mock((_output: string) => {});
    const options = { stdout, stderr, color: switchName !== '--color' };
    expect(await cli.runParsed(cli.tryParse([switchName, '--help']), options)).toBe(0);
    expect(await cli.runParsed(cli.tryParse([switchName, '--unknown']), options)).toBe(2);
    for (const output of [stdout, stderr]) {
      expect(output.mock.calls[0]?.[0].includes('\x1b[')).toBe(switchName === '--color' && Bun.env.NO_COLOR === undefined);
    }
  });

  test('keeps missing-handler and invalid-handler-status errors', async () => {
    const missing = command('tool');
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(missing.runParsed(missing.parse([]))).rejects.toThrow('No handler is configured');
    const invalid = command('tool', { handler: () => 256 });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(invalid.runParsed(invalid.parse([]), { parseErrorExitCode: 1 })).rejects.toThrow('A command handler exit code');
  });
});

test('completion stays ahead of normal validation and handler dispatch', async () => {
  const source = new URL('../src/index.ts', import.meta.url).href;
  const script = `
    import { command, flag, option, parsers } from ${JSON.stringify(source)};
    const handler = () => { throw new Error('Completion invoked a handler'); };
    const cli = command('kmake', {
      argsConflictWithSubcommands: true,
      args: [flag('dryRun', { short: 'n' }), option('required', parsers.string, { required: true })],
      handler,
      subcommands: [command('clean', { args: [flag('force')], handler })],
    });
    process.exitCode = await cli.run({ argv: ['-n', 'clean', '--f'], parseErrorExitCode: 1 });
  `;
  const child = Bun.spawn([process.execPath, '-e', script], {
    env: { ...process.env, KONSTIT_CLI_COMPLETE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, status,] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(status).toBe(0);
  expect(stderr).toBe('');
  expect(stdout).toBe(`${Buffer.from('--force').toString('hex')}\t\n`);
});

void (() => {
  const cli = command('tool', { args: [option('value', parsers.integer, { required: true })] });
  const other = command('other', { args: [option('value', parsers.string, { required: true })] });
  const result: Promise<number> = cli.runParsed(cli.tryParse(['--value', '1']));
  void result;
  // @ts-expect-error incompatible parsed value types cannot be executed
  void cli.runParsed(other.parse(['--value', 'text']));
  // @ts-expect-error runParsed accepts an outcome, not bare argument values
  void cli.runParsed({ value: 1 });
  // @ts-expect-error runParsed never accepts argv to reparse
  void cli.runParsed(cli.parse(['--value', '1']), { argv: [] });
  // @ts-expect-error parse error exit codes must be numeric
  void cli.run({ parseErrorExitCode: '1' });
});
