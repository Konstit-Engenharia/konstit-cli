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
import type { ParseOutcome } from '../src/error';

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
  test('can disable the generated help subcommand', () => {
    const cli = command('tool')
      .subcommand(command('status'))
      .disableHelpSubcommand();

    expect(cli.renderHelp()).not.toContain('  help');
    expect(cli.tryParse(['help', 'status'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.InvalidSubcommand },
    });
  });

  test('rejects every built-in version spelling registered first', () => {
    expect(() => command('tool').arg(flag('revision').short('V')).version('1'))
      .toThrow('Version flags conflict');
    expect(() => command('tool').arg(flag('version')).version('1'))
      .toThrow('Version flags conflict');
    expect(() => command('tool').arg(flag('revision').alias('version')).version('1'))
      .toThrow('Version flags conflict');
  });

  test('validates built-in flag collisions when flags are enabled', () => {
    expect(() =>
      command('tool')
        .disableHelpFlag()
        .arg(flag('help'))
        .disableHelpFlag(false)
    ).toThrow('Help flags conflict');

    expect(() =>
      command('tool')
        .disableVersionFlag()
        .arg(flag('version'))
        .version('1')
        .disableVersionFlag(false)
    ).toThrow('Version flags conflict');
  });

  test('validates built-in collisions with inherited global arguments', () => {
    const helpGlobal = command('tool')
      .disableHelpFlag()
      .arg(flag('help').global());
    expect(() => helpGlobal.subcommand(command('child')))
      .toThrow('Help flags conflict');

    const versionGlobal = command('tool')
      .disableVersionFlag()
      .arg(flag('version').global());
    expect(() => versionGlobal.subcommand(command('child').version('1')))
      .toThrow('Version flags conflict');
  });

  test('can require an argument or show help', () => {
    const cli = command('tool')
      .arg(flag('verbose'))
      .argRequiredElseHelp();

    expect(cli.tryParse([])).toMatchObject({
      ok: true,
      type: 'display',
      kind: DisplayKind.Help,
    });
    expect(parse(cli, ['--verbose']).verbose).toBe(true);
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

  test('suggests close subcommand names and aliases', () => {
    const cli = command('tool').subcommand(
      command('clone').alias('copy'),
    );

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
    const aliased = command('tool').alias('run');
    expect(() => aliased.alias('run')).toThrow('Duplicate command alias');
    expect(() => command('tool').alias('tool')).toThrow(
      'Duplicate command alias',
    );

    const child = command('first').alias('shared');
    expect(() => command('tool').subcommand(child).subcommand(command('shared')))
      .toThrow('Duplicate subcommand name or alias');
    expect(() =>
      command('tool').subcommand(child).subcommand(
        command('second').alias('shared'),
      )
    ).toThrow('Duplicate subcommand name or alias');

    const argumentsCli = command('tool').arg(flag('first').alias('shared'));
    expect(() => argumentsCli.arg(flag('second').alias('shared')))
      .toThrow('Duplicate long option');
    expect(() => argumentsCli.arg(flag('first') as never))
      .toThrow('Duplicate argument');

    expect(() =>
      command('tool', {
        args: [flag('same'), flag('same')] as never,
      })
    ).toThrow('Duplicate argument');
    expect(() =>
      command('tool', {
        args: [
          flag('first').alias('shared'),
          flag('second').alias('shared'),
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
          command('first').alias('shared'),
          command('shared'),
        ],
      })
    ).toThrow('Duplicate subcommand name or alias');
    expect(() =>
      command('tool', {
        version: '1',
        args: [flag('revision').short('V')],
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
      command('tool')
        .arg(positional('optional'))
        .arg(positional('required').required())
    )
      .toThrow('required positional cannot follow');

    const shortConflict = command('tool')
      .arg(flag('global').short('g').global())
      .subcommand(command('child').arg(flag('local').short('g')));
    expect(() => parse(shortConflict, ['child']))
      .toThrow('conflicts with inherited global');

    const longConflict = command('tool')
      .arg(flag('global').alias('shared').global())
      .subcommand(command('child').arg(flag('local').alias('shared')));
    expect(() => parse(longConflict, ['child']))
      .toThrow('conflicts with inherited global');
  });

  test('rejects duplicate conditional and group relations', () => {
    const conditional = command('tool')
      .arg(flag('source'))
      .arg(flag('target'));
    expect(() =>
      conditional.requiredIfAny(
        [['source', true], ['source', true]],
        'target',
      )
    ).toThrow('duplicate conditions');

    const grouped = conditional.group('choice', ['source']);
    const registerDuplicateGroup = grouped.group.bind(grouped) as unknown as (
      name: string,
      members: readonly ['target'],
    ) => unknown;
    expect(() => registerDuplicateGroup('choice', ['target']))
      .toThrow('Duplicate argument group');
    expect(() =>
      grouped.groupRequires('choice', 'target')
        .groupRequires('choice', 'target')
    )
      .toThrow('duplicate requires');

    const callUnknownGroup = grouped.groupRequires.bind(grouped) as (
      groupName: string,
      target: 'target',
    ) => unknown;
    expect(() => callUnknownGroup('missing', 'target'))
      .toThrow('Unknown argument group');
  });

  test('infers subcommands from aliases', () => {
    const cli = command('tool')
      .subcommand(command('download').alias('fetch'))
      .inferSubcommands();
    expect(parse(cli, ['fet']).subcommand?.name).toBe('download');
  });

  test('parses flag and count environment fallbacks', () => {
    const originalFlag = Bun.env.KONSTIT_CLI_TEST_FLAG;
    const originalCount = Bun.env.KONSTIT_CLI_TEST_COUNT;
    Bun.env.KONSTIT_CLI_TEST_FLAG = 'yes';
    Bun.env.KONSTIT_CLI_TEST_COUNT = '3';
    try {
      const cli = command('tool')
        .arg(flag('enabled').env('KONSTIT_CLI_TEST_FLAG'))
        .arg(count('verbose').short('v').env('KONSTIT_CLI_TEST_COUNT'));
      expect(parse(cli, [])).toEqual({ enabled: true, verbose: 3 });
      expect(parse(cli, ['--enabled', '-v'])).toEqual({
        enabled: true,
        verbose: 1,
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
      const pairCli = command('tool').arg(
        option('pair', parsers.integer)
          .numArgs(2)
          .valueDelimiter(',')
          .env(names.pair)
          .required(),
      );
      expect(parse(pairCli, []).pair).toEqual([10, 20]);

      const scalarCli = command('tool').arg(
        option('value').valueDelimiter(',').env(names.scalar),
      );
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
      const cli = command('tool')
        .version('1.0.0')
        .arg(option('port', secretAwareInteger).env(name));
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
      const cli = command('tool')
        .arg(option('port', parsers.integer).env(names.target))
        .arg(flag('offline').env(names.source))
        .overrides('offline', 'port');

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
    const hyphen = command('tool')
      .arg(flag('debug'))
      .arg(positional('value').allowHyphenValues());
    expect(parse(hyphen, ['--literal'])).toEqual({
      debug: false,
      value: '--literal',
    });
    expect(parse(hyphen, ['--debug', 'text'])).toEqual({
      debug: true,
      value: 'text',
    });

    const negative = command('tool')
      .arg(flag('one').short('1'))
      .arg(positional('number', parsers.integer).allowNegativeNumbers());
    expect(parse(negative, ['-20'])).toEqual({ one: false, number: -20 });
    expect(parse(negative, ['-1'])).toEqual({ one: true, number: undefined });

    const decimal = command('tool')
      .arg(option('offset', parsers.float).allowNegativeNumbers())
      .arg(positional('number', parsers.float).allowNegativeNumbers());
    expect(parse(decimal, ['--offset', '-.5', '-.25'])).toEqual({
      offset: -0.5,
      number: -0.25,
    });

    const trailing = command('tool').arg(positional('args').trailingVarArg());
    expect(parse(trailing, ['--literal', '-x'])).toEqual({
      args: ['--literal', '-x'],
    });
  });

  test('rejects zero-width positional arguments', () => {
    expect(() => command('tool').arg(positional('empty').numArgs(0)))
      .toThrow('Positional \'empty\' must accept at least one value');
  });

  test('shows required named options and configured value counts', () => {
    const cli = command('tool')
      .disableHelpFlag()
      .arg(option('pair').numArgs(2).required())
      .arg(option('range', parsers.integer).numArgs({ min: 1, max: 3 }))
      .arg(option('equals').numArgs(2).requireEquals())
      .arg(option('optionalEquals').defaultMissing('auto'));

    expect(cli.renderUsage()).toBe('tool [OPTIONS] --pair <STRING> <STRING>');
    expect(cli.renderHelp()).toContain('  --pair <STRING> <STRING>');
    expect(cli.renderHelp()).toContain(
      '  --range <INTEGER> [<INTEGER>] [<INTEGER>]',
    );
    expect(cli.renderHelp()).toContain('  --equals=<STRING> <STRING>');
    expect(cli.renderHelp()).toContain('  --optionalEquals[=<STRING>]');
  });

  test('renders very large value counts without expanding every label', () => {
    const cli = command('tool')
      .disableHelpFlag()
      .arg(option('exact').numArgs(1_000_000).required())
      .arg(option('range').numArgs({ min: 10, max: 1_000_000 }))
      .arg(positional('values').numArgs({ min: 10 }));

    expect(cli.renderUsage()).toBe(
      'tool [OPTIONS] --exact <STRING>{1000000} [VALUES]{10..}',
    );
    expect(cli.renderHelp()).toContain('  --range <STRING>{10..1000000}');
    expect(cli.renderHelp().length).toBeLessThan(1_000);
  });

  test('renders optional and required unbounded positional groups', () => {
    const optional = command('optional')
      .disableHelpFlag()
      .arg(positional('values').numArgs({ min: 3 }));
    expect(optional.renderUsage()).toBe(
      'optional [<VALUES> <VALUES> <VALUES>...]',
    );
    expect(optional.renderHelp()).toContain(
      '  [<VALUES> <VALUES> <VALUES>...]',
    );
    expect(parse(optional, [])).toEqual({ values: undefined });

    const required = command('required')
      .disableHelpFlag()
      .arg(positional('values').numArgs({ min: 3 }).required());
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
    const cli = command('tool')
      .arg(option('values').numArgs({ min: 1, max: 3 }))
      .subcommand(command('status'))
      .inferSubcommands();

    expect(parse(cli, ['--values', 'one', 'sta'])).toEqual({
      values: ['one'],
      subcommand: { name: 'status', args: {} },
    });
  });

  test('uses the default console writers for control output', async () => {
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const error = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cli = command('tool').handler(() => {});
      expect(await cli.run(['--help'])).toBe(0);
      expect(log.mock.calls[0]?.[0]).toContain('Usage: tool');

      expect(await cli.run(['--unknown'])).toBe(2);
      expect(error).toHaveBeenCalledWith(expect.stringContaining(
        'unexpected argument \'--unknown\'',
      ));
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  test('reports nested errors with inherited global context', () => {
    const cli = command('tool')
      .arg(flag('global').global())
      .subcommand(
        command('child')
          .arg(flag('switch').short('s'))
          .arg(option('config').short('c').requireEquals())
          .subcommand(command('grand')),
      );

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
    const cli = command('tool')
      .arg(option('mode').repeatable())
      .arg(option('config'))
      .requiresIf('mode', 'prod', 'config');

    expect(cli.tryParse(['--mode', 'dev', '--mode', 'prod']))
      .toMatchObject({
        ok: false,
        error: { kind: ErrorKind.MissingDependency },
      });
  });

  test('suggests argument aliases', () => {
    const cli = command('tool').arg(flag('verbose').alias('verbosity'));
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
    const cli = command('tool')
      .arg(flag('json'))
      .arg(flag('yaml'))
      .group('format', ['json', 'yaml']);

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
