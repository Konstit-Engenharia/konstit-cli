import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  count,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import {
  resolveDynamicCompletion,
  type DynamicCompletionContext,
  type DynamicCompletionProvider,
} from '../src/dynamic-completion';

describe('dynamic completion coverage', () => {
  test('returns a positional file hint alongside command candidates', async () => {
    const cli = command('tool', {
      args: [positional('input', parsers.string, { valueHint: 'file' })],
      subcommands: [command('run')],
    });
    const result = await resolveDynamicCompletion(cli, ['']);
    expect(result.valueHint).toBe('file');
    expect(result.argument?.name).toBe('input');
    expect(result.candidates).toContainEqual({ value: 'run' });
  });

  test('validates cursor bounds', async () => {
    const cli = command('tool');
    for (const cursor of [-1, 0.5, 2]) {
      // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
      await expect(
        resolveDynamicCompletion(cli, [''], { cursor }),
      ).rejects.toThrow('completion cursor');
    }
  });

  test('loads environment presence and supported values', async () => {
    const names = {
      enabled: 'KONSTIT_CLI_DYNAMIC_ENABLED',
      disabled: 'KONSTIT_CLI_DYNAMIC_DISABLED',
      invalidFlag: 'KONSTIT_CLI_DYNAMIC_INVALID_FLAG',
      count: 'KONSTIT_CLI_DYNAMIC_COUNT',
      invalidCount: 'KONSTIT_CLI_DYNAMIC_INVALID_COUNT',
      port: 'KONSTIT_CLI_DYNAMIC_PORT',
      broken: 'KONSTIT_CLI_DYNAMIC_BROKEN',
      tags: 'KONSTIT_CLI_DYNAMIC_TAGS',
    } as const;
    let context: DynamicCompletionContext | undefined;

    await withEnvironment({
      [names.enabled]: '',
      [names.disabled]: 'off',
      [names.invalidFlag]: 'not-a-boolean',
      [names.count]: '3',
      [names.invalidCount]: '3.5',
      [names.port]: '8080',
      [names.broken]: 'bad',
      [names.tags]: 'one,two',
    }, async () => {
      const cli = command('env', {
        args: [
          flag('enabled', { env: names.enabled }),
          flag('disabled', { env: names.disabled, negated: true }),
          flag('invalidFlag', { env: names.invalidFlag }),
          count('verbose', { env: names.count }),
          count('invalidCount', { env: names.invalidCount }),
          option('port', parsers.integer, { env: names.port }),
          option(
            'broken',
            parsers.custom('BROKEN', () => {
              throw new Error('invalid');
            }),
            { env: names.broken },
          ),
          option('tags', parsers.string, {
            repeatable: true,
            valueDelimiter: ',',
            env: names.tags,
          }),
          option('query', parsers.string, {
            complete: (received) => {
              context = received;
              return ['result'];
            },
          }),
        ],
      });

      await resolveDynamicCompletion(cli, ['--query', '']);
    });

    expect(context?.values).toMatchObject({
      enabled: true,
      disabled: false,
      invalidFlag: true,
      verbose: 3,
      invalidCount: 0,
      port: 8080,
      broken: undefined,
      tags: ['one', 'two'],
    });
    expect(context?.rawValues).toMatchObject({
      port: ['8080'],
      broken: ['bad'],
      tags: ['one', 'two'],
    });
    expect(Object.isFrozen(context?.rawValues.tags)).toBe(true);
  });

  test('scans long and short switches, values, terminators, and stops', async () => {
    let context: DynamicCompletionContext | undefined;
    const cli = command('scan', {
      args: [
        flag('quiet', { short: 'q' }),
        flag('color', { negated: true }),
        count('verbose', { short: 'v' }),
        option('output', parsers.string, {
          short: 'o',
          complete: () => ['alpha', 'amber'],
        }),
        option('equal', parsers.string, { short: 'e', requireEquals: true }),
        option('pair', parsers.string, { numArgs: 2, valueTerminator: ';' }),
        option('query', parsers.string, {
          complete: (received) => {
            context = received;
            return ['done'];
          },
        }),
      ],
    });

    await resolveDynamicCompletion(cli, [
      '--pair',
      'one',
      ';',
      '--quiet',
      '--color',
      '-vv',
      '-o=alpha',
      '--equal',
      '-e',
      '--unknown',
      '-z',
      '--query',
      '',
    ]);

    expect(context?.values).toMatchObject({
      quiet: true,
      color: false,
      verbose: 2,
      output: 'alpha',
    });

    const stopped = await resolveDynamicCompletion(cli, [
      '--pair',
      'one',
      '--quiet',
      '--q',
    ]);
    expect(stopped.candidates.map(({ value }) => value)).toContain('--query');
  });

  test('scans positional terminators, delimiters, and trailing values', async () => {
    let context: DynamicCompletionContext | undefined;
    const cli = command('positionals', {
      args: [
        positional('pair', parsers.string, {
          numArgs: 2,
          valueDelimiter: ',',
        }),
        positional('skip', parsers.string, { valueTerminator: ';' }),
        positional('rest', parsers.string, {
          trailingVarArg: true,
          complete: (received) => {
            context = received;
            return ['next'];
          },
        }),
      ],
    });

    const result = await resolveDynamicCompletion(
      cli,
      ['left,right', ';', 'tail', '--literal', 'n'],
    );
    expect(result.argument?.name).toBe('rest');
    expect(result.candidates.map(({ value }) => value)).toEqual(['next']);
    expect(context?.values).toMatchObject({
      pair: ['left', 'right'],
      rest: ['tail', '--literal'],
    });

    const noPositional = await resolveDynamicCompletion(
      command('empty'),
      ['unused', ''],
    );
    expect(noPositional.commandPath).toEqual(['empty']);
  });

  test('handles the option terminator with and without a positional', async () => {
    const positionalCli = command('literal', {
      args: [positional('value', parsers.string, { valueHint: 'directory' })],
    });
    const positionalResult = await resolveDynamicCompletion(
      positionalCli,
      ['--', 'pa'],
    );
    expect(positionalResult.argument?.name).toBe('value');
    expect(positionalResult.valueHint).toBe('directory');

    const emptyResult = await resolveDynamicCompletion(
      command('literal'),
      ['--', 'pa'],
    );
    expect(emptyResult.argument).toBeUndefined();
  });

  test('resolves inferred subcommands and rejects ambiguous prefixes', async () => {
    const cli = command('tool', {
      version: '1.0.0',
      inferSubcommands: true,
      args: [option('config', parsers.string, { aliases: ['settings'] })],
      subcommands: [
        command('deploy', {
          about: 'Deploy code',
          visibleAliases: ['ship'],
          aliases: ['d'],
          args: [flag('force')],
        }),
        command('destroy'),
      ],
    });

    for (const token of ['deploy', 'ship', 'd', 'depl', 'shi']) {
      const result = await resolveDynamicCompletion(cli, [token, '']);
      expect(result.commandPath).toEqual(['tool', 'deploy']);
      expect(result.candidates.map(({ value }) => value)).toContain('--force');
    }

    const root = await resolveDynamicCompletion(cli, ['']);
    expect(root.candidates).toContainEqual({
      value: 'deploy',
      description: 'Deploy code',
    });
    expect(root.candidates.map(({ value }) => value)).toContain('ship');
    expect(root.candidates.map(({ value }) => value)).not.toContain('d');
    expect(root.candidates.map(({ value }) => value)).toContain('--settings');
    expect(root.candidates.map(({ value }) => value)).toContain('--version');

    const ambiguous = await resolveDynamicCompletion(cli, ['de', '']);
    expect(ambiguous.commandPath).toEqual(['tool']);
  });

  test('completes attached short values and handles non-value clusters', async () => {
    const cli = command('short', {
      args: [
        flag('verbose', { short: 'v' }),
        option('output', parsers.string, {
          short: 'o',
          complete: () => ['alpha', 'amber'],
        }),
        flag('hidden', { short: 'x', hide: true }),
      ],
    });

    expect(
      (await resolveDynamicCompletion(cli, ['-oal']))
        .candidates.map(({ value }) => value),
    ).toEqual(['-oalpha']);
    expect(
      (await resolveDynamicCompletion(cli, ['-o=am']))
        .candidates.map(({ value }) => value),
    ).toEqual(['-o=amber']);
    expect(
      (await resolveDynamicCompletion(cli, ['-voal']))
        .candidates.map(({ value }) => value),
    ).toEqual(['-voalpha']);
    expect((await resolveDynamicCompletion(cli, ['-v'])).argument).toBeUndefined();
    expect((await resolveDynamicCompletion(cli, ['-z'])).argument).toBeUndefined();
    expect((await resolveDynamicCompletion(cli, ['--verbose=yes'])).argument)
      .toBeUndefined();
  });

  test('allows negative and hyphen values while stopping ordinary values', async () => {
    let negative: DynamicCompletionContext | undefined;
    let hyphen: DynamicCompletionContext | undefined;
    const cli = command('values', {
      args: [
        option('number', parsers.integer, { allowNegativeNumbers: true }),
        option('pattern', parsers.string, { allowHyphenValues: true }),
        flag('force'),
        option('query', parsers.string, { complete: () => ['query'] }),
        option('negative', parsers.string, {
          allowNegativeNumbers: true,
          complete: (context) => {
            negative = context;
            return ['-20'];
          },
        }),
        option('hyphen', parsers.string, {
          allowHyphenValues: true,
          complete: (context) => {
            hyphen = context;
            return ['--literal'];
          },
        }),
      ],
    });

    await resolveDynamicCompletion(cli, ['--number', '-10', '--query', '']);
    await resolveDynamicCompletion(cli, ['--pattern', '--literal', '--query', '']);
    await resolveDynamicCompletion(cli, ['--negative', '-2']);
    await resolveDynamicCompletion(cli, ['--hyphen', '--l']);

    expect(negative?.current).toBe('-2');
    expect(hyphen?.current).toBe('--l');
  });

  test('can disable filtering and deduplicates by candidate value', async () => {
    const cli = command('filter', {
      args: [option('value', parsers.string, {
        valueHint: 'file',
        complete: () => [
          { value: 'alpha', description: 'first' },
          { value: 'alpha', description: 'duplicate' },
          'beta',
        ],
      })],
    });
    const result = await resolveDynamicCompletion(
      cli,
      ['--value', 'z'],
      { filter: false },
    );
    expect(result.candidates).toEqual([
      { value: 'alpha', description: 'first' },
      { value: 'beta' },
    ]);
    expect(result.valueHint).toBe('file');
  });

  test('rejects invalid provider results and candidates', async () => {
    const invalidResults: readonly unknown[] = ['single', null, {}, 42];
    for (const invalidResult of invalidResults) {
      const cli = command('invalid', {
        args: [option('value', parsers.string, {
          complete: (() => invalidResult) as unknown as DynamicCompletionProvider,
        })],
      });
      // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
      await expect(
        resolveDynamicCompletion(cli, ['--value', '']),
      ).rejects.toThrow('iterable of candidates');
    }

    for (const invalidValue of ['', 'nul\0value', 'line\nvalue', 'line\rvalue']) {
      const cli = command('invalid', {
        args: [option('value', parsers.string, {
          complete: () => [invalidValue],
        })],
      });
      // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
      await expect(
        resolveDynamicCompletion(cli, ['--value', '']),
      ).rejects.toThrow('single-line value');
    }
  });

  test('uses parser hints and preserves cursor-selected argv', async () => {
    let context: DynamicCompletionContext | undefined;
    const parser = parsers.custom('PATH', (value) => value, {
      completionHint: 'directory',
    });
    const cli = command('cursor', {
      args: [option('path', parser, {
        complete: (received) => {
          context = received;
          return ['project'];
        },
      })],
    });

    const result = await resolveDynamicCompletion(
      cli,
      ['--path', 'pr', 'ignored'],
      { cursor: 1 },
    );
    expect(result.candidates.map(({ value }) => value)).toEqual(['project']);
    expect(result.valueHint).toBe('directory');
    expect(context?.argv).toEqual(['--path', 'pr', 'ignored']);
    expect(context?.cursor).toBe(1);
  });
});

async function withEnvironment(
  values: Readonly<Record<string, string>>,
  callback: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value,] of Object.entries(values)) {
    previous.set(name, Bun.env[name]);
    Bun.env[name] = value;
  }
  try {
    await callback();
  } finally {
    for (const [name, value,] of previous) {
      if (value === undefined) {
        delete Bun.env[name];
      } else {
        Bun.env[name] = value;
      }
    }
  }
}
