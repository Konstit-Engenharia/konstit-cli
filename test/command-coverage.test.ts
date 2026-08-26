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
