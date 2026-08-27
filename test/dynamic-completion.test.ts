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
} from '../src/dynamic-completion';

describe('dynamic completion', () => {
  test('resolves static values, aliases, inline options, and global options', async () => {
    const cli = command('tool', {
      args: [flag('verbose', { global: true })],
      subcommands: [command('deploy', {
        visibleAliases: ['push'],
        args: [option('target', parsers.enum(['preview', 'production']))],
      })],
    });

    const value = await resolveDynamicCompletion(cli, ['push', '--target', 'pr']);
    expect(value.commandPath).toEqual(['tool', 'deploy']);
    expect(value.argument?.name).toBe('target');
    expect(value.candidates.map(({ value }) => value)).toEqual([
      'preview',
      'production',
    ]);

    const inline = await resolveDynamicCompletion(cli, ['deploy', '--target=pre']);
    expect(inline.candidates.map(({ value }) => value)).toEqual([
      '--target=preview',
    ]);

    const global = await resolveDynamicCompletion(cli, ['deploy', '--v']);
    expect(global.candidates.map(({ value }) => value)).toContain('--verbose');
  });

  test('awaits a provider and supplies parsed command context', async () => {
    let received: DynamicCompletionContext | undefined;
    const cli = command('tool', {
      args: [option('workspace', parsers.string, { global: true })],
      subcommands: [command('deploy', {
        args: [
          option('region'),
          option('package', parsers.string, {
            complete: async (context) => {
              await Promise.resolve();
              received = context;
              return [
                { value: 'react', description: 'UI library' },
                'redis',
                'vue',
              ];
            },
          }),
        ],
      })],
    });

    const result = await resolveDynamicCompletion(cli, [
      '--workspace',
      'web',
      'deploy',
      '--region',
      'us-east',
      '--package',
      're',
    ]);

    expect(result.candidates).toEqual([
      { value: 'react', description: 'UI library' },
      { value: 'redis' },
    ]);
    expect(received?.current).toBe('re');
    expect(received?.commandPath).toEqual(['tool', 'deploy']);
    expect(received?.values).toMatchObject({ workspace: 'web', region: 'us-east' });
    expect(received?.rawValues).toMatchObject({
      workspace: ['web'],
      region: ['us-east'],
    });
    expect(Object.isFrozen(received?.values)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
  });

  test('applies default-missing values before later providers run', async () => {
    const received: DynamicCompletionContext[] = [];
    const createCli = (requireEquals: boolean) =>
      command('tool', {
        args: [
          option('mode', parsers.string, {
            short: 'm',
            defaultMissing: 'auto',
            requireEquals,
          }),
          option('target', parsers.string, {
            complete: (context) => {
              received.push(context);
              return ['done'];
            },
          }),
        ],
      });

    for (const requireEquals of [true, false]) {
      const cli = createCli(requireEquals);
      await resolveDynamicCompletion(cli, ['--mode', '--target', '']);
      await resolveDynamicCompletion(cli, ['-m', '--target', '']);
    }

    expect(received).toHaveLength(4);
    for (const context of received) {
      expect(context.values.mode).toBe('auto');
      expect(context.rawValues.mode).toEqual([]);
    }

    let repeated: DynamicCompletionContext | undefined;
    const repeatable = command('tool', {
      args: [
        option('mode', parsers.string, {
          repeatable: true,
          defaultMissing: 'auto',
        }),
        option('target', parsers.string, {
          complete: (context) => {
            repeated = context;
            return ['done'];
          },
        }),
      ],
    });
    await resolveDynamicCompletion(
      repeatable,
      ['--mode', '--mode', '--target', ''],
    );
    expect(repeated?.values.mode).toEqual(['auto', 'auto']);
    expect(repeated?.rawValues.mode).toEqual([]);
  });

  test('supports async iterables and delimiter-aware output', async () => {
    const cli = command('tool', {
      args: [option('label', parsers.string, {
        repeatable: true,
        valueDelimiter: ',',
        complete: async function*() {
          yield 'bug';
          await Promise.resolve();
          yield 'build';
          yield 'docs';
        },
      })],
    });

    const result = await resolveDynamicCompletion(cli, ['--label=docs,bu']);
    expect(result.current).toBe('bu');
    expect(result.candidates.map(({ value }) => value)).toEqual([
      '--label=docs,bug',
      '--label=docs,build',
    ]);

    const firstDelimitedValue = await resolveDynamicCompletion(cli, ['--label=bu']);
    expect(firstDelimitedValue.candidates.map(({ value }) => value)).toEqual([
      '--label=bug',
      '--label=build',
    ]);
  });

  test('tracks option arity before selecting the next completion target', async () => {
    const cli = command('tool', {
      args: [option('pair', parsers.string, {
        numArgs: 2,
        complete: () => ['first', 'second'],
      })],
    });

    const second = await resolveDynamicCompletion(cli, ['--pair', 'first', 's']);
    expect(second.argument?.name).toBe('pair');
    expect(second.candidates.map(({ value }) => value)).toEqual(['second']);

    const complete = await resolveDynamicCompletion(
      cli,
      ['--pair', 'first', 'second', ''],
    );
    expect(complete.argument).toBeUndefined();
  });

  test('completes positional values and lets a provider replace static values', async () => {
    const cli = command('search', {
      args: [
        option('scope'),
        positional('query', parsers.enum(['static']), {
          complete: ({ values }) => {
            return values.scope === 'docs' ? ['open', 'other'] : ['closed'];
          },
        }),
      ],
    });

    const result = await resolveDynamicCompletion(cli, ['--scope', 'docs', 'op']);
    expect(result.argument?.name).toBe('query');
    expect(result.candidates.map(({ value }) => value)).toEqual(['open']);
  });

  test('supports cursor-at-end and rejects invalid candidate values', async () => {
    const cli = command('tool', { args: [flag('verbose')] });
    const result = await resolveDynamicCompletion(cli, [], { cursor: 0 });
    expect(result.current).toBe('');
    expect(result.candidates.map(({ value }) => value)).toContain('--verbose');

    const invalid = command('bad', {
      args: [option('value', parsers.string, {
        complete: () => ['bad\nvalue'],
      })],
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(
      resolveDynamicCompletion(invalid, ['--value', '']),
    ).rejects.toThrow('single-line');

    const invalidTab = command('bad', {
      args: [option('value', parsers.string, {
        complete: () => ['bad\tvalue'],
      })],
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(
      resolveDynamicCompletion(invalidTab, ['--value', '']),
    ).rejects.toThrow('without tabs');
  });

  test('applies CLI values over environment values for every argument shape', async () => {
    const names = {
      scalar: 'KONSTIT_COMPLETION_SCALAR',
      repeatable: 'KONSTIT_COMPLETION_REPEATABLE',
      flag: 'KONSTIT_COMPLETION_FLAG',
      count: 'KONSTIT_COMPLETION_COUNT',
    } as const;
    const previous = new Map<string, string | undefined>();
    for (
      const [name, value,] of [
        [names.scalar, 'environment'],
        [names.repeatable, 'env-one,env-two'],
        [names.flag, 'false'],
        [names.count, '4'],
      ] as const
    ) {
      previous.set(name, Bun.env[name]);
      Bun.env[name] = value;
    }

    let received: DynamicCompletionContext | undefined;
    try {
      const cli = command('precedence', {
        args: [
          option('scalar', parsers.string, { env: names.scalar }),
          option('items', parsers.string, {
            repeatable: true,
            valueDelimiter: ',',
            env: names.repeatable,
          }),
          flag('enabled', { env: names.flag }),
          count('verbose', { short: 'v', env: names.count }),
          option('query', parsers.string, {
            complete: (context) => {
              received = context;
              return ['done'];
            },
          }),
        ],
      });

      await resolveDynamicCompletion(cli, [
        '--scalar=cli',
        '--items',
        'cli-one,cli-two',
        '--enabled',
        '-vv',
        '--query',
        '',
      ]);
    } finally {
      for (const [name, value,] of previous) {
        if (value === undefined) {
          delete Bun.env[name];
        } else {
          Bun.env[name] = value;
        }
      }
    }

    expect(received?.values).toMatchObject({
      scalar: 'cli',
      items: ['cli-one', 'cli-two'],
      enabled: true,
      verbose: 2,
    });
    expect(received?.rawValues).toMatchObject({
      scalar: ['cli'],
      items: ['cli-one', 'cli-two'],
    });
  });

  test('uses runtime minimum arity and negative-number stopping rules', async () => {
    const requiredBeforeChild = command('tool', {
      args: [option('values', parsers.string, {
        numArgs: { min: 2, max: 3 },
        complete: () => ['next'],
      })],
      subcommands: [command('run')],
    });
    const stillCollecting = await resolveDynamicCompletion(
      requiredBeforeChild,
      ['--values', 'one', 'run', 'n'],
    );
    expect(stillCollecting.commandPath).toEqual(['tool']);
    expect(stillCollecting.argument?.name).toBe('values');

    const canStop = command('tool', {
      args: [option('values', parsers.string, {
        numArgs: { min: 1, max: 3 },
      })],
      subcommands: [command('run', {
        visibleAliases: ['go'],
        args: [flag('force')],
      })],
    });
    const child = await resolveDynamicCompletion(canStop, [
      '--values',
      'one',
      'go',
      '--f',
    ]);
    expect(child.commandPath).toEqual(['tool', 'run']);
    expect(child.candidates.map(({ value }) => value)).toContain('--force');

    let received: DynamicCompletionContext | undefined;
    const numbers = command('numbers', {
      args: [
        option('number', parsers.float, { allowNegativeNumbers: true }),
        option('query', parsers.string, {
          complete: (context) => {
            received = context;
            return ['done'];
          },
        }),
      ],
    });
    await resolveDynamicCompletion(numbers, [
      '--number',
      '-.5',
      '--query',
      '',
    ]);
    expect(received?.rawValues.number).toEqual(['-.5']);

    await resolveDynamicCompletion(numbers, [
      '--number',
      '-2',
      '--query',
      '',
    ]);
    expect(received?.rawValues.number).toEqual(['-2']);
  });

  test('consumes option-looking positional values unless an option is declared', async () => {
    const cli = command('positionals', {
      version: '1.0.0',
      args: [
        positional('literal', parsers.string, { allowHyphenValues: true }),
        positional('target', parsers.enum(['beta'])),
        flag('known', { short: 'k' }),
      ],
    });

    const literal = await resolveDynamicCompletion(cli, ['--literal', '']);
    expect(literal.argument?.name).toBe('target');
    expect(literal.candidates.map(({ value }) => value)).toContain('beta');

    const current = await resolveDynamicCompletion(cli, ['--literal']);
    expect(current.argument?.name).toBe('literal');

    const declared = await resolveDynamicCompletion(cli, ['--known', '']);
    expect(declared.argument?.name).toBe('literal');

    for (const token of ['-k', '-h', '-V']) {
      const shortDeclared = await resolveDynamicCompletion(cli, [token, '']);
      expect(shortDeclared.argument?.name).toBe('literal');
    }
    const shortLiteral = await resolveDynamicCompletion(cli, ['-literal']);
    expect(shortLiteral.argument?.name).toBe('literal');
  });

  test('stops option values for a uniquely inferred subcommand', async () => {
    const cli = command('tool', {
      inferSubcommands: true,
      args: [option('values', parsers.string, {
        numArgs: { min: 1, max: 3 },
      })],
      subcommands: [command('status', { args: [flag('child')] })],
    });
    const result = await resolveDynamicCompletion(cli, [
      '--values',
      'one',
      'sta',
      '--c',
    ]);
    expect(result.commandPath).toEqual(['tool', 'status']);
    expect(result.candidates.map(({ value }) => value)).toContain('--child');
  });

  test('prefers an exact inferred subcommand over longer prefixes', async () => {
    const cli = command('tool', {
      inferSubcommands: true,
      args: [option('values', parsers.string, {
        numArgs: { min: 1, max: 3 },
      })],
      subcommands: [
        command('foo', { args: [flag('exact-child')] }),
        command('foobar', { args: [flag('long-child')] }),
      ],
    });
    const result = await resolveDynamicCompletion(cli, [
      '--values',
      'one',
      'foo',
      '--e',
    ]);
    expect(result.commandPath).toEqual(['tool', 'foo']);
    expect(result.candidates.map(({ value }) => value)).toContain('--exact-child');
  });

  test('treats only exact built-ins as declared positional blockers', async () => {
    const cli = command('tool', {
      version: '1.0.0',
      args: [
        positional('literal', parsers.string, { allowHyphenValues: true }),
        positional('target', parsers.enum(['beta'])),
      ],
    });

    for (const token of ['--help=x', '--version=x', '-hx', '-Vx']) {
      const suffixed = await resolveDynamicCompletion(cli, [token, '']);
      expect(suffixed.argument?.name).toBe('target');
      expect(suffixed.candidates.map(({ value }) => value)).toContain('beta');
    }
    for (const token of ['--help', '--version', '-h', '-V']) {
      const exact = await resolveDynamicCompletion(cli, [token, '']);
      expect(exact.argument?.name).toBe('literal');
    }
  });
});
