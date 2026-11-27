import {
  expect,
  test,
} from 'bun:test';
import {
  CliError,
  command,
  ErrorKind,
  flag,
  getValueSource,
  option,
  parsers,
} from '../src';
import { invoke } from '../src/testing';

test('validates resolved defaults and overrides and reports a structured parse failure', async () => {
  const seen: [number, number][] = [];
  const cli = command('range', {
    args: [
      option('start', parsers.integer, { default: 10 }),
      option('end', parsers.integer, { required: true }),
      flag('short'),
      flag('confirmed'),
      flag('reset'),
    ],
    defaultIf: [{ source: 'short', equals: true, target: 'start', value: 3 }],
    requires: [['short', 'confirmed']],
    overrides: [['reset', 'start']],
    validate({ start, end }) {
      seen.push([start, end]);
      if (end < start) {
        return { argumentName: 'end', message: 'End must be at least start.', relatedArguments: ['start'] };
      }
    },
    handler: () => 7,
  });
  expect(cli.parse(['--help']).type).toBe('display');
  expect(cli.tryParse(['--short', '--end', '4'])).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.MissingDependency },
  });
  expect(seen).toEqual([]);

  expect(() => cli.parse(['--end', '4'])).toThrow(CliError);
  expect(cli.tryParse(['--end', '4'])).toMatchObject({
    type: 'error',
    error: {
      kind: ErrorKind.InvalidValue,
      argumentName: 'end',
      commandPath: ['range'],
      tokenIndex: 0,
      relatedArguments: ['start'],
      message: 'invalid value for \'--end\': End must be at least start.',
    },
  });
  const invocation = await invoke(cli, ['--end', '4']);
  expect(invocation.exitCode).toBe(2);
  expect(invocation.stderr).toContain('End must be at least start.');

  const parsed = cli.parse(['--short', '--confirmed', '--end', '4']);
  expect(seen).toEqual([[10, 4], [10, 4], [10, 4], [3, 4]]);
  expect(await cli.runParsed(parsed)).toBe(7);
  expect(seen).toHaveLength(4);
  expect(cli.parse(['--start', '100', '--reset', '--end', '12']).type).toBe('value');
  expect(seen.at(-1)).toEqual([10, 12]);
});

test('validates from leaf to root after ancestors finish resolving values and relations', () => {
  const events: string[] = [];
  const profile = option('profile', parsers.string, { global: true, default: 'default' });
  const cli = command('tool', {
    args: [profile, flag('force'), flag('confirmed')],
    subcommands: [
      command('run', {
        args: [option('port', parsers.integer, { required: true })],
        validate(args) {
          events.push(`child:${getValueSource(args, profile)}:${args.port}`);
          if (args.port === 0) {
            return { argumentName: 'port', message: 'Port must be positive.' };
          }
        },
      }),
      command('status', {
        validate: () => {
          throw new Error('Unexpected validation');
        },
      }),
    ],
    subcommandRequired: true,
    requires: [['force', 'confirmed']],
    validate({ profile, subcommand }) {
      if (subcommand.name === 'run') {
        events.push(`root:${profile}:${subcommand.args.port}`);
      }
    },
  });
  const options = { config: { values: { profile: 'staging' } } };
  expect(cli.tryParse(['--force', 'run', '--port', '1'], options)).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.MissingDependency, commandPath: ['tool'] },
  });
  expect(events).toEqual([]);
  expect(cli.tryParse(['run', '--port', '0'], options)).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.InvalidValue, commandPath: ['tool', 'run'], argumentName: 'port', tokenIndex: 1 },
  });
  expect(events).toEqual(['child:config:0']);
  expect(cli.parse(['run', '--port', '1'], options).type).toBe('value');
  expect(events).toEqual(['child:config:0', 'child:config:1', 'root:staging:1']);
});

test('redacts issue details involving sensitive arguments', async () => {
  const cli = command('tool', {
    args: [option('token', parsers.string, { sensitive: true }), flag('enabled')],
    validate({ token, enabled }) {
      return token === undefined ? undefined : {
        argumentName: enabled ? 'enabled' : 'token',
        relatedArguments: enabled ? ['token'] : [],
        message: `rejected token ${token}`,
      };
    },
  });
  for (const argv of [['--token', 'private-token'], ['--enabled', '--token', 'private-token']]) {
    const result = await invoke(cli, argv);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid value for');
    expect(result.stderr).not.toContain('private-token');
    expect(result.stderr).not.toContain('rejected token');
  }
});

test('rejects invalid validator definitions and results', () => {
  expect(() => command('tool', { validate: 1 as never })).toThrow('must be a function');
  for (
    const issue of [
      null,
      { argumentName: 'missing', message: 'Unknown argument.' },
      { argumentName: 'limit', message: 'Invalid relation.', relatedArguments: ['missing'] },
      { argumentName: 'limit', message: 'Invalid relation.', relatedArguments: 'limit' },
    ]
  ) {
    const cli = command('tool', { args: [option('limit')], validate: () => issue as never });
    expect(() => cli.tryParse([])).toThrow(TypeError);
  }
});

function _checkCommandValidatorTypes() {
  command('tool', {
    args: [option('limit', parsers.integer)],
    // @ts-expect-error issue names must refer to declared arguments
    validate: () => ({ argumentName: 'missing', message: 'Unknown argument.' }),
  });
  command('tool', {
    args: [option('limit', parsers.integer)],
    // @ts-expect-error validators must return synchronously
    validate: async () => {},
  });
}
