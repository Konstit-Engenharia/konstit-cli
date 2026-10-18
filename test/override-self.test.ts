import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  count,
  flag,
  getValueSource,
  option,
  parsers,
} from '../src';

describe('argsOverrideSelf', () => {
  test('keeps duplicate non-repeatable options conflicting by default', () => {
    const cli = command('demo', { args: [option('name')] });

    expect(cli.tryParse(['--name', 'first', '--name', 'second'])).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: 'argument-conflict' },
    });
  });

  test('replaces scalar, tuple, optional, and default-missing values', () => {
    const cli = command('demo', {
      argsOverrideSelf: true,
      args: [
        option('name'),
        option('pair', parsers.string, { numArgs: 2 }),
        option('maybe', parsers.string, { numArgs: { min: 0, max: 1 } }),
        option('format', parsers.string, { defaultMissing: 'auto' }),
      ],
    });

    expect(cli.parse([
      '--name=first',
      '--name=second',
      '--pair',
      'left',
      'right',
      '--pair',
      'new-left',
      'new-right',
      '--maybe=present',
      '--maybe',
      '--format=json',
      '--format',
    ])).toMatchObject({
      ok: true,
      type: 'value',
      value: {
        name: 'second',
        pair: ['new-left', 'new-right'],
        maybe: undefined,
        format: 'auto',
      },
    });
  });

  test('keeps repeatable values appended and count switches incremented', () => {
    const cli = command('demo', {
      argsOverrideSelf: true,
      args: [
        option('tag', parsers.string, { repeatable: true }),
        count('verbose', { short: 'v' }),
      ],
    });

    expect(cli.parse(['--tag=one', '--tag=two', '-vv'])).toMatchObject({
      ok: true,
      type: 'value',
      value: {
        tag: ['one', 'two'],
        verbose: 2,
      },
    });
  });

  test('replaces repeated ordinary boolean flags', () => {
    const cli = command('demo', {
      argsOverrideSelf: true,
      args: [
        flag('enabled'),
        flag('disabled', { negated: true }),
      ],
    });

    expect(cli.parse([
      '--enabled',
      '--enabled',
      '--disabled',
      '--disabled',
    ])).toMatchObject({
      ok: true,
      type: 'value',
      value: { enabled: true, disabled: false },
    });
  });

  test('uses the declaring command setting for inherited globals', () => {
    const rootOverrides = command('root', {
      argsOverrideSelf: true,
      args: [option('profile', parsers.string, { global: true })],
      subcommands: [command('child', { argsOverrideSelf: false })],
    });
    expect(rootOverrides.parse([
      '--profile=before',
      'child',
      '--profile=after',
    ])).toMatchObject({ ok: true, type: 'value', value: { profile: 'after' } });

    const childOverrides = command('root', {
      argsOverrideSelf: false,
      args: [option('profile', parsers.string, { global: true })],
      subcommands: [command('child', { argsOverrideSelf: true })],
    });
    expect(childOverrides.tryParse([
      '--profile=before',
      'child',
      '--profile=after',
    ])).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: 'argument-conflict' },
    });

    const inheritedFlag = command('root', {
      argsOverrideSelf: true,
      args: [flag('verbose', { global: true })],
      subcommands: [command('child', { argsOverrideSelf: false })],
    });
    expect(inheritedFlag.parse([
      '--verbose',
      'child',
      '--verbose',
    ])).toMatchObject({
      ok: true,
      type: 'value',
      value: {
        verbose: true,
        subcommand: { name: 'child' },
      },
    });

    const childCannotOverrideInheritedFlag = command('root', {
      argsOverrideSelf: false,
      args: [flag('verbose', { global: true })],
      subcommands: [command('child', { argsOverrideSelf: true })],
    });
    expect(childCannotOverrideInheritedFlag.tryParse([
      '--verbose',
      'child',
      '--verbose',
    ])).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: 'argument-conflict' },
    });
  });

  test('replaces inherited default-missing values through long aliases and short forms', () => {
    const cli = command('root', {
      argsOverrideSelf: true,
      args: [option('profile', parsers.string, {
        aliases: ['profile-file'],
        defaultMissing: 'auto',
        global: true,
        short: 'p',
      })],
      subcommands: [command('child')],
    });

    for (const secondOccurrence of ['--profile-file', '-p']) {
      const result = cli.parse([
        '--profile-file=before',
        'child',
        secondOccurrence,
      ]);
      expect(result).toMatchObject({
        ok: true,
        type: 'value',
        value: { profile: 'auto' },
      });
      if (result.type === 'value') {
        expect(getValueSource(result.value, 'profile')).toBe('cli');
      }
    }
  });

  test('keeps color flag paired switches conflicting', () => {
    const cli = command('demo', {
      argsOverrideSelf: true,
      args: [colorFlag('color')],
    });

    expect(cli.tryParse(['--color', '--no-color'])).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: 'argument-conflict' },
    });
  });
});
