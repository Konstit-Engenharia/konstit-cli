import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  count,
  describeCommand,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
  renderManPage,
  renderMarkdown,
  type CliError,
  type ParseResult,
} from '../src';
import { invoke } from '../src/testing';

function parseError(result: ParseResult<unknown>): CliError {
  if (result.type !== 'error') {
    throw new Error(`Expected a parse error, got ${result.type}`);
  }
  return result.error;
}

test('redacts raw option and positional values while keeping argument names and token indices', async () => {
  const secret = 'supplied-secret';
  const parser = parsers.custom('TOKEN', (input) => {
    if (!input.startsWith('ok:')) {
      throw new Error(`private parser detail for ${input}`);
    }
    return input.slice(3);
  });
  const token = option('token', parser, { global: true, required: true, short: 't', aliases: ['key'], sensitive: true });
  const cli = command('tool', {
    args: [token],
    subcommands: [command('run', { handler: (_args, context) => context.global(token) === 'valid' ? 5 : 1 })],
  });

  const optionError = parseError(cli.tryParse(['run', `-t${secret}`]));
  expect(optionError).toMatchObject({
    kind: ErrorKind.InvalidValue,
    argumentName: 'token',
    tokenIndex: 1,
    message: 'invalid value for \'-t\'',
  });
  const positionalCli = command('tool', { args: [positional('pin', parser, { required: true, sensitive: true })] });
  const positionalError = parseError(positionalCli.tryParse([secret]));
  expect(positionalError).toMatchObject({
    kind: ErrorKind.InvalidValue,
    argumentName: 'pin',
    tokenIndex: 0,
    message: 'invalid value for \'<pin>\'',
  });

  const rejected = await invoke(cli, ['run', `--key=${secret}`]);
  expect(rejected.exitCode).toBe(2);
  expect(rejected.stderr).toContain('invalid value for \'--key\'');
  for (const output of [optionError.output, positionalError.output, rejected.stderr]) {
    expect(output).not.toContain(secret);
    expect(output).not.toContain('private parser detail');
  }
  expect((await invoke(cli, ['run', '--token', 'ok:valid'])).exitCode).toBe(5);
});

test('omits sensitive defaults and parser values from help and exported metadata', async () => {
  const cli = command('tool', {
    args: [
      option('token', parsers.enum(['private-choice', 'private-default']), {
        sensitive: true,
        default: 'private-default',
        global: true,
      }),
      option('tokens', parsers.string, { sensitive: true, repeatable: true, defaultValues: ['private-list'] }),
      option('access', parsers.string, { sensitive: true, defaultMissing: 'private-missing' }),
      option('fallback', parsers.string, { sensitive: true }),
      option('public', parsers.string, { sensitive: false, default: 'visible-default' }),
      flag('offline'),
      count('verbose', { sensitive: true }),
    ],
    subcommands: [command('run')],
    defaultIf: [{ source: 'offline', equals: true, target: 'fallback', value: 'private-conditional' }],
  });
  const metadata = describeCommand(cli, { includeHidden: true });
  expect(metadata.arguments[0]).toMatchObject({ name: 'token', sensitive: true, hasDefaultValue: true });
  expect(metadata.arguments[0]).not.toHaveProperty('parser');
  expect(metadata.arguments[0]).not.toHaveProperty('defaultValue');
  expect(metadata.arguments[1]).not.toHaveProperty('defaultValues');
  expect(metadata.arguments[2]).not.toHaveProperty('defaultMissingValue');
  expect(metadata.arguments[6]).not.toHaveProperty('defaultValue');
  expect(metadata.defaultIf).toEqual([]);
  const man = renderManPage(cli).replaceAll('\\-', '-');
  for (const output of [cli.renderHelp(), renderMarkdown(cli), man, JSON.stringify(metadata)]) {
    expect(output).not.toContain('private-');
    expect(output).toContain('visible-default');
  }
  expect((await invoke(cli, ['run', '--help'])).stdout).not.toContain('private-');
  const parsed = cli.parse(['--offline', '--access']);
  expect(parsed).toMatchObject({
    type: 'value',
    value: { token: 'private-default', tokens: ['private-list'], access: 'private-missing', fallback: 'private-conditional' },
  });
});

test('redacts sensitive values in relation diagnostics and relation metadata', () => {
  const expected = 'private-expected';
  const args = [option('token', parsers.string, { sensitive: true }), flag('enabled'), option('config')] as const;
  const requiredValue = command('tool', { args, requiresValue: [['enabled', 'token', expected]] });
  const requiredIf = command('tool', { args, requiresIf: [['token', expected, 'config']] });
  const requiredIfAny = command('tool', {
    args,
    requiredIfAny: [{ conditions: [['token', expected], ['enabled', true]], target: 'config' }],
    defaultIf: [{ source: 'token', equals: expected, target: 'config', value: 'visible' }],
  });
  const attempts = [
    [requiredValue, ['--enabled']],
    [requiredIf, ['--token', expected]],
    [requiredIfAny, ['--enabled']],
  ] as const;
  for (const [cli, argv,] of attempts) {
    const error = parseError(cli.tryParse(argv));
    expect(error.kind).toBe(ErrorKind.MissingDependency);
    expect(error.output).toContain('[redacted]');
    expect(error.output).not.toContain(expected);
    expect(JSON.stringify(describeCommand(cli))).not.toContain(expected);
  }
  expect(describeCommand(requiredIfAny).defaultIf).toEqual([
    { source: 'token', target: 'config', hasEquals: true, value: 'visible' },
  ]);
});

test('redacts ambiguous subcommand tokens encountered while collecting sensitive values', () => {
  const cli = command('tool', {
    args: [
      option('token', parsers.string, { sensitive: true, numArgs: { min: 1, max: 2 } }),
      positional('pin', parsers.string, { sensitive: true }),
    ],
    subcommands: [command('service'), command('serve')],
    inferSubcommands: true,
  });
  for (const argv of [['ser'], ['--token', 'first', 'ser']]) {
    const error = parseError(cli.tryParse(argv));
    expect(error.kind).toBe(ErrorKind.InvalidSubcommand);
    expect(error.message).toContain('subcommand \'[redacted]\' is ambiguous');
    expect(error.message).not.toContain('\'ser\'');
  }
  expect(() => option('token', parsers.string, { sensitive: 'on' as never })).toThrow('must be a boolean');
});
