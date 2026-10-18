import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  count,
  flag,
  getValueSource,
  option,
  parsers,
  positional,
} from '../src';
import type { ParseOutcome } from '../src/error';
import { updateValueSource } from '../src/value-source';

(() => {
  const parsed = { value: 'text' };
  getValueSource(parsed, 'value');
  // @ts-expect-error source lookup names are checked against parsed fields
  getValueSource(parsed, 'missing');
  getValueSource({} as Record<string, unknown>, 'dynamic');
})();

function unwrapValue<T>(result: ParseOutcome<T>): T {
  if (result.type !== 'value') {
    throw new Error(`Expected parsed value, got ${result.type}`);
  }
  return result.value as T;
}

describe('caller supplied config and value sources', () => {
  test('applies CLI, environment, config, and default precedence', () => {
    const previous = Bun.env.KONSTIT_CONFIG_SOURCE;
    Bun.env.KONSTIT_CONFIG_SOURCE = 'environment';
    try {
      const cli = command('tool', {
        args: [
          option('value', parsers.string, {
            env: 'KONSTIT_CONFIG_SOURCE',
            default: 'default',
          }),
        ],
      });
      const config = { config: { values: { value: 'config' } } } as const;
      const fromEnvironment = unwrapValue(cli.parse([], config));
      expect(fromEnvironment).toEqual({ value: 'environment' });
      expect(getValueSource(fromEnvironment, 'value')).toBe('env');
      const fromCli = unwrapValue(cli.parse(['--value', 'cli'], config));
      expect(fromCli).toEqual({ value: 'cli' });
      expect(getValueSource(fromCli, 'value')).toBe('cli');
    } finally {
      if (previous === undefined) {
        delete Bun.env.KONSTIT_CONFIG_SOURCE;
      } else {
        Bun.env.KONSTIT_CONFIG_SOURCE = previous;
      }
    }

    const defaults = command('tool', {
      args: [option('value', parsers.string, { default: 'default' })],
    });
    const fromConfig = unwrapValue(defaults.parse([], {
      config: { values: { value: 'config' } },
    }));
    expect(fromConfig.value).toBe('config');
    expect(getValueSource(fromConfig, 'value')).toBe('config');
    const fromDefault = unwrapValue(defaults.parse([]));
    expect(getValueSource(fromDefault, 'value')).toBe('default');
  });

  test('keeps source metadata on the parsed identity and updates it safely', () => {
    const parsed: Record<string, unknown> = {};
    updateValueSource(parsed, 'value', 'env');
    expect(getValueSource(parsed, 'value')).toBe('env');
    updateValueSource(parsed, 'value', undefined);
    expect(getValueSource(parsed, 'value')).toBeUndefined();
    expect(getValueSource({ ...parsed }, 'value')).toBeUndefined();
  });

  test('defers invalid config values when CLI or environment wins', () => {
    const cli = command('tool', {
      args: [option('value', parsers.integer)],
    });
    const fromCli = unwrapValue(cli.parse(['--value', '42'], {
      config: { values: { value: 'not-an-integer' } },
    }));
    expect(fromCli.value).toBe(42);
    expect(getValueSource(fromCli, 'value')).toBe('cli');

    const environmentName = 'KONSTIT_CONFIG_FALLBACK_INTEGER';
    const previous = Bun.env[environmentName];
    Bun.env[environmentName] = '43';
    try {
      const withEnvironment = command('tool', {
        args: [option('value', parsers.integer, { env: environmentName })],
      });
      const fromEnvironment = unwrapValue(withEnvironment.parse([], {
        config: { values: { value: 'not-an-integer' } },
      }));
      expect(fromEnvironment.value).toBe(43);
      expect(getValueSource(fromEnvironment, 'value')).toBe('env');
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('config supports flags, counts, arrays, positionals, and selected children', () => {
    const cli = command('tool', {
      args: [
        flag('enabled'),
        count('verbose'),
        option('tag', parsers.string, { repeatable: true }),
        positional('input', parsers.string),
      ],
      subcommands: [command('child', {
        args: [option('name', parsers.string, { global: true })],
      })],
    });
    const result = unwrapValue(cli.parse([], {
      config: {
        values: { enabled: true, verbose: 2, tag: ['one', 'two'], input: 'file' },
        subcommands: { child: { values: { name: 'nested' } } },
      },
    }));
    expect(result).toMatchObject({ enabled: true, verbose: 2, tag: ['one', 'two'], input: 'file' });
    expect(getValueSource(result, 'enabled')).toBe('config');
    expect(getValueSource(result, 'tag')).toBe('config');

    const nested = unwrapValue(cli.parse(['child'], {
      config: { subcommands: { child: { values: { name: 'nested' } } } },
    }));
    if (nested.subcommand !== undefined) {
      expect(nested.subcommand.args.name).toBe('nested');
      expect(getValueSource(nested.subcommand.args, 'name')).toBe('config');
    }
  });

  test('refreshes inherited global source metadata after environment fallback', () => {
    const previous = Bun.env.KONSTIT_CONFIG_GLOBAL;
    Bun.env.KONSTIT_CONFIG_GLOBAL = 'environment';
    try {
      const globalValue = option('profile', parsers.string, {
        global: true,
        env: 'KONSTIT_CONFIG_GLOBAL',
      });
      const cli = command('tool', {
        args: [globalValue],
        subcommands: [command('child', {
          args: [option('local', parsers.string)],
        })],
      });
      const nested = unwrapValue(cli.parse(['child']));
      if (nested.subcommand !== undefined) {
        expect(getValueSource(nested.subcommand.args, globalValue)).toBe('env');
      }
    } finally {
      if (previous === undefined) {
        delete Bun.env.KONSTIT_CONFIG_GLOBAL;
      } else {
        Bun.env.KONSTIT_CONFIG_GLOBAL = previous;
      }
    }
  });

  test('rejects local arguments that reuse an inherited global name', () => {
    const profile = option('profile', parsers.string, {
      global: true,
      long: 'global-profile',
    });
    const cli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('profile', parsers.string, { long: 'local-profile' })],
      })],
    });
    expect(() => cli.parse(['child'])).toThrow(
      'Argument \'profile\' conflicts with inherited global \'profile\'',
    );
  });

  test('requires complete occurrences for repeatable positional arity', () => {
    const cli = command('tool', {
      args: [positional('pair', parsers.string, { repeatable: true, numArgs: 2 })],
    });
    expect(cli.tryParse(['one', 'two', 'three'])).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: 'too-few-values', argumentName: 'pair' },
    });
    expect(cli.tryParse(['one', 'two', 'three', 'four'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { pair: ['one', 'two', 'three', 'four'] },
    });
  });

  test('keeps inherited globals in nested value error usage', () => {
    const profile = option('profile', parsers.string, { global: true, required: true });
    const cli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('port', parsers.integer)],
      })],
    });
    const result = cli.tryParse(['child', '--port', 'invalid']);
    expect(result).toMatchObject({ ok: false, error: { kind: 'invalid-value' } });
    if (result.type === 'error') {
      expect(result.error.output).toContain('--profile');
    }
  });

  test('keeps inherited globals in nested duplicate and arity diagnostics', () => {
    const profile = option('profile', parsers.string, { global: true, required: true });
    const duplicate = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('port', parsers.integer)],
      })],
    });
    const duplicateResult = duplicate.tryParse([
      'child',
      '--port',
      '1',
      '--port',
      '2',
    ]);
    expect(duplicateResult).toMatchObject({
      ok: false,
      error: { kind: 'argument-conflict' },
    });
    if (duplicateResult.type === 'error') {
      expect(duplicateResult.error.output).toContain('--profile');
    }

    const environmentName = 'KONSTIT_CONFIG_NESTED_ARITY';
    const previous = Bun.env[environmentName];
    Bun.env[environmentName] = 'one,two,three';
    try {
      const fromEnvironment = command('tool', {
        args: [profile],
        subcommands: [command('child', {
          args: [option('pair', parsers.string, {
            numArgs: 2,
            valueDelimiter: ',',
            env: environmentName,
          })],
        })],
      }).tryParse(['child']);
      expect(fromEnvironment).toMatchObject({
        ok: false,
        error: { kind: 'too-many-values' },
      });
      if (fromEnvironment.type === 'error') {
        expect(fromEnvironment.error.output).toContain('--profile');
      }
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('keeps inherited globals in nested positional and short-option diagnostics', () => {
    const profile = option('profile', parsers.string, { global: true, required: true });
    const cli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [
          positional('input', parsers.string, { valueDelimiter: ',' }),
          option('port', parsers.integer, { short: 'p' }),
        ],
      })],
    });
    const tooMany = cli.tryParse(['child', 'one,two']);
    expect(tooMany).toMatchObject({
      ok: false,
      error: { kind: 'too-many-values' },
    });
    if (tooMany.type === 'error') {
      expect(tooMany.error.output).toContain('--profile');
    }

    const unknownShort = cli.tryParse(['child', '-x']);
    expect(unknownShort).toMatchObject({
      ok: false,
      error: { kind: 'unknown-argument' },
    });
    if (unknownShort.type === 'error') {
      expect(unknownShort.error.output).toContain('--profile');
    }

    const inlineFlagCli = command('tool', {
      args: [profile],
      subcommands: [command('child', { args: [flag('verbose')] })],
    });
    const inlineFlag = inlineFlagCli.tryParse(['child', '--verbose=true']);
    expect(inlineFlag).toMatchObject({
      ok: false,
      error: { kind: 'too-many-values' },
    });
    if (inlineFlag.type === 'error') {
      expect(inlineFlag.error.output).toContain('--profile');
    }
  });

  test('parses nested default-missing long and short options with inherited globals', () => {
    const profile = option('profile', parsers.string, { global: true, required: true });
    const longCli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('mode', parsers.string, {
          defaultMissing: 'auto',
          requireEquals: false,
        })],
      })],
    });
    expect(unwrapValue(longCli.parse(['child', '--mode', '--profile', 'root']))).toMatchObject({
      profile: 'root',
      subcommand: { args: { mode: 'auto' } },
    });

    const longStrictCli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('mode', parsers.string, {
          defaultMissing: 'auto',
        })],
      })],
    });
    expect(unwrapValue(longStrictCli.parse(['child', '--mode', '--profile', 'root']))).toMatchObject({
      profile: 'root',
      subcommand: { args: { mode: 'auto' } },
    });

    const shortCli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('mode', parsers.string, {
          short: 'm',
          defaultMissing: 'auto',
          requireEquals: false,
        })],
      })],
    });
    expect(unwrapValue(shortCli.parse(['child', '-m', '--profile', 'root']))).toMatchObject({
      profile: 'root',
      subcommand: { args: { mode: 'auto' } },
    });

    const shortStrictCli = command('tool', {
      args: [profile],
      subcommands: [command('child', {
        args: [option('mode', parsers.string, {
          short: 'm',
          defaultMissing: 'auto',
        })],
      })],
    });
    expect(unwrapValue(shortStrictCli.parse(['child', '-m', '--profile', 'root']))).toMatchObject({
      profile: 'root',
      subcommand: { args: { mode: 'auto' } },
    });
  });

  test('validates repeatable ranged arity for CLI and environment values', () => {
    const cli = command('tool', {
      args: [option('chunk', parsers.string, {
        repeatable: true,
        numArgs: { min: 2, max: 3 },
      })],
    });
    expect(cli.tryParse([
      '--chunk',
      'one',
      'two',
      'three',
      '--chunk',
      'four',
      'five',
    ])).toMatchObject({
      ok: true,
      type: 'value',
      value: { chunk: ['one', 'two', 'three', 'four', 'five'] },
    });
    expect(cli.tryParse(['--chunk', 'one'])).toMatchObject({
      ok: false,
      error: { kind: 'too-few-values' },
    });

    const environmentName = 'KONSTIT_CONFIG_REPEATABLE_ENV';
    const previous = Bun.env[environmentName];
    Bun.env[environmentName] = 'one,two';
    try {
      const fromEnvironment = command('tool', {
        args: [option('chunk', parsers.string, {
          repeatable: true,
          numArgs: { min: 2, max: 3 },
          valueDelimiter: ',',
          env: environmentName,
        })],
      });
      expect(fromEnvironment.parse([])).toMatchObject({
        type: 'value',
        value: { chunk: ['one', 'two'] },
      });
      Bun.env[environmentName] = 'one';
      expect(fromEnvironment.tryParse([])).toMatchObject({
        ok: false,
        error: { kind: 'too-few-values' },
      });
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('CLI wins over config on inherited globals', () => {
    const profile = option('profile', parsers.string, { global: true });
    const cli = command('tool', {
      args: [profile],
      subcommands: [command('child')],
    });
    const result = unwrapValue(cli.parse(['--profile', 'cli', 'child'], {
      config: { subcommands: { child: { values: { profile: 'config' } } } },
    }));
    expect(result.profile).toBe('cli');
    expect(getValueSource(result, 'profile')).toBe('cli');
  });

  test('the deepest selected config wins for inherited globals', () => {
    const profile = option('profile', parsers.string, { global: true });
    const cli = command('tool', {
      args: [profile],
      subcommands: [command('child')],
    });
    const result = unwrapValue(cli.parse(['child'], {
      config: {
        values: { profile: 'root' },
        subcommands: { child: { values: { profile: 'child' } } },
      },
    }));
    expect(result.profile).toBe('child');
    expect(getValueSource(result, 'profile')).toBe('config');
  });

  test('an inherited environment value wins over invalid child config', () => {
    const environmentName = 'KONSTIT_CONFIG_INHERITED_ENV';
    const previous = Bun.env[environmentName];
    Bun.env[environmentName] = 'environment';
    try {
      const profile = option('profile', parsers.string, {
        global: true,
        env: environmentName,
      });
      const cli = command('tool', {
        args: [profile],
        subcommands: [command('child')],
      });
      const result = unwrapValue(cli.parse(['child'], {
        config: {
          subcommands: { child: { values: { profile: 1 } } },
        },
      }));
      expect(result.profile).toBe('environment');
      expect(getValueSource(result, 'profile')).toBe('env');
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('CLI repeated values replace lower precedence arrays', () => {
    const cli = command('tool', {
      args: [option('tag', parsers.string, { repeatable: true })],
    });
    const result = unwrapValue(cli.parse(['--tag', 'cli'], {
      config: { values: { tag: ['config'] } },
    }));
    expect(result.tag).toEqual(['cli']);
  });

  test('CLI overrides keep config from restoring the overridden target', () => {
    const cli = command('tool', {
      args: [
        flag('offline'),
        option('port', parsers.integer),
      ],
      overrides: [['offline', 'port']],
    });
    const result = unwrapValue(cli.parse(['--offline'], {
      config: { values: { port: 'not-an-integer' } },
    }));
    expect(result).toEqual({ offline: true, port: undefined });
    expect(getValueSource(result, 'port')).toBeUndefined();
  });

  test('a root override suppresses invalid nested config for an inherited global', () => {
    const profile = option('profile', parsers.integer, { global: true });
    const cli = command('tool', {
      args: [flag('offline'), profile],
      overrides: [['offline', 'profile']],
      subcommands: [command('child')],
    });
    const result = unwrapValue(cli.parse(['--offline', 'child'], {
      config: {
        subcommands: { child: { values: { profile: 'not-an-integer' } } },
      },
    }));
    expect(result).toEqual({
      offline: true,
      profile: undefined,
      subcommand: {
        name: 'child',
        args: {},
      },
    });
    expect(getValueSource(result, 'profile')).toBeUndefined();
  });

  test.each([
    { overrides: [['a', 'b'], ['b', 'c']] as const },
    { overrides: [['b', 'c'], ['a', 'b']] as const },
  ])('override chains clear original CLI targets in either declaration order: %j', ({ overrides }) => {
    const cli = command('tool', {
      args: [
        flag('a'),
        flag('b'),
        option('c', parsers.string, { default: 'default' }),
      ],
      overrides,
    });
    const result = unwrapValue(cli.parse(['--a', '--b', '--c', 'cli']));
    expect(result).toEqual({ a: true, b: false, c: 'default' });
    expect(getValueSource(result, 'a')).toBe('cli');
    expect(getValueSource(result, 'b')).toBe('default');
    expect(getValueSource(result, 'c')).toBe('default');
  });

  test('NO_COLOR suppresses --color without changing paired-switch conflicts', () => {
    const previous = Bun.env.NO_COLOR;
    Bun.env.NO_COLOR = '';
    try {
      const color = colorFlag('color');
      const cli = command('tool', { args: [color] });
      const fromColor = unwrapValue(cli.parse(['--color']));
      expect(fromColor.color).toBe(false);
      expect(getValueSource(fromColor, color)).toBe('env');
      expect(cli.tryParse(['--color', '--no-color'])).toMatchObject({
        ok: false,
        error: { kind: 'argument-conflict' },
      });

      const overridden = command('tool', {
        args: [flag('offline'), color],
        overrides: [['offline', 'color']],
      });
      const fromOverride = unwrapValue(overridden.parse(['--offline', '--color']));
      expect(fromOverride.color).toBe(false);
      expect(getValueSource(fromOverride, color)).toBe('env');
    } finally {
      if (previous === undefined) {
        delete Bun.env.NO_COLOR;
      } else {
        Bun.env.NO_COLOR = previous;
      }
    }
  });

  test('config repeatable fixed arity partitions flat values into occurrences', () => {
    const cli = command('tool', {
      args: [option('pair', parsers.string, { repeatable: true, numArgs: 2 })],
    });
    const accepted = unwrapValue(cli.parse([], {
      config: { values: { pair: ['a', 'b', 'c', 'd'] } },
    }));
    expect(accepted.pair).toEqual(['a', 'b', 'c', 'd']);
    expect(getValueSource(accepted, 'pair')).toBe('config');
    expect(cli.tryParse([], {
      config: { values: { pair: ['a', 'b', 'c'] } },
    })).toMatchObject({ ok: false });
  });

  test('config repeatable ranged arity requires a valid partition', () => {
    const cli = command('tool', {
      args: [option('chunk', parsers.string, {
        repeatable: true,
        numArgs: { min: 4, max: 5 },
      })],
    });
    const accepted = unwrapValue(cli.parse([], {
      config: { values: { chunk: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] } },
    }));
    expect(accepted.chunk).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(getValueSource(accepted, 'chunk')).toBe('config');
    expect(cli.tryParse([], {
      config: { values: { chunk: ['a', 'b', 'c', 'd', 'e', 'f'] } },
    })).toMatchObject({ ok: false });
  });

  test('rejects unknown and invalid config values', () => {
    const cli = command('tool', {
      args: [option('value', parsers.integer), flag('enabled'), count('verbose')],
      subcommands: [command('child')],
    });
    expect(() => cli.parse([], { config: null as never })).toThrow('must be an object');
    expect(() => cli.parse([], { config: { extra: true } as never })).toThrow('Unknown config field');
    expect(() => cli.parse([], { config: { subcommands: { missing: {} } } })).toThrow(
      'unknown config subcommand \'missing\'',
    );
    expect(() => cli.parse([], { config: { values: { unknown: 'x' } } })).toThrow(
      'unknown config argument \'unknown\'',
    );
    expect(() => cli.parse([], { config: { values: { value: 1 } } })).toThrow(
      'must be a string or string array',
    );
    expect(() => cli.parse([], { config: { values: { enabled: 'true' } } })).toThrow(
      'must be a boolean',
    );
    expect(() => cli.parse([], { config: { values: { verbose: -1 } } })).toThrow(
      'numbers must be nonnegative safe integers',
    );
    expect(() =>
      cli.parse([], {
        config: { values: [] as never },
      })
    ).toThrow('Config values at');
    expect(() =>
      cli.parse([], {
        config: { subcommands: [] as never },
      })
    ).toThrow('Config subcommands at');
    expect(() =>
      cli.parse([], {
        config: { values: { value: {} as never } },
      })
    ).toThrow('expected a string, string array, boolean, or nonnegative integer');
    const invalid = cli.tryParse([], { config: { values: { value: 'not-an-integer' } } });
    expect(invalid).toMatchObject({ ok: false, error: { kind: 'invalid-value' } });
    if (invalid.type === 'error') {
      expect(invalid.error.message).not.toContain('not-an-integer');
    }
  });

  test('config values participate in normal relation validation', () => {
    const cli = command('tool', {
      args: [option('token', parsers.string), option('endpoint', parsers.string)],
      requires: [['token', 'endpoint']],
    });
    expect(cli.tryParse([], { config: { values: { token: 'secret' } } })).toMatchObject({
      ok: false,
      error: { kind: 'missing-dependency' },
    });
    expect(cli.parse([], { config: { values: { token: 'secret', endpoint: 'api' } } })).toMatchObject({
      type: 'value',
    });
  });

  test('run applies config and runParsed preserves the parsed provenance', async () => {
    let received: unknown;
    const cli = command('tool', {
      args: [option('port', parsers.integer)],
      handler: (args) => {
        received = args.port;
      },
    });
    expect(
      await cli.run({
        argv: [],
        config: { values: { port: '8080' } },
        stdout: () => {},
        stderr: () => {},
      }),
    ).toBe(0);
    expect(received).toBe(8080);

    const parsed = cli.parse([], { config: { values: { port: '9000' } } });
    expect(parsed.type).toBe('value');
    if (parsed.type === 'value') {
      expect(getValueSource(parsed.value, 'port')).toBe('config');
      expect(await cli.runParsed(parsed, { stdout: () => {}, stderr: () => {} })).toBe(0);
    }
    expect(received).toBe(9000);
  });
});
