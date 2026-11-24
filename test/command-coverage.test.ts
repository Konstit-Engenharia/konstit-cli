import {
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  command,
  count,
  DisplayKind,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import type { ParseOutcome } from '../src/result/error';

function parse<Value>(
  configured: { parse(argv: readonly string[]): ParseOutcome<Value>; },
  argv: readonly string[],
): Value {
  const outcome = configured.parse(argv);
  if (outcome.type !== 'value') {
    throw new Error(`Expected a value, got ${outcome.kind}`);
  }
  return outcome.value;
}

describe('command coverage', () => {
  test('advances to the next positional after an explicit value terminator', () => {
    const cli = command('tool', {
      args: [
        positional('inputs', parsers.string, { numArgs: { min: 0, max: 3 }, valueTerminator: ';' }),
        positional('output', parsers.string),
      ],
    });
    expect(parse(cli, ['one', 'two', ';', 'result'])).toEqual({ inputs: ['one', 'two'], output: 'result' });
  });

  test('does not require unused exclusive arguments', () => {
    const cli = command('tool', { args: [flag('one'), flag('two')], exclusive: ['one', 'two'] });
    expect(parse(cli, [])).toEqual({ one: false, two: false });
  });

  test('rejects invalid command names and empty required subcommands', () => {
    const createCommand = command as unknown as (
      name: unknown,
      options?: Record<string, unknown>,
    ) => unknown;
    expect(() => createCommand(123)).toThrow(
      'Invalid command name: expected a string',
    );

    const subcommands = [] as ReturnType<typeof command>[];
    expect(() =>
      command('tool', {
        subcommands,
        subcommandRequired: true,
      })
    ).toThrow('must define at least one subcommand');
  });

  test('can disable the generated help subcommand', () => {
    const cli = command('tool', {
      subcommands: [command('status')],
      disableHelpSubcommand: true,
    });

    expect(cli.renderHelp()).not.toContain('  help');
    expect(cli.tryParse(['help', 'status'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.InvalidSubcommand },
    });
  });

  test('rejects subcommands that collide with generated help', () => {
    expect(() =>
      command('tool', {
        subcommands: [command('help')],
      })
    ).toThrow('Subcommand name or alias \'help\' conflicts');
    expect(() =>
      command('tool', {
        subcommands: [command('status', { aliases: ['help'] })],
      })
    ).toThrow('Subcommand name or alias \'help\' conflicts');

    const disabled = command('tool', {
      disableHelpSubcommand: true,
      subcommands: [command('help')],
    });
    expect(disabled.tryParse(['help'])).toMatchObject({ ok: true, type: 'value' });
  });

  test('rejects every built-in version spelling', () => {
    expect(() =>
      command('tool', {
        version: '1',
        args: [flag('revision', { short: 'V' })],
      })
    ).toThrow('reserved');
    expect(() => command('tool', { version: '1', args: [flag('version')] }))
      .toThrow('reserved');
    expect(() =>
      command('tool', {
        version: '1',
        args: [flag('revision', { aliases: ['version'] })],
      })
    ).toThrow('reserved');
  });

  test('validates built-in flag collisions when flags are enabled', () => {
    expect(() =>
      command('tool', {
        disableHelpFlag: false,
        args: [flag('help')],
      })
    ).toThrow('Option \'--help\' is reserved');

    expect(() =>
      command('tool', {
        version: '1',
        disableVersionFlag: false,
        args: [flag('version')],
      })
    ).toThrow('Option \'--version\' is reserved');
  });

  test('validates built-in collisions with inherited global arguments', () => {
    expect(() =>
      command('tool', {
        disableHelpFlag: true,
        args: [flag('help', { global: true })],
        subcommands: [command('child')],
      })
    )
      .toThrow('Help flags conflict');

    expect(() =>
      command('tool', {
        disableVersionFlag: true,
        args: [flag('version', { global: true })],
        subcommands: [command('child', { version: '1' })],
      })
    )
      .toThrow('Version flags conflict');
  });

  test('can require an argument or show help', () => {
    const cli = command('tool', {
      args: [flag('verbose')],
      defaultToHelp: true,
    });

    expect(cli.tryParse([])).toMatchObject({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
    });
    expect(parse(cli, ['--verbose']).verbose).toBe(true);

    const nested = command('repo', {
      subcommands: [command('status')],
      subcommandRequired: true,
      defaultToHelp: true,
    });
    expect(nested.tryParse([])).toMatchObject({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
    });
    expect(parse(nested, ['status'])).toMatchObject({
      subcommand: { name: 'status' },
    });
  });

  test('initializes a command from tuple options', async () => {
    const cli = command('tool', {
      version: '1.2.3',
      about: 'Tuple configured tool',
      args: [flag('verbose')],
      subcommands: [
        command('status', {
          visibleAliases: ['state'],
          aliases: ['s'],
          args: [flag('short')],
          handler: ({ short }) => short ? 7 : 0,
        }),
      ],
      inferSubcommands: true,
      defaultToHelp: true,
    });

    expect(cli.tryParse([])).toMatchObject({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
    });
    expect(cli.tryParse(['--version'])).toMatchObject({
      ok: true,
      type: 'display',
      kind: DisplayKind.Version,
      output: 'tool 1.2.3\n',
    });
    expect(cli.renderHelp()).toContain('Tuple configured tool');
    expect(cli.renderHelp()).toContain('--verbose');
    expect(cli.renderHelp()).toContain('status (aliases: state)');
    expect(cli.renderHelp()).not.toContain('(aliases: s)');
    expect(parse(cli, ['--verbose', 'sta', '--short'])).toEqual({
      verbose: true,
      subcommand: {
        name: 'status',
        args: { short: true },
      },
    });
    expect(await cli.run(['s', '--short'])).toBe(7);

    expect(parse(command('defaults', { defaultToHelp: false }), [])).toEqual(
      {},
    );
  });

  test('exposes only terminal command operations', () => {
    const cli = command('tool', { args: [flag('verbose')] });

    expect(Object.keys(cli).sort()).toEqual([
      'parse',
      'renderHelp',
      'renderUsage',
      'run',
      'runParsed',
      'tryParse',
    ]);
    expect('arg' in cli).toBe(false);
    expect('handler' in cli).toBe(false);
    expect('subcommand' in cli).toBe(false);
    expect(Object.isFrozen(cli)).toBe(true);
  });

  test('suggests close subcommand names and aliases', () => {
    const cli = command('tool', {
      subcommands: [command('clone', { aliases: ['copy'] })],
    });

    const name = cli.tryParse(['clne']);
    expect(name).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.InvalidSubcommand },
    });
    if (!name.ok) {
      expect(name.error.message).toContain('clone');
    }

    const alias = cli.tryParse(['coppy']);
    if (!alias.ok) {
      expect(alias.error.message).toContain('copy');
    }
  });

  test('rejects duplicate command and argument registrations', () => {
    expect(() => command('tool', { aliases: ['run', 'run'] })).toThrow(
      'Duplicate command alias',
    );
    expect(() => command('tool', { aliases: ['tool'] })).toThrow(
      'Duplicate command alias',
    );

    expect(() =>
      command('tool', {
        subcommands: [
          command('first', { aliases: ['shared'] }),
          command('shared'),
        ],
      })
    ).toThrow('Duplicate subcommand name or alias');
    expect(() =>
      command('tool', {
        subcommands: [
          command('first', { aliases: ['shared'] }),
          command('second', { aliases: ['shared'] }),
        ],
      })
    ).toThrow('Duplicate subcommand name or alias');

    expect(() =>
      command('tool', {
        args: [flag('same'), flag('same')] as never,
      })
    ).toThrow('Duplicate argument');
    expect(() =>
      command('tool', {
        args: [
          flag('first', { aliases: ['shared'] }),
          flag('second', { aliases: ['shared'] }),
        ],
      })
    ).toThrow('Duplicate long option');
    expect(() =>
      command('tool', {
        subcommands: [command('same'), command('same')] as never,
      })
    ).toThrow('Duplicate subcommand name or alias');
    expect(() =>
      command('tool', {
        subcommands: [
          command('first', { aliases: ['shared'] }),
          command('shared'),
        ],
      })
    ).toThrow('Duplicate subcommand name or alias');
    expect(() =>
      command('tool', {
        version: '1',
        args: [flag('revision', { short: 'V' })],
      })
    ).toThrow('Option \'-V\' is reserved');
    expect(() =>
      command('tool', {
        visibleAliases: ['shared'],
        aliases: ['shared'],
      })
    ).toThrow('Duplicate command alias');
  });

  test('rejects invalid positional and inherited global layouts', () => {
    expect(() =>
      command('tool', {
        args: [
          positional('optional'),
          positional('required', parsers.string, { required: true }),
        ],
      })
    )
      .toThrow('required positional cannot follow');

    const shortConflict = command('tool', {
      args: [flag('global', { short: 'g', global: true })],
      subcommands: [command('child', {
        args: [flag('local', { short: 'g' })],
      })],
    });
    expect(() => parse(shortConflict, ['child']))
      .toThrow('conflicts with inherited global');

    const longConflict = command('tool', {
      args: [flag('global', { aliases: ['shared'], global: true })],
      subcommands: [command('child', {
        args: [flag('local', { aliases: ['shared'] })],
      })],
    });
    expect(() => parse(longConflict, ['child']))
      .toThrow('conflicts with inherited global');
  });

  test('rejects duplicate conditional and group relations', () => {
    expect(() =>
      command('tool', {
        args: [flag('source'), flag('target')],
        requiredIfAny: [{
          conditions: [['source', true], ['source', true]],
          target: 'target',
        }],
      } as never)
    ).toThrow('duplicate conditions');

    expect(() =>
      command('tool', {
        args: [flag('source'), flag('target')],
        groups: [
          { name: 'choice', members: ['source'] },
          { name: 'choice', members: ['target'] },
        ],
      } as never)
    )
      .toThrow('Duplicate argument group');
    expect(() =>
      command('tool', {
        args: [flag('source'), flag('target')],
        groups: [{
          name: 'choice',
          members: ['source'],
          requires: ['target', 'target'],
        }],
      } as never)
    )
      .toThrow('duplicate requires');

    expect(() =>
      command('tool', {
        args: [flag('source')],
        groups: [{ name: 'choice', members: ['missing'] }],
      } as never)
    ).toThrow('references unknown argument \'missing\'');
  });

  test('infers subcommands from aliases', () => {
    const cli = command('tool', {
      subcommands: [command('download', { aliases: ['fetch'] })],
      inferSubcommands: true,
    });
    expect(parse(cli, ['fet']).subcommand?.name).toBe('download');
  });

  test('uses flag environment presence and parses count environment values', () => {
    const originalFlag = Bun.env.KONSTIT_CLI_TEST_FLAG;
    const originalNegatedFlag = Bun.env.KONSTIT_CLI_TEST_NEGATED_FLAG;
    const originalCount = Bun.env.KONSTIT_CLI_TEST_COUNT;
    Bun.env.KONSTIT_CLI_TEST_FLAG = '';
    Bun.env.KONSTIT_CLI_TEST_NEGATED_FLAG = 'not-a-boolean';
    Bun.env.KONSTIT_CLI_TEST_COUNT = '3';
    try {
      const cli = command('tool', {
        args: [
          flag('enabled', { env: 'KONSTIT_CLI_TEST_FLAG' }),
          flag('color', {
            long: 'no-color',
            negated: true,
            env: 'KONSTIT_CLI_TEST_NEGATED_FLAG',
          }),
          count('verbose', {
            short: 'v',
            env: 'KONSTIT_CLI_TEST_COUNT',
          }),
        ],
      });
      expect(parse(cli, [])).toEqual({
        enabled: true,
        color: false,
        verbose: 3,
      });
      expect(parse(cli, ['--enabled', '--no-color', '-v'])).toEqual({
        enabled: true,
        color: false,
        verbose: 1,
      });

      delete Bun.env.KONSTIT_CLI_TEST_FLAG;
      delete Bun.env.KONSTIT_CLI_TEST_NEGATED_FLAG;
      expect(parse(cli, [])).toEqual({
        enabled: false,
        color: true,
        verbose: 3,
      });

      Bun.env.KONSTIT_CLI_TEST_COUNT = '-3';
      const negativeCount = cli.tryParse([]);
      expect(negativeCount).toMatchObject({
        ok: false,
        error: { kind: ErrorKind.InvalidValue },
      });
      if (!negativeCount.ok) {
        expect(negativeCount.error.message).toContain(
          'env:KONSTIT_CLI_TEST_COUNT',
        );
        expect(negativeCount.error.message).not.toContain('-3');
        expect(negativeCount.error.output).not.toContain('-3');
      }
      expect(parse(cli, ['-v']).verbose).toBe(1);
    } finally {
      if (originalFlag === undefined) {
        delete Bun.env.KONSTIT_CLI_TEST_FLAG;
      } else {
        Bun.env.KONSTIT_CLI_TEST_FLAG = originalFlag;
      }
      if (originalNegatedFlag === undefined) {
        delete Bun.env.KONSTIT_CLI_TEST_NEGATED_FLAG;
      } else {
        Bun.env.KONSTIT_CLI_TEST_NEGATED_FLAG = originalNegatedFlag;
      }
      if (originalCount === undefined) {
        delete Bun.env.KONSTIT_CLI_TEST_COUNT;
      } else {
        Bun.env.KONSTIT_CLI_TEST_COUNT = originalCount;
      }
    }
  });

  test('parses delimited environment values with configured arity', () => {
    const names = {
      pair: 'KONSTIT_CLI_TEST_ENV_PAIR',
      scalar: 'KONSTIT_CLI_TEST_ENV_SCALAR',
    } as const;
    const previousPair = Bun.env[names.pair];
    const previousScalar = Bun.env[names.scalar];
    Bun.env[names.pair] = '10,20';
    Bun.env[names.scalar] = 'left,right';
    try {
      const pairCli = command('tool', {
        args: [option('pair', parsers.integer, {
          numArgs: 2,
          valueDelimiter: ',',
          env: names.pair,
          required: true,
        })],
      });
      expect(parse(pairCli, []).pair).toEqual([10, 20]);

      const scalarCli = command('tool', {
        args: [option('value', parsers.string, {
          valueDelimiter: ',',
          env: names.scalar,
        })],
      });
      expect(scalarCli.tryParse([])).toMatchObject({
        ok: false,
        error: { kind: ErrorKind.TooManyValues },
      });
    } finally {
      if (previousPair === undefined) {
        delete Bun.env[names.pair];
      } else {
        Bun.env[names.pair] = previousPair;
      }
      if (previousScalar === undefined) {
        delete Bun.env[names.scalar];
      } else {
        Bun.env[names.scalar] = previousScalar;
      }
    }
  });

  test('does not parse invalid environment fallbacks for control output or CLI values', () => {
    const name = 'KONSTIT_CLI_TEST_INVALID_ENV';
    const previous = Bun.env[name];
    const secret = 'secret-environment-value';
    Bun.env[name] = secret;
    try {
      const secretAwareInteger = parsers.custom('INTEGER', (input) => {
        if (!/^\d+$/.test(input)) {
          throw new Error(`rejected ${input}`);
        }
        return Number(input);
      });
      const cli = command('tool', {
        version: '1.0.0',
        args: [option('port', secretAwareInteger, { env: name })],
      });
      expect(cli.tryParse(['--help'])).toMatchObject({
        ok: true,
        type: 'display',
        kind: DisplayKind.Help,
      });
      expect(cli.tryParse(['--version'])).toMatchObject({
        ok: true,
        type: 'display',
        kind: DisplayKind.Version,
      });
      expect(parse(cli, ['--port', '42']).port).toBe(42);
      const invalidEnvironment = cli.tryParse([]);
      expect(invalidEnvironment).toMatchObject({
        ok: false,
        error: { kind: ErrorKind.InvalidValue },
      });
      if (!invalidEnvironment.ok) {
        expect(invalidEnvironment.error.message).toContain(`env:${name}`);
        expect(invalidEnvironment.error.message).not.toContain(secret);
        expect(invalidEnvironment.error.output).not.toContain(secret);
      }

      const invalidCli = cli.tryParse(['--port', 'also-invalid']);
      if (!invalidCli.ok) {
        expect(invalidCli.error.message).toContain('also-invalid');
      }
    } finally {
      if (previous === undefined) {
        delete Bun.env[name];
      } else {
        Bun.env[name] = previous;
      }
    }
  });

  test('does not parse an environment fallback suppressed by a CLI override', () => {
    const names = {
      source: 'KONSTIT_CLI_TEST_OVERRIDE_SOURCE',
      target: 'KONSTIT_CLI_TEST_OVERRIDE_TARGET',
    } as const;
    const previousSource = Bun.env[names.source];
    const previousTarget = Bun.env[names.target];
    Bun.env[names.source] = 'true';
    Bun.env[names.target] = 'secret-environment-value';
    try {
      const cli = command('tool', {
        args: [
          option('port', parsers.integer, { env: names.target }),
          flag('offline', { env: names.source }),
        ],
        overrides: [['offline', 'port']],
      });

      expect(parse(cli, ['--offline'])).toEqual({
        port: undefined,
        offline: true,
      });
      expect(parse(cli, ['--port', '42'])).toEqual({
        port: 42,
        offline: true,
      });
      expect(cli.tryParse([])).toMatchObject({
        ok: false,
        error: { kind: ErrorKind.InvalidValue },
      });
    } finally {
      if (previousSource === undefined) {
        delete Bun.env[names.source];
      } else {
        Bun.env[names.source] = previousSource;
      }
      if (previousTarget === undefined) {
        delete Bun.env[names.target];
      } else {
        Bun.env[names.target] = previousTarget;
      }
    }
  });

  test('accepts option-looking first positional values without hiding declared options', () => {
    const hyphen = command('tool', {
      args: [
        flag('debug'),
        positional('value', parsers.string, { allowHyphenValues: true }),
      ],
    });
    expect(parse(hyphen, ['--literal'])).toEqual({
      debug: false,
      value: '--literal',
    });
    expect(parse(hyphen, ['--debug', 'text'])).toEqual({
      debug: true,
      value: 'text',
    });

    const negative = command('tool', {
      args: [
        flag('one', { short: '1' }),
        positional('number', parsers.integer, { allowNegativeNumbers: true }),
      ],
    });
    expect(parse(negative, ['-20'])).toEqual({ one: false, number: -20 });
    expect(parse(negative, ['-1'])).toEqual({ one: true, number: undefined });

    const decimal = command('tool', {
      args: [
        option('offset', parsers.float, { allowNegativeNumbers: true }),
        positional('number', parsers.float, { allowNegativeNumbers: true }),
      ],
    });
    expect(parse(decimal, ['--offset', '-.5', '-.25'])).toEqual({
      offset: -0.5,
      number: -0.25,
    });

    const trailing = command('tool', {
      args: [positional('args', parsers.string, { trailingVarArg: true })],
    });
    expect(parse(trailing, ['--literal', '-x'])).toEqual({
      args: ['--literal', '-x'],
    });
  });

  test('rejects zero-width positional arguments', () => {
    expect(() =>
      command('tool', {
        args: [positional('empty', parsers.string, { numArgs: 0 })],
      })
    )
      .toThrow('Positional \'empty\' must accept at least one value');
  });

  test('shows required named options and configured value counts', () => {
    const cli = command('tool', {
      disableHelpFlag: true,
      args: [
        option('pair', parsers.string, { numArgs: 2, required: true }),
        option('requiredEquals', parsers.string, { required: true, requireEquals: true }),
        option('range', parsers.integer, { numArgs: { min: 1, max: 3 } }),
        option('equals', parsers.string, { numArgs: 2, requireEquals: true }),
        option('optionalEquals', parsers.string, { defaultMissing: 'auto' }),
      ],
    });

    expect(cli.renderUsage()).toBe(
      'tool [OPTIONS] --pair <STRING> <STRING> --requiredEquals=<STRING>',
    );
    expect(cli.renderHelp()).toContain('  --pair <STRING> <STRING>');
    expect(cli.renderHelp()).toContain('  --requiredEquals=<STRING>');
    expect(cli.renderHelp()).toContain(
      '  --range <INTEGER> [<INTEGER>] [<INTEGER>]',
    );
    expect(cli.renderHelp()).toContain('  --equals=<STRING> <STRING>');
    expect(cli.renderHelp()).toContain('  --optionalEquals[=<STRING>]');
  });

  test('renders very large value counts without expanding every label', () => {
    const cli = command('tool', {
      disableHelpFlag: true,
      args: [
        option('exact', parsers.string, {
          numArgs: 1_000_000,
          required: true,
        }),
        option('range', parsers.string, {
          numArgs: { min: 10, max: 1_000_000 },
        }),
        positional('values', parsers.string, { numArgs: { min: 10 } }),
      ],
    });

    expect(cli.renderUsage()).toBe(
      'tool [OPTIONS] --exact <STRING>{1000000} [VALUES]{10..}',
    );
    expect(cli.renderHelp()).toContain('  --range <STRING>{10..1000000}');
    expect(cli.renderHelp().length).toBeLessThan(1_000);
  });

  test('renders optional and required unbounded positional groups', () => {
    const optional = command('optional', {
      disableHelpFlag: true,
      args: [positional('values', parsers.string, { numArgs: { min: 3 } })],
    });
    expect(optional.renderUsage()).toBe(
      'optional [<VALUES> <VALUES> <VALUES>...]',
    );
    expect(optional.renderHelp()).toContain(
      '  [<VALUES> <VALUES> <VALUES>...]',
    );
    expect(parse(optional, [])).toEqual({ values: undefined });

    const required = command('required', {
      disableHelpFlag: true,
      args: [positional('values', parsers.string, {
        numArgs: { min: 3 },
        required: true,
      })],
    });
    expect(required.renderUsage()).toBe(
      'required <VALUES> <VALUES> <VALUES>...',
    );
    expect(required.renderHelp()).toContain(
      '  <VALUES> <VALUES> <VALUES>...',
    );
    expect(required.tryParse([])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
  });

  test('stops option value collection for inferred subcommands', () => {
    const cli = command('tool', {
      args: [option('values', parsers.string, {
        numArgs: { min: 1, max: 3 },
      })],
      subcommands: [command('status')],
      inferSubcommands: true,
    });

    expect(parse(cli, ['--values', 'one', 'sta'])).toEqual({
      values: ['one'],
      subcommand: { name: 'status', args: {} },
    });
  });

  test('writes terminal messages with one trailing newline and preserves raw handler chunks', async () => {
    const write = spyOn(Bun, 'write').mockResolvedValue(0);
    try {
      const cli = command('tool', {
        overrideHelp: 'Custom help  \n\n',
        handler: async (_args, { stdout, stderr }) => {
          await stdout('a  ');
          await stderr('\n\n');
        },
      });
      expect(await cli.run({ argv: ['--help'], color: false })).toBe(0);
      expect(write).toHaveBeenCalledWith(Bun.stdout, 'Custom help\n');

      expect(await cli.run(['--unknown'])).toBe(2);
      expect(write).toHaveBeenCalledWith(
        Bun.stderr,
        expect.stringContaining(
          'unexpected argument \'--unknown\'',
        ),
      );
      expect(await cli.run([])).toBe(0);
      expect(write).toHaveBeenCalledWith(Bun.stdout, 'a  ');
      expect(write).toHaveBeenCalledWith(Bun.stderr, '\n\n');
    } finally {
      write.mockRestore();
    }
  });

  test('reports nested errors with inherited global context', () => {
    const cli = command('tool', {
      args: [flag('global', { global: true })],
      subcommands: [command('child', {
        args: [
          flag('switch', { short: 's' }),
          option('config', parsers.string, { short: 'c', requireEquals: true }),
        ],
        subcommands: [command('grand')],
      })],
    });

    expect(parse(cli, ['child', '--switch', '--config=value', 'grand']))
      .toMatchObject({ subcommand: { name: 'child' } });
    expect(parse(cli, ['child', '-s', '-cvalue', 'grand']))
      .toMatchObject({ subcommand: { name: 'child' } });

    for (
      const argv of [
        ['child', 'unknown'],
        ['child', '--unknown'],
        ['child', '-x'],
        ['child', '--config'],
        ['child', '-c'],
      ]
    ) {
      expect(cli.tryParse(argv).ok).toBe(false);
    }

    const help = cli.tryParse(['child', 'help', 'grand']);
    expect(help).toMatchObject({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
    });
  });

  test('matches relation values collected into arrays', () => {
    const cli = command('tool', {
      args: [
        option('mode', parsers.string, { repeatable: true }),
        option('config'),
      ],
      requiresIf: [['mode', 'prod', 'config']],
    });

    expect(cli.tryParse(['--mode', 'dev', '--mode', 'prod']))
      .toMatchObject({
        ok: false,
        error: { kind: ErrorKind.MissingDependency },
      });
  });

  test('suggests argument aliases', () => {
    const cli = command('tool', {
      args: [flag('verbose', { aliases: ['verbosity'] })],
    });
    const result = cli.tryParse(['--verbosit']);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.UnknownArgument },
    });
    if (!result.ok) {
      expect(result.error.message).toContain('--verbosity');
    }
  });

  test('reports all members in a non-multiple group conflict', () => {
    const cli = command('tool', {
      args: [flag('json'), flag('yaml')],
      groups: [{ name: 'format', members: ['json', 'yaml'] }],
    });

    const result = cli.tryParse(['--json', '--yaml']);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    if (!result.ok) {
      expect(result.error.message).toContain('--json, --yaml');
    }
  });
});

void (() => {
  // @ts-expect-error required subcommands need a non-empty literal tuple
  command('empty-required', {
    subcommands: [],
    subcommandRequired: true,
  });
});
