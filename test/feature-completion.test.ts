import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  option,
  parsers,
  type ValueParser,
} from '../src';
import {
  generateCompletion,
  resolveDynamicCompletion,
} from '../src/completion';

function runShell(commandName: string, script: string) {
  const result = Bun.spawnSync([commandName], {
    stdin: Buffer.from(script),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe('completion feature integration', () => {
  test('passes collection defaults to providers and replaces them from env or CLI', async () => {
    const environmentName = 'KONSTIT_FEATURE_COMPLETION_TAGS';
    const previous = Bun.env[environmentName];
    delete Bun.env[environmentName];

    const contexts: Array<{
      values: Readonly<Record<string, unknown>>;
      rawValues: Readonly<Record<string, readonly string[]>>;
    }> = [];
    const cli = command('defaults', {
      args: [
        option('tags', parsers.string, {
          repeatable: true,
          defaultValues: ['default'],
          env: environmentName,
        }),
        option('target', parsers.string, {
          complete: (context) => {
            contexts.push(context);
            return ['done'];
          },
        }),
      ],
    });

    try {
      await resolveDynamicCompletion(cli, ['--target', '']);
      expect(contexts.at(-1)?.values.tags).toEqual(['default']);

      Bun.env[environmentName] = 'environment';
      await resolveDynamicCompletion(cli, ['--target', '']);
      expect(contexts.at(-1)?.values.tags).toEqual(['environment']);
      expect(contexts.at(-1)?.rawValues.tags).toEqual(['environment']);

      await resolveDynamicCompletion(cli, ['--tags', 'cli', '--target', '']);
      expect(contexts.at(-1)?.values.tags).toEqual(['cli']);
      expect(contexts.at(-1)?.rawValues.tags).toEqual(['cli']);
      expect(contexts.at(-1)?.values.target).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('replaces full tuple occurrences, applies defaultMissing, and uses inherited owner policy', async () => {
    const contexts: Array<{
      values: Readonly<Record<string, unknown>>;
      rawValues: Readonly<Record<string, readonly string[]>>;
    }> = [];
    const cli = command('override-completion', {
      args: [
        option('pair', parsers.string, {
          global: true,
          numArgs: 2,
        }),
        option('mode', parsers.string, {
          global: true,
          defaultMissing: 'auto',
        }),
      ],
      argsOverrideSelf: true,
      subcommands: [command('child', {
        args: [
          option('target', parsers.string, {
            complete: (context) => {
              contexts.push(context);
              return ['done'];
            },
          }),
        ],
      })],
    });

    const result = await resolveDynamicCompletion(cli, [
      '--pair',
      'first',
      'second',
      'child',
      '--pair',
      'third',
      'fourth',
      '--mode',
      '--target',
      '',
    ]);

    expect(result.argument?.name).toBe('target');
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.values.pair).toEqual(['third', 'fourth']);
    expect(contexts[0]?.rawValues.pair).toEqual(['third', 'fourth']);
    expect(contexts[0]?.values.mode).toBe('auto');
    expect(contexts[0]?.rawValues.mode).toEqual([]);
  });

  test('completes canonical enum values with descriptions, aliases, hidden values, and case folding', async () => {
    const parser = parsers.enum(
      [
        { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
        { value: 'secret', aliases: ['s'], describe: 'Hidden mode', hide: true },
      ] as const,
      { ignoreCase: true },
    );
    const cli = command('enum-completion', {
      args: [option('mode', parser)],
    });

    const all = await resolveDynamicCompletion(cli, ['--mode', '']);
    expect(all.candidates).toEqual([{ value: 'fast', description: 'Fast mode' }]);

    const folded = await resolveDynamicCompletion(cli, ['--mode', 'F']);
    expect(folded.candidates).toEqual([{ value: 'fast', description: 'Fast mode' }]);

    const hidden = await resolveDynamicCompletion(cli, ['--mode', 's']);
    expect(hidden.candidates).toEqual([]);

    const aliasOnly: ValueParser<string> = {
      label: 'MODE',
      parse: (input) => input,
      completions: ['f'],
      choices: [{ value: 'fast', aliases: ['f'], describe: 'Fast mode' }],
      ignoreCase: true,
    };
    const noCompletions: ValueParser<string> = {
      label: 'MODE',
      parse: (input) => input,
      choices: [{ value: 'canonical', describe: 'Canonical mode' }],
    };
    const fallbackCli = command('enum-fallback', {
      args: [
        option('alias', aliasOnly),
        option('canonical', noCompletions),
      ],
    });
    expect(
      (await resolveDynamicCompletion(fallbackCli, ['--alias', ''])).candidates,
    ).toEqual([{ value: 'fast', description: 'Fast mode' }]);
    expect(
      (await resolveDynamicCompletion(fallbackCli, ['--canonical', ''])).candidates,
    ).toEqual([{ value: 'canonical', description: 'Canonical mode' }]);
    for (const shell of ['zsh', 'fish', 'powershell'] as const) {
      const script = generateCompletion(fallbackCli, shell);
      expect(script).toContain('Canonical mode');
      expect(script).toContain('Fast mode');
    }

    const source = parsers.custom('VALUE', (input) => input, {
      completions: ['source'],
    });
    const mapped = parsers.map(source, (value) => value.length, {
      completions: ['custom'],
    });
    const mappedCli = command('mapped-completion', {
      args: [option('value', mapped)],
    });
    expect(
      (await resolveDynamicCompletion(mappedCli, ['--value', ''])).candidates,
    ).toEqual([{ value: 'custom' }]);
  });

  test('recognizes zero-value options before completing the next option', async () => {
    for (
      const [index, optional,] of [
        option('optional', parsers.string, { numArgs: { min: 0, max: 1 } }),
        option('optional', parsers.string, { numArgs: 0 }),
      ].entries()
    ) {
      let received: {
        values: Readonly<Record<string, unknown>>;
        rawValues: Readonly<Record<string, readonly string[]>>;
      } | undefined;
      const cli = command('zero-values', {
        args: [
          optional,
          option('derived', parsers.string, { default: 'ordinary' }),
          option('target', parsers.string, {
            complete: (context) => {
              received = context;
              return ['done'];
            },
          }),
        ],
        defaultIf: [{ source: 'optional', target: 'derived', value: 'explicit' }],
      });
      const result = await resolveDynamicCompletion(cli, [
        '--optional',
        '--target',
        '',
      ]);
      expect(result.argument?.name).toBe('target');
      expect(received?.values.optional).toEqual(index === 0 ? undefined : []);
      expect(received?.rawValues.optional).toEqual([]);
      expect(received?.values.derived).toBe('explicit');
    }
  });

  test('keeps parent conditional globals visible after child entry while preserving shadowed locals', async () => {
    let received: {
      values: Readonly<Record<string, unknown>>;
    } | undefined;
    const cli = command('scoped-completion', {
      args: [
        option('mode', parsers.enum(['release']), {
          global: true,
          long: 'global-mode',
        }),
        option('intermediate', parsers.string),
        option('output', parsers.string, { global: true }),
      ],
      defaultIf: [
        { source: 'mode', equals: 'release', target: 'intermediate', value: 'from-mode' },
        { source: 'intermediate', equals: 'from-mode', target: 'output', value: 'global-output' },
      ],
      subcommands: [command('child', {
        args: [
          option('intermediate', parsers.string),
          option('target', parsers.string, {
            complete: (context) => {
              received = context;
              return ['done'];
            },
          }),
        ],
      })],
    });

    const result = await resolveDynamicCompletion(cli, [
      'child',
      '--intermediate',
      'child-local',
      '--global-mode',
      'release',
      '--target',
      '',
    ]);

    expect(result.commandPath).toEqual(['scoped-completion', 'child']);
    expect(result.argument?.name).toBe('target');
    expect(received?.values.intermediate).toBe('child-local');
    expect(received?.values.mode).toBe('release');
    expect(received?.values.output).toBe('global-output');
  });

  test('renders static descriptions and shell-safe values for generated completions', () => {
    const caseCli = command('case-completion', {
      args: [
        option(
          'mode',
          parsers.enum(
            [
              { value: 'Fast', aliases: ['f'], describe: 'Fast mode' },
              { value: 'Safe', describe: 'Safe mode' },
              { value: 'secret', aliases: ['s'], describe: 'Hidden mode', hide: true },
            ] as const,
            { ignoreCase: true },
          ),
        ),
      ],
    });
    const bash = generateCompletion(caseCli, 'bash');
    const bashResult = runShell(
      'bash',
      `${bash}
COMP_WORDS=(case-completion --mode f)
COMP_CWORD=2
_bun_clap_case_completion
printf 'VALUES:%s\n' "\${COMPREPLY[*]}"
`,
    );
    expect(bashResult.exitCode).toBe(0);
    expect(bashResult.stdout).toContain('VALUES:Fast');

    const fishCli = command('fish-completion', {
      args: [
        option(
          'mode',
          parsers.enum(
            [
              { value: 'fast mode', describe: 'Fast mode' },
              { value: 'other', describe: 'Other mode' },
            ] as const,
          ),
        ),
      ],
    });
    const fish = generateCompletion(fishCli, 'fish');
    expect(fish).toContain('-a \'\\\'fast mode\\\'\' -d \'Fast mode\'');
    expect(fish).toContain('-a \'\\\'other\\\'\' -d \'Other mode\'');

    const zsh = generateCompletion(caseCli, 'zsh');
    expect(zsh).toContain('descriptions=(\'Fast mode\' \'Safe mode\')');
    const powerShell = generateCompletion(caseCli, 'powershell');
    for (const script of [bash, zsh, powerShell, generateCompletion(caseCli, 'fish')]) {
      expect(script).not.toContain('secret');
      expect(script).not.toContain('Hidden mode');
    }
    expect(powerShell).toContain(
      '[pscustomobject]@{ Value = \'Fast\'; Description = \'Fast mode\' }',
    );
    expect(powerShell).toContain(
      '[pscustomobject]@{ Value = \'Safe\'; Description = \'Safe mode\' }',
    );
  });
});
