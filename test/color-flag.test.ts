import {
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import * as fs from 'node:fs';
import {
  colorFlag,
  command,
  ErrorKind,
  flag,
  getValueSource,
  option,
  parsers,
} from '../src';
import { getArgumentDefinition } from '../src/argument';
import { generateCompletion } from '../src/completion';
import {
  resolveDynamicCompletion,
  type DynamicCompletionContext,
} from '../src/dynamic-completion';

interface ColorEnvironment {
  readonly noColor: string | null;
  readonly term: string | null;
  readonly stdoutTTY?: boolean;
  readonly stderrTTY?: boolean;
  readonly stdoutDepth?: number;
  readonly stderrDepth?: number;
}

async function withColorEnvironment<Value>(
  environment: ColorEnvironment,
  callback: () => Value | PromiseLike<Value>,
): Promise<Value> {
  const previousNoColor = Bun.env.NO_COLOR;
  const previousTerm = Bun.env.TERM;
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  const stdoutDepth = Object.getOwnPropertyDescriptor(process.stdout, 'getColorDepth');
  const stderrDepth = Object.getOwnPropertyDescriptor(process.stderr, 'getColorDepth');
  setEnvironment('NO_COLOR', environment.noColor);
  setEnvironment('TERM', environment.term);
  if (environment.stdoutTTY !== undefined) {
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: environment.stdoutTTY,
    });
  }
  if (environment.stderrTTY !== undefined) {
    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: environment.stderrTTY,
    });
  }
  if (environment.stdoutDepth !== undefined) {
    Object.defineProperty(process.stdout, 'getColorDepth', { configurable: true, value: () => environment.stdoutDepth });
  }
  if (environment.stderrDepth !== undefined) {
    Object.defineProperty(process.stderr, 'getColorDepth', { configurable: true, value: () => environment.stderrDepth });
  }
  try {
    return await callback();
  } finally {
    restoreEnvironment('NO_COLOR', previousNoColor);
    restoreEnvironment('TERM', previousTerm);
    restoreProperty(process.stdout, 'isTTY', stdoutTTY);
    restoreProperty(process.stderr, 'isTTY', stderrTTY);
    restoreProperty(process.stdout, 'getColorDepth', stdoutDepth);
    restoreProperty(process.stderr, 'getColorDepth', stderrDepth);
  }
}

function setEnvironment(name: string, value: string | null): void {
  if (value === null) {
    delete Bun.env[name];
  } else {
    Bun.env[name] = value;
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env[name];
  } else {
    Bun.env[name] = value;
  }
}

function restoreProperty(
  target: object,
  name: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(target, name);
  } else {
    Object.defineProperty(target, name, descriptor);
  }
}

describe('color flag', () => {
  test('resolves handler styling and synchronous console colors against their own sinks', async () => {
    const native = spyOn(fs, 'writeSync').mockReturnValue(1000);
    const errors: string[] = [];
    try {
      for (const depth of [4, 8, 24]) {
        await withColorEnvironment({
          noColor: null,
          term: 'xterm',
          stdoutTTY: true,
          stderrTTY: true,
          stdoutDepth: depth,
          stderrDepth: depth,
        }, async () => {
          const cli = command('tool', {
            handler: (_args, { style, output }) => {
              expect(style('out', { color: 'red' })).toBe('out');
              const errorStyle = style('err', { color: 'red', stream: 'stderr' });
              expect(errorStyle).toBe(
                depth === 24 ? '\x1b[38;2;255;0;0merr\x1b[0m' : depth === 8 ? '\x1b[38;5;196merr\x1b[0m' : '\x1b[91merr\x1b[0m',
              );
              output.info('message');
              output.error('failure');
            },
          });
          expect(await cli.run({ argv: [], stdout: () => {}, output: { stderr: (text) => errors.push(text) } })).toBe(0);
        });
      }
      expect(errors).toEqual(['failure\n', 'failure\n', 'failure\n']);
      expect(native.mock.calls.map((call) => String(call[1]))).toEqual(['message\n', 'message\n', 'message\n']);
    } finally {
      native.mockRestore();
    }
  });

  test('retains explicit color modes on successful parse results and recomputes automatic destinations', async () => {
    await withColorEnvironment({ noColor: null, term: 'xterm', stdoutTTY: true }, async () => {
      const styled: string[] = [];
      const messages: string[] = [];
      const cli = command('tool', {
        args: [colorFlag('color')],
        handler: ({ color }, { style, output }) => {
          styled.push(style(String(color), { color: 'red' }));
          output.warn('warning');
          output.error('failure');
        },
      });
      const options = { stdout: () => {}, output: { stderr: (text: string) => messages.push(text) } };
      expect(await cli.runParsed(cli.parse(['--color']), { ...options, color: false })).toBe(0);
      expect(await cli.runParsed(cli.parse(['--no-color']), { ...options, color: true })).toBe(0);
      expect(await cli.runParsed(cli.tryParse([], { config: { values: { color: true } } }), { ...options, color: false })).toBe(0);
      expect(await cli.runParsed(cli.parse([]), options)).toBe(0);
      expect(styled).toEqual(['\x1b[38;2;255;0;0mtrue\x1b[0m', 'false', '\x1b[38;2;255;0;0mtrue\x1b[0m', 'true']);
      expect(messages).toEqual([
        'warning\n',
        '\x1b[38;2;220;38;38mfailure\x1b[0m\n',
        'warning\n',
        'failure\n',
        'warning\n',
        '\x1b[38;2;220;38;38mfailure\x1b[0m\n',
        'warning\n',
        'failure\n',
      ]);
    });
  });

  test('restores automatic color value and output when an override clears the color flag', async () => {
    for (const noColor of [null, '']) {
      for (const requestedColor of [false, true]) {
        await withColorEnvironment({ noColor, term: 'xterm', stdoutTTY: true }, async () => {
          const output: string[] = [];
          const expectedColor = noColor === null && requestedColor;
          const cli = command('tool', {
            args: [colorFlag('color'), flag('reset')],
            overrides: [['reset', 'color']],
            handler: (args, { style, stdout }) => {
              expect(args.color).toBe(expectedColor);
              expect(getValueSource(args, 'color')).toBe(noColor === null ? 'default' : 'env');
              return stdout(style('sample', { bold: true }));
            },
          });
          expect(
            await cli.run({
              argv: ['--color', '--reset'],
              color: requestedColor,
              stdout: (text) => output.push(text),
            }),
          ).toBe(0);
          expect(output).toEqual([expectedColor ? '\x1b[1msample\x1b[0m' : 'sample']);
        });
      }
    }
  });

  test('honors NO_COLOR for all output even without a color flag', async () => {
    await withColorEnvironment({ noColor: '', term: 'xterm', stdoutTTY: true, stderrTTY: true }, async () => {
      const messages: string[] = [];
      const cli = command('tool', {
        handler: (_args, { style, output }) => {
          expect(style('value', { color: 'red', bold: true })).toBe('value');
          expect(style.file('file.csv')).toBe('file.csv');
          output.error('message');
        },
      });
      const options = {
        color: true,
        lsColors: '*.csv=31',
        stdout: (text: string) => messages.push(text),
        stderr: (text: string) => messages.push(text),
        output: { stderr: (text: string) => messages.push(text) },
      };
      expect(await cli.run({ ...options, argv: [] })).toBe(0);
      expect(await cli.run({ ...options, argv: ['--help'] })).toBe(0);
      expect(await cli.run({ ...options, argv: ['--unknown'] })).toBe(2);
      expect(messages.some((text) => text.includes('\x1b['))).toBe(false);
    });
  });

  test('snapshots LS_COLORS before warnings and reads a fresh setting for each execution', async () => {
    await withColorEnvironment({ noColor: null, term: 'dumb' }, async () => {
      const previous = Bun.env.LS_COLORS;
      const output: string[] = [];
      try {
        Bun.env.LS_COLORS = '*.csv=31';
        const cli = command('tool', {
          deprecated: 'Use next.',
          handler: (_args, { style }) => {
            output.push(style.file('file.csv'));
          },
        });
        const options = {
          color: true,
          onWarning: () => {
            Bun.env.LS_COLORS = '*.csv=32';
          },
        };
        expect(await cli.run({ ...options, argv: [] })).toBe(0);
        expect(await cli.runParsed(cli.parse([]), options)).toBe(0);
        expect(await cli.run({ ...options, argv: [], lsColors: '*.csv=33' })).toBe(0);
        expect(await cli.run({ ...options, argv: [], lsColors: false })).toBe(0);
        expect(await cli.run({ ...options, argv: [], lsColors: '' })).toBe(0);
        expect(output).toEqual(['\x1b[31mfile.csv\x1b[0m', '\x1b[32mfile.csv\x1b[0m', '\x1b[33mfile.csv\x1b[0m', 'file.csv', 'file.csv']);
      } finally {
        restoreEnvironment('LS_COLORS', previous);
      }
    });
  });

  test('applies configured color values and honors NO_COLOR', async () => {
    const cli = command('tool', { args: [colorFlag('color')] });
    await withColorEnvironment({ noColor: null, term: 'dumb' }, () => {
      expect(cli.parse([], { config: { values: { color: true } } }))
        .toMatchObject({ value: { color: true } });
      expect(cli.parse([], { config: { values: { color: false } } }))
        .toMatchObject({ value: { color: false } });
    });
    await withColorEnvironment({ noColor: '', term: 'xterm' }, () => {
      expect(cli.parse([], { config: { values: { color: true } } }))
        .toMatchObject({ value: { color: false } });
    });
  });

  test('detects terminal color when help uses the default writer', async () => {
    const write = spyOn(Bun, 'write').mockResolvedValue(0);
    try {
      for (
        const environment of [
          { noColor: null, term: 'xterm', stdoutTTY: true },
          { noColor: '', term: 'xterm', stdoutTTY: true },
          { noColor: null, term: 'dumb', stdoutTTY: true },
        ]
      ) {
        await withColorEnvironment(environment, async () => {
          expect(await command('tool').run({ argv: ['--help'] })).toBe(0);
        });
      }
      expect(write).toHaveBeenCalledTimes(3);
      expect(write).toHaveBeenNthCalledWith(1, Bun.stdout, expect.stringContaining('\x1b['));
      expect(write).toHaveBeenNthCalledWith(2, Bun.stdout, expect.not.stringContaining('\x1b['));
      expect(write).toHaveBeenNthCalledWith(3, Bun.stdout, expect.not.stringContaining('\x1b['));
    } finally {
      write.mockRestore();
    }
  });

  test('initializes dynamic completion color from terminal capabilities', async () => {
    const cli = command('tool', {
      args: [colorFlag('color'), option('query', parsers.string, { complete: ({ values }) => [String(values.color)] })],
    });
    await withColorEnvironment({ noColor: null, term: 'xterm', stdoutTTY: true }, async () => {
      expect((await resolveDynamicCompletion(cli, ['--query', ''])).candidates).toEqual([{ value: 'true' }]);
    });
    await withColorEnvironment({ noColor: null, term: 'dumb', stdoutTTY: true }, async () => {
      expect((await resolveDynamicCompletion(cli, ['--query', ''])).candidates).toEqual([{ value: 'false' }]);
    });
  });

  test('resolves automatic, positive, negative, and environment values', async () => {
    const color = colorFlag('color');
    const cli = command('tool', { args: [color] });

    expect(getArgumentDefinition(color)).toMatchObject({
      color: true,
      long: 'color',
      negativeLong: 'no-color',
      global: true,
      env: 'NO_COLOR',
      defaultValue: false,
    });
    expect(cli.renderHelp()).toContain(
      '--color, --no-color  Enable or disable color output [env: NO_COLOR]',
    );

    await withColorEnvironment({
      noColor: null,
      term: 'xterm-256color',
      stdoutTTY: true,
    }, () => {
      expect(cli.parse([])).toMatchObject({ value: { color: true } });
      expect(cli.parse(['--color'])).toMatchObject({ value: { color: true } });
      expect(cli.parse(['--no-color'])).toMatchObject({ value: { color: false } });
      expect(cli.tryParse(['--color', '--no-color'])).toMatchObject({
        ok: false,
        error: { kind: ErrorKind.ArgumentConflict },
      });
    });

    await withColorEnvironment({
      noColor: null,
      term: 'dumb',
      stdoutTTY: true,
    }, () => {
      expect(cli.parse([])).toMatchObject({ value: { color: false } });
      expect(cli.parse(['--color'])).toMatchObject({ value: { color: true } });
    });

    await withColorEnvironment({
      noColor: null,
      term: 'xterm-256color',
      stdoutTTY: false,
    }, () => {
      expect(cli.parse([])).toMatchObject({ value: { color: false } });
    });

    await withColorEnvironment({
      noColor: '',
      term: 'xterm-256color',
      stdoutTTY: true,
    }, () => {
      expect(cli.parse([])).toMatchObject({ value: { color: false } });
      expect(cli.parse(['--color'])).toMatchObject({ value: { color: false } });
      expect(cli.parse(['--no-color'])).toMatchObject({ value: { color: false } });
    });
  });

  test('provides the handler boolean through root and nested commands', async () => {
    const values: boolean[] = [];
    const color = colorFlag('color');
    const child = command('child', {
      handler: (_args, context) => {
        values.push(context.global(color));
      },
    });
    const cli = command('tool', {
      args: [color],
      subcommands: [child],
      handler: ({ color: enabled }) => {
        values.push(enabled);
      },
    });

    await withColorEnvironment({ noColor: null, term: 'dumb' }, async () => {
      expect(await cli.run(['--color'])).toBe(0);
      expect(await cli.run(['--no-color'])).toBe(0);
      expect(await cli.run(['child', '--color'])).toBe(0);
    });
    await withColorEnvironment({ noColor: '', term: 'xterm-256color' }, async () => {
      expect(await cli.run(['--color'])).toBe(0);
    });

    await withColorEnvironment({
      noColor: null,
      term: 'xterm-256color',
      stdoutTTY: true,
    }, async () => {
      expect(await cli.run({ argv: [], stdout: () => {} })).toBe(0);
    });

    expect(values).toEqual([true, false, true, false, true]);
  });

  test('styles help and errors using their output streams', async () => {
    const cli = command('tool', {
      args: [colorFlag('color')],
      handler: () => {},
    });
    const write = spyOn(Bun, 'write').mockResolvedValue(0);
    try {
      await withColorEnvironment({
        noColor: null,
        term: 'xterm-256color',
        stdoutTTY: true,
        stderrTTY: false,
      }, async () => {
        expect(await cli.run(['--help'])).toBe(0);
        expect(await cli.run(['--unknown'])).toBe(2);
        expect(write).toHaveBeenCalledWith(Bun.stdout, expect.stringContaining('\x1b['));
        expect(write).toHaveBeenCalledWith(Bun.stderr, expect.not.stringContaining('\x1b['));
      });

      write.mockClear();
      await withColorEnvironment({
        noColor: null,
        term: 'xterm-256color',
        stdoutTTY: false,
        stderrTTY: true,
      }, async () => {
        expect(await cli.run(['--help'])).toBe(0);
        expect(await cli.run(['--unknown'])).toBe(2);
        expect(write).toHaveBeenCalledWith(Bun.stdout, expect.not.stringContaining('\x1b['));
        expect(write).toHaveBeenCalledWith(Bun.stderr, expect.stringContaining('\x1b['));
      });

      const help: string[] = [];
      const errors: string[] = [];
      await withColorEnvironment({ noColor: null, term: 'dumb' }, async () => {
        expect(
          await cli.run({
            argv: ['--color', '--help'],
            stdout: (output) => help.push(output),
          }),
        ).toBe(0);
        expect(
          await cli.run({
            argv: ['--color', '--unknown'],
            stderr: (output) => errors.push(output),
          }),
        ).toBe(2);
      });
      expect(help[0]).toContain('\x1b[');
      expect(errors[0]).toContain('\x1b[');

      help.length = 0;
      errors.length = 0;
      await withColorEnvironment({ noColor: '', term: 'xterm-256color' }, async () => {
        expect(
          await cli.run({
            argv: ['--color', '--help'],
            stdout: (output) => help.push(output),
          }),
        ).toBe(0);
        expect(
          await cli.run({
            argv: ['--color', '--unknown'],
            stderr: (output) => errors.push(output),
          }),
        ).toBe(2);
      });
      expect(help[0]).not.toContain('\x1b[');
      expect(errors[0]).not.toContain('\x1b[');
    } finally {
      write.mockRestore();
    }
  });

  test('rejects conflicting definitions and completes both switches', async () => {
    expect(() =>
      command('tool', {
        args: [colorFlag('color'), flag('no-color')],
      })
    ).toThrow('Duplicate long option: --no-color');
    expect(() =>
      command('tool', {
        args: [colorFlag('color'), colorFlag('ansi')],
      })
    ).toThrow('more than one color flag');
    expect(() =>
      command('tool', {
        args: [colorFlag('color')],
        subcommands: [command('child', { args: [colorFlag('ansi')] })],
      })
    ).toThrow('more than one color flag');

    let context: DynamicCompletionContext | undefined;
    const cli = command('tool', {
      args: [
        colorFlag('color'),
        option('query', parsers.string, {
          complete: (received) => {
            context = received;
            return ['done'];
          },
        }),
      ],
    });
    for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
      expect(generateCompletion(cli, shell)).toContain('no-color');
    }
    const candidates = await resolveDynamicCompletion(cli, ['--']);
    expect(candidates.candidates.map(({ value }) => value)).toEqual(
      expect.arrayContaining(['--color', '--no-color']),
    );

    await withColorEnvironment({ noColor: null, term: 'dumb' }, async () => {
      await resolveDynamicCompletion(cli, ['--color', '--query', '']);
      expect(context?.values.color).toBe(true);
      await resolveDynamicCompletion(cli, ['--no-color', '--query', '']);
      expect(context?.values.color).toBe(false);
    });
    await withColorEnvironment({ noColor: '', term: 'xterm-256color' }, async () => {
      await resolveDynamicCompletion(cli, ['--color', '--query', '']);
      expect(context?.values.color).toBe(false);
    });
  });
});
