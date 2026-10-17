import {
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import {
  CliError,
  command,
  count,
  DisplayKind,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
} from '../src';

describe('argsConflictWithSubcommands', () => {
  test('runs root and child handlers with their own local arguments', async () => {
    const calls: string[] = [];
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      args: [flag('dry-run', { short: 'n' })],
      handler: (args) => {
        calls.push(`build:${args['dry-run']}`);
      },
      subcommands: [command('clean', {
        args: [flag('dry-run', { short: 'n' })],
        handler: (args) => {
          calls.push(`clean:${args['dry-run']}`);
        },
      })],
    });

    for (const argv of [[], ['-n'], ['clean'], ['clean', '-n']]) {
      expect(await cli.run(argv)).toBe(0);
    }
    expect(calls).toEqual(['build:false', 'build:true', 'clean:false', 'clean:true']);
  });

  test('reports a structured conflict and never dispatches a handler', async () => {
    const handler = mock(() => {});
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      args: [flag('dry-run', { short: 'n' })],
      handler,
      subcommands: [command('clean', {
        args: [flag('dry-run', { short: 'n' })],
        handler,
      })],
    });
    const argv = ['-n', 'clean', '-n'];
    const message = 'argument \'--dry-run\' cannot be used with subcommand \'clean\'';
    expect(() => cli.parse(argv)).toThrow(CliError);
    expect(cli.tryParse(argv)).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: ErrorKind.ArgumentConflict, message, exitCode: 2 },
    });
    const stderr: string[] = [];
    const stdout = mock(() => {});
    expect(
      await cli.run({
        argv,
        color: false,
        stdout,
        stderr: (text) => {
          stderr.push(text);
        },
      }),
    ).toBe(2);
    expect(stderr).toEqual([`error: ${message}\n\nUsage: demo [OPTIONS] <COMMAND>\n\nFor more information, try '--help'.\n`]);
    expect(stdout).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  test('preserves existing behavior when omitted or explicitly disabled', () => {
    for (const settings of [{}, { argsConflictWithSubcommands: false }]) {
      const cli = command('demo', {
        ...settings,
        args: [flag('dry-run', { short: 'n' })],
        subcommands: [command('clean', { args: [flag('dry-run')] })],
      });
      expect(cli.parse(['-n', 'clean'])).toMatchObject({
        type: 'value',
        value: { 'dry-run': true, 'subcommand': { name: 'clean', args: { 'dry-run': false } } },
      });
    }
  });

  const localArguments = command('demo', {
    argsConflictWithSubcommands: true,
    args: [
      flag('dry-run', { short: 'n', aliases: ['pretend'] }),
      count('verbose', { short: 'v' }),
      flag('cache', { negated: true }),
      option('enabled', parsers.boolean),
      option('mode', parsers.string, { default: 'safe' }),
      option('output', parsers.string, { default: '' }),
      option('maybe', parsers.string, { numArgs: { min: 0, max: 1 } }),
      option('format', parsers.string, { defaultMissing: 'text' }),
      option('tag', parsers.string, { repeatable: true }),
      positional('input', parsers.string, { default: '.' }),
    ],
    subcommands: [command('clean')],
  });

  test('ignores defaults and absent flags, counts, and collections', () => {
    expect(localArguments.parse(['clean'])).toMatchObject({
      type: 'value',
      value: {
        'dry-run': false,
        'verbose': 0,
        'cache': true,
        'mode': 'safe',
        'output': '',
        'tag': [],
        'input': '.',
        'subcommand': { name: 'clean' },
      },
    });
  });

  test.each([
    [['-n'], '--dry-run'],
    [['--dry-run'], '--dry-run'],
    [['--pretend'], '--dry-run'],
    [['-nv'], '--dry-run'],
    [['-vv'], '--verbose'],
    [['--cache'], '--cache'],
    [['--enabled=false'], '--enabled'],
    [['--mode=safe'], '--mode'],
    [['--output='], '--output'],
    [['--maybe'], '--maybe'],
    [['--format'], '--format'],
    [['--tag=a', '--tag=b'], '--tag'],
    [['.'], '<input>'],
  ])('rejects explicit local arguments %j even when their values are empty or defaulted', (argv, display) => {
    expect(localArguments.tryParse([...argv, 'clean'])).toMatchObject({
      type: 'error',
      error: {
        kind: ErrorKind.ArgumentConflict,
        message: `argument '${display}' cannot be used with subcommand 'clean'`,
      },
    });
  });

  test('ignores environment fallbacks but still rejects explicit CLI values', () => {
    const env = {
      KONSTIT_CONFLICT_TEST_MODE: 'safe',
      KONSTIT_CONFLICT_TEST_DRY_RUN: '1',
      KONSTIT_CONFLICT_TEST_VERBOSE: '2',
      KONSTIT_CONFLICT_TEST_INPUT: 'source',
    };
    const previous = Object.fromEntries(Object.keys(env).map((name) => [name, Bun.env[name]]));
    Object.assign(Bun.env, env);
    try {
      const cli = command('demo', {
        argsConflictWithSubcommands: true,
        args: [
          option('mode', parsers.string, { env: 'KONSTIT_CONFLICT_TEST_MODE' }),
          flag('dry-run', { env: 'KONSTIT_CONFLICT_TEST_DRY_RUN' }),
          count('verbose', { env: 'KONSTIT_CONFLICT_TEST_VERBOSE' }),
          positional('input', parsers.string, { env: 'KONSTIT_CONFLICT_TEST_INPUT' }),
        ],
        subcommands: [command('clean')],
      });
      expect(cli.parse(['clean'])).toMatchObject({
        type: 'value',
        value: { 'mode': 'safe', 'dry-run': true, 'verbose': 2, 'input': 'source', 'subcommand': { name: 'clean' } },
      });
      expect(cli.tryParse(['--mode=safe', 'clean'])).toMatchObject({
        type: 'error',
        error: { kind: ErrorKind.ArgumentConflict },
      });
    } finally {
      for (const [name, value,] of Object.entries(previous)) {
        if (value === undefined) {
          delete Bun.env[name];
        } else {
          Bun.env[name] = value;
        }
      }
    }
  });

  test.each([
    { argv: ['-n', '--reset', 'clean'] },
    { argv: ['-n', 'clean', '--reset'] },
  ])('retains explicit local occurrences cleared by overrides: %j', ({ argv }) => {
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      args: [flag('dry-run', { short: 'n' }), flag('reset', { global: true })],
      overrides: [['reset', 'dry-run']],
      subcommands: [command('clean')],
    });
    expect(cli.tryParse(argv)).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.ArgumentConflict, message: 'argument \'--dry-run\' cannot be used with subcommand \'clean\'' },
    });
    expect(cli.parse(['clean', '--reset'])).toMatchObject({ type: 'value' });
  });

  test('allows globals before and after nested subcommands', async () => {
    const dryRun = flag('dry-run', { short: 'n', global: true });
    const profile = option('profile', parsers.string, { global: true });
    const force = flag('force', { short: 'f', global: true });
    const calls: unknown[] = [];
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      args: [dryRun, profile],
      subcommands: [command('maintenance', {
        argsConflictWithSubcommands: true,
        args: [force],
        subcommands: [command('clean', {
          argsConflictWithSubcommands: true,
          args: [flag('quiet', { short: 'q' })],
          handler: ({ quiet }, context) => {
            calls.push([quiet, context.global(dryRun), context.global(profile), context.global(force)]);
          },
        })],
      })],
    });
    for (
      const argv of [
        ['-n', '--profile=dev', 'maintenance', '-f', 'clean', '-q'],
        ['maintenance', '-nf', 'clean', '--profile=dev', '-q'],
        ['maintenance', 'clean', '-nfq', '--profile=dev'],
      ]
    ) {
      expect(await cli.run(argv)).toBe(0);
    }
    expect(calls).toEqual(Array.from({ length: 3 }, () => [true, true, 'dev', true]));
  });

  test('applies at the declaring command without implicitly enabling descendants', () => {
    for (const enabled of [false, true]) {
      const cli = command('demo', {
        argsConflictWithSubcommands: true,
        args: [flag('build')],
        subcommands: [command('maintenance', {
          argsConflictWithSubcommands: enabled,
          args: [flag('force')],
          subcommands: [command('clean')],
        })],
      });
      expect(cli.tryParse(['--build', 'maintenance', 'clean'])).toMatchObject({
        type: 'error',
        error: { kind: ErrorKind.ArgumentConflict },
      });
      expect(cli.parse(['maintenance', '--force'])).toMatchObject({ type: 'value' });
      const result = cli.tryParse(['maintenance', '--force', 'clean']);
      expect(result.type).toBe(enabled ? 'error' : 'value');
      if (enabled && result.type === 'error') {
        expect(result.error.kind).toBe(ErrorKind.ArgumentConflict);
        expect(result.error.output).toContain('Usage: demo maintenance');
      }
    }
  });

  test.each(['clean', 'scrub', 'cl', 'cle', 'scr'])('recognizes subcommand names, aliases, and inferred prefixes: %s', (name) => {
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      inferSubcommands: true,
      args: [flag('dry-run', { short: 'n' })],
      subcommands: [command('clean', { aliases: ['cl'], visibleAliases: ['scrub'] })],
    });
    expect(cli.tryParse(['-n', name])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.ArgumentConflict, message: 'argument \'--dry-run\' cannot be used with subcommand \'clean\'' },
    });
    expect(cli.tryParse(['-n', 'unknown'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidSubcommand },
    });
  });

  test.each([
    [['-n', 'clean', '--help'], DisplayKind.Help],
    [['-n', 'help', 'clean'], DisplayKind.Help],
    [['-n', '--help', 'clean'], DisplayKind.Help],
    [['-n', 'clean', '--version'], DisplayKind.Version],
    [['-n', '--version', 'clean'], DisplayKind.Version],
  ])('preserves help and version requests: %j', (argv, kind) => {
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      version: '1.0.0',
      args: [flag('dry-run', { short: 'n' })],
      subcommands: [command('clean', { version: '2.0.0' })],
    });
    expect(cli.parse(argv)).toMatchObject({ ok: true, type: 'display', kind });
  });

  test('uses actual subcommand selection across -- and trailing positionals', () => {
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      args: [flag('dry-run', { short: 'n' }), positional('input', parsers.string, { repeatable: true })],
      subcommands: [command('clean', { args: [positional('tail')] })],
    });
    expect(cli.parse(['-n', '--', 'clean'])).toMatchObject({
      type: 'value',
      value: { 'dry-run': true, 'input': ['clean'], 'subcommand': undefined },
    });
    expect(cli.parse(['clean', '--', '-n'])).toMatchObject({
      type: 'value',
      value: { subcommand: { name: 'clean', args: { tail: '-n' } } },
    });
    expect(cli.tryParse(['source', 'clean', '--', 'tail'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.ArgumentConflict },
    });
    const trailing = command('demo', {
      argsConflictWithSubcommands: true,
      args: [positional('tail', parsers.string, { trailingVarArg: true })],
      subcommands: [command('clean')],
    });
    expect(trailing.parse(['source', 'clean'])).toMatchObject({
      type: 'value',
      value: { tail: ['source', 'clean'], subcommand: undefined },
    });
  });

  test('keeps required parent options and positionals enforced', () => {
    for (const argument of [option('input', parsers.string, { required: true }), positional('input', parsers.string, { required: true })]) {
      const cli = command('demo', {
        argsConflictWithSubcommands: true,
        args: [argument],
        subcommands: [command('clean')],
      });
      expect(cli.tryParse(['clean'])).toMatchObject({
        type: 'error',
        error: { kind: ErrorKind.MissingRequiredArgument },
      });
    }
    const cli = command('demo', {
      argsConflictWithSubcommands: true,
      args: [option('input', parsers.string, { required: true })],
      subcommands: [command('clean')],
    });
    expect(cli.parse(['--input=source'])).toMatchObject({ type: 'value' });
    expect(cli.tryParse(['--input=source', 'clean'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.ArgumentConflict },
    });
  });

  test('keeps parent argument relations and required groups enforced', () => {
    const dependency = command('demo', {
      argsConflictWithSubcommands: true,
      args: [flag('shared', { global: true }), option('reason')],
      requires: [['shared', 'reason']],
      subcommands: [command('clean')],
    });
    expect(dependency.tryParse(['clean', '--shared'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.MissingDependency },
    });
    const group = command('demo', {
      argsConflictWithSubcommands: true,
      args: [option('file'), option('directory')],
      groups: [{ name: 'source', members: ['file', 'directory'], required: true }],
      subcommands: [command('clean')],
    });
    expect(group.tryParse(['clean'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
  });

  test.each([null, 'yes', 1, [], {}].map((value) => ({ value })))('rejects non-boolean configuration: %j', ({ value }) => {
    expect(() => command('demo', { argsConflictWithSubcommands: value as never })).toThrow(
      'Command option \'argsConflictWithSubcommands\' must be a boolean',
    );
  });
});

void (() => {
  // @ts-expect-error the conflict constraint accepts only a boolean
  command('demo', { argsConflictWithSubcommands: 'yes' });
});
