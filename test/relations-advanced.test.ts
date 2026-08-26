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
  const conditional = command('conditional', {
    args: [
      option('format', parsers.enum(['json', 'yaml'])),
      option('mode', parsers.enum(['strict', 'relaxed'])),
      option('schema'),
    ],
    requiredIfAny: [{
      conditions: [['format', 'json'], ['mode', 'strict']],
      target: 'schema',
    }],
  });

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
    const cli = command('all', {
      args: [
        option('format', parsers.enum(['json', 'yaml'])),
        flag('strict'),
        option('schema'),
      ],
      requiredIfAll: [{
        conditions: [['format', 'json'], ['strict', true]],
        target: 'schema',
      }],
    });

    expect(parse(cli, ['--format', 'json'])).toMatchObject({
      format: 'json',
      schema: undefined,
    });
    expect(cli.tryParse(['--format', 'json', '--strict'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });

    const explicitFalse = command('explicit-false', {
      args: [flag('feature'), option('reason')],
      requiredIfAny: [{ conditions: [['feature', false]], target: 'reason' }],
    });
    expect(parse(explicitFalse, [])).toMatchObject({ reason: undefined });
  });

  test('requires a target unless all alternatives are present', () => {
    const cli = command('unless-all', {
      args: [option('token'), option('profile'), flag('interactive')],
      requiredUnlessAll: [{
        alternatives: ['profile', 'interactive'],
        target: 'token',
      }],
    });

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
    const cli = command('input', {
      args: [flag('stdin'), option('file'), flag('force')],
      exclusive: ['stdin'],
    });

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
    const cli = command('auth', {
      args: [
        option('token'),
        option('user'),
        option('endpoint'),
        flag('anonymous'),
      ],
      groups: [{
        name: 'credentials',
        members: ['token', 'user'],
        multiple: true,
        requires: ['endpoint'],
        conflicts: ['anonymous'],
      }],
    });

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

void (() => {
  command('bad-value', {
    args: [
      option('mode', parsers.enum(['dev', 'prod'])),
      option('config'),
    ],
    // @ts-expect-error expected values must match the source argument type
    requiredIfAny: [{ conditions: [['mode', 'preview']], target: 'config' }],
  });
  command('bad-condition', {
    args: [flag('strict'), option('config')],
    // @ts-expect-error condition argument names must exist
    requiredIfAll: [{ conditions: [['missing', true]], target: 'config' }],
  });
  command('bad-alternative', {
    args: [option('config')],
    // @ts-expect-error the target cannot also be an alternative
    requiredUnlessAll: [{ alternatives: ['config'], target: 'config' }],
  });
  command('bad-exclusive', {
    args: [option('config')],
    // @ts-expect-error exclusive argument names must exist
    exclusive: ['missing'],
  });
  command('bad-group-member', {
    args: [option('config')],
    // @ts-expect-error group members must be declared arguments
    groups: [{ name: 'settings', members: ['missing'] }],
  });
  command('bad-group-conflict', {
    args: [option('mode')],
    groups: [{
      name: 'settings',
      members: ['mode'],
      // @ts-expect-error group relation targets must be declared arguments
      conflicts: ['missing'],
    }],
  });
});
