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
  test('validates cursor bounds', async () => {
    const cli = command('tool');
    for (const cursor of [-1, 0.5, 2]) {
      await expect(
        resolveDynamicCompletion(cli, [''], { cursor }),
      ).rejects.toThrow('completion cursor');
    }
  });

  test('loads supported environment values and ignores invalid ones', async () => {
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
      [names.enabled]: 'yes',
      [names.disabled]: 'off',
      [names.invalidFlag]: 'maybe',
      [names.count]: '3',
      [names.invalidCount]: '3.5',
      [names.port]: '8080',
      [names.broken]: 'bad',
      [names.tags]: 'one,two',
    }, async () => {
      const cli = command('env')
        .arg(flag('enabled').env(names.enabled))
        .arg(flag('disabled').env(names.disabled))
        .arg(flag('invalidFlag').env(names.invalidFlag))
        .arg(count('verbose').env(names.count))
        .arg(count('invalidCount').env(names.invalidCount))
        .arg(option('port', parsers.integer).env(names.port))
        .arg(
          option(
            'broken',
            parsers.custom('BROKEN', () => {
              throw new Error('invalid');
            }),
          ).env(names.broken),
        )
        .arg(option('tags').repeatable().valueDelimiter(',').env(names.tags))
        .arg(
          option('query').complete((received) => {
            context = received;
            return ['result'];
          }),
        );

      await resolveDynamicCompletion(cli, ['--query', '']);
    });

    expect(context?.values).toMatchObject({
      enabled: true,
      disabled: false,
      invalidFlag: false,
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
    const cli = command('scan')
      .arg(flag('quiet').short('q'))
      .arg(flag('color').negated())
      .arg(count('verbose').short('v'))
      .arg(option('output').short('o').complete(() => ['alpha', 'amber']))
      .arg(option('equal').short('e').requireEquals())
      .arg(option('pair').numArgs(2).valueTerminator(';'))
      .arg(
        option('query').complete((received) => {
          context = received;
          return ['done'];
        }),
      );

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
    const cli = command('positionals')
      .arg(positional('pair').numArgs(2).valueDelimiter(','))
      .arg(positional('skip').valueTerminator(';'))
      .arg(
        positional('rest').trailingVarArg().complete((received) => {
          context = received;
          return ['next'];
        }),
      );

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
    const positionalCli = command('literal').arg(
      positional('value').valueHint('directory'),
    );
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
    const cli = command('tool')
      .version('1.0.0')
      .inferSubcommands()
      .arg(option('config').alias('settings'))
      .subcommand(
        command('deploy')
          .about('Deploy code')
          .visibleAlias('ship')
          .alias('d')
          .arg(flag('force')),
      )
      .subcommand(command('destroy'));

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
    const cli = command('short')
      .arg(flag('verbose').short('v'))
      .arg(option('output').short('o').complete(() => ['alpha', 'amber']))
      .arg(flag('hidden').short('x').hide());

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
    const cli = command('values')
      .arg(option('number', parsers.integer).allowNegativeNumbers())
      .arg(option('pattern').allowHyphenValues())
      .arg(flag('force'))
      .arg(option('query').complete(() => ['query']))
      .arg(
        option('negative').complete((context) => {
          negative = context;
          return ['-20'];
        }).allowNegativeNumbers(),
      )
      .arg(
        option('hyphen').complete((context) => {
          hyphen = context;
          return ['--literal'];
        }).allowHyphenValues(),
      );

    await resolveDynamicCompletion(cli, ['--number', '-10', '--query', '']);
    await resolveDynamicCompletion(cli, ['--pattern', '--literal', '--query', '']);
    await resolveDynamicCompletion(cli, ['--negative', '-2']);
    await resolveDynamicCompletion(cli, ['--hyphen', '--l']);

    expect(negative?.current).toBe('-2');
    expect(hyphen?.current).toBe('--l');
  });

  test('can disable filtering and deduplicates by candidate value', async () => {
    const cli = command('filter').arg(
      option('value')
        .valueHint('file')
        .complete(() => [
          { value: 'alpha', description: 'first' },
          { value: 'alpha', description: 'duplicate' },
          'beta',
        ]),
    );
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
      const cli = command('invalid').arg(
        option('value').complete(
          (() => invalidResult) as unknown as DynamicCompletionProvider,
        ),
      );
      await expect(
        resolveDynamicCompletion(cli, ['--value', '']),
      ).rejects.toThrow('iterable of candidates');
    }

    for (const invalidValue of ['', 'nul\0value', 'line\nvalue', 'line\rvalue']) {
      const cli = command('invalid').arg(
        option('value').complete(() => [invalidValue]),
      );
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
    const cli = command('cursor').arg(
      option('path', parser).complete((received) => {
        context = received;
        return ['project'];
      }),
    );

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
