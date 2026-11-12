import {
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  ErrorKind,
  flag,
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
}

async function withColorEnvironment<Value>(
  environment: ColorEnvironment,
  callback: () => Value | PromiseLike<Value>,
): Promise<Value> {
  const previousNoColor = Bun.env.NO_COLOR;
  const previousTerm = Bun.env.TERM;
  const stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
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
  try {
    return await callback();
  } finally {
    restoreEnvironment('NO_COLOR', previousNoColor);
    restoreEnvironment('TERM', previousTerm);
    restoreProperty(process.stdout, 'isTTY', stdoutTTY);
    restoreProperty(process.stderr, 'isTTY', stderrTTY);
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
    const log = spyOn(console, 'log').mockImplementation(() => {});
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
      expect(log).toHaveBeenCalledTimes(3);
      expect(log.mock.calls[0]?.[0]).toContain('\x1b[');
      expect(log.mock.calls[1]?.[0]).not.toContain('\x1b[');
      expect(log.mock.calls[2]?.[0]).not.toContain('\x1b[');
    } finally {
      log.mockRestore();
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
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withColorEnvironment({
        noColor: null,
        term: 'xterm-256color',
        stdoutTTY: true,
        stderrTTY: false,
      }, async () => {
        expect(await cli.run(['--help'])).toBe(0);
        expect(await cli.run(['--unknown'])).toBe(2);
        expect(log).toHaveBeenCalledWith(expect.stringContaining('\x1b['));
        expect(error).toHaveBeenCalledWith(expect.not.stringContaining('\x1b['));
      });

      log.mockClear();
      error.mockClear();
      await withColorEnvironment({
        noColor: null,
        term: 'xterm-256color',
        stdoutTTY: false,
        stderrTTY: true,
      }, async () => {
        expect(await cli.run(['--help'])).toBe(0);
        expect(await cli.run(['--unknown'])).toBe(2);
        expect(log).toHaveBeenCalledWith(expect.not.stringContaining('\x1b['));
        expect(error).toHaveBeenCalledWith(expect.stringContaining('\x1b['));
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
      log.mockRestore();
      error.mockRestore();
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
