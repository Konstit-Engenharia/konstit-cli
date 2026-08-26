import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  ErrorKind,
  flag,
  option,
  parsers,
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

describe('advanced argument relations', () => {
  const conditional = command('conditional')
    .arg(option('format', parsers.enum(['json', 'yaml'])))
    .arg(option('mode', parsers.enum(['strict', 'relaxed'])))
    .arg(option('schema'))
    .requiredIfAny(
      [['format', 'json'], ['mode', 'strict']],
      'schema',
    );

  test('requires a target when any value condition matches', () => {
    expect(conditional.tryParse(['--format', 'json'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(conditional.tryParse(['--mode', 'strict'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(parse(conditional, ['--format', 'yaml'])).toMatchObject({
      format: 'yaml',
      schema: undefined,
    });
    expect(
      parse(conditional, ['--format', 'json', '--schema', 'schema.json']),
    ).toMatchObject({ schema: 'schema.json' });
  });

  test('requires a target only when all value conditions match', () => {
    const cli = command('all')
      .arg(option('format', parsers.enum(['json', 'yaml'])))
      .arg(flag('strict'))
      .arg(option('schema'))
      .requiredIfAll(
        [['format', 'json'], ['strict', true]],
        'schema',
      );

    expect(parse(cli, ['--format', 'json'])).toMatchObject({
      format: 'json',
      schema: undefined,
    });
    expect(cli.tryParse(['--format', 'json', '--strict'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });

    const explicitFalse = command('explicit-false')
      .arg(flag('feature'))
      .arg(option('reason'))
      .requiredIfAny([['feature', false]], 'reason');
    expect(parse(explicitFalse, [])).toMatchObject({ reason: undefined });
  });

  test('requires a target unless all alternatives are present', () => {
    const cli = command('unless-all')
      .arg(option('token'))
      .arg(option('profile'))
      .arg(flag('interactive'))
      .requiredUnlessAll(['profile', 'interactive'], 'token');

    expect(cli.tryParse([])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
    expect(cli.tryParse(['--profile', 'dev'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
    expect(parse(cli, ['--profile', 'dev', '--interactive'])).toMatchObject({
      profile: 'dev',
      interactive: true,
    });
    expect(parse(cli, ['--token', 'secret'])).toMatchObject({ token: 'secret' });
  });

  test('makes an argument exclusive with every other provided argument', () => {
    const cli = command('input')
      .arg(flag('stdin'))
      .arg(option('file'))
      .arg(flag('force'))
      .exclusive('stdin');

    expect(parse(cli, ['--stdin'])).toMatchObject({ stdin: true });
    expect(cli.tryParse(['--stdin', '--file', 'input.txt'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    expect(cli.tryParse(['--stdin', '--force'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
  });

  test('applies requirements and conflicts to argument groups', () => {
    const cli = command('auth')
      .arg(option('token'))
      .arg(option('user'))
      .arg(option('endpoint'))
      .arg(flag('anonymous'))
      .group('credentials', ['token', 'user'], { multiple: true })
      .groupRequires('credentials', 'endpoint')
      .groupConflicts('credentials', 'anonymous');

    expect(cli.tryParse(['--token', 'secret'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(
      cli.tryParse([
        '--token',
        'secret',
        '--endpoint',
        'api',
        '--anonymous',
      ]),
    ).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    expect(parse(cli, ['--anonymous'])).toMatchObject({ anonymous: true });
    expect(
      parse(cli, ['--user', 'alice', '--endpoint', 'api']),
    ).toMatchObject({ user: 'alice', endpoint: 'api' });
  });
});

if (false) {
  const typed = command('typed')
    .arg(option('mode', parsers.enum(['dev', 'prod'])))
    .arg(flag('strict'))
    .arg(option('config'))
    .group('settings', ['mode', 'strict']);

  // @ts-expect-error expected values must match the source argument type
  typed.requiredIfAny([['mode', 'preview']], 'config');
  // @ts-expect-error condition argument names must exist
  typed.requiredIfAll([['missing', true]], 'config');
  // @ts-expect-error the target cannot also be an alternative
  typed.requiredUnlessAll(['config'], 'config');
  // @ts-expect-error exclusive argument names must exist
  typed.exclusive('missing');
  // @ts-expect-error group names are inferred from group builders
  typed.groupRequires('missing', 'config');
  // @ts-expect-error group relation targets must be declared arguments
  typed.groupConflicts('settings', 'missing');
}
