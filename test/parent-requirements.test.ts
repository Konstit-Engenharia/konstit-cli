import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  describeCommand,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
  renderMarkdown,
} from '../src';

test('requires local arguments for direct invocations and globals throughout the command tree', async () => {
  const profile = option('profile', parsers.string, { global: true, required: true });
  const calls: string[] = [];
  const cli = command('tool', {
    args: [profile, option('input', parsers.string, { required: 'without-subcommand' })],
    argsConflictWithSubcommands: true,
    handler: ({ input }) => {
      calls.push(input);
    },
    subcommands: [command('maintenance', {
      args: [positional('folder', parsers.string, { required: 'without-subcommand' })],
      subcommands: [command('clean', {
        handler: (_args, context) => {
          calls.push(context.global(profile));
        },
      })],
    })],
  });

  const options = { env: {} };
  expect(await cli.run({ ...options, argv: ['--profile', 'dev', '--input', 'data.csv'] })).toBe(0);
  expect(await cli.run({ ...options, argv: ['maintenance', 'clean', '--profile', 'dev'] })).toBe(0);
  expect(calls).toEqual(['data.csv', 'dev']);
  expect(cli.tryParse(['--profile', 'dev'], options)).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.MissingRequiredArgument, argumentName: 'input' },
  });
  expect(cli.tryParse(['maintenance', '--profile', 'dev'], options)).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.MissingRequiredArgument, argumentName: 'folder' },
  });
  expect(cli.tryParse(['maintenance', 'clean'], options)).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.MissingRequiredArgument, argumentName: 'profile' },
  });
  expect(cli.tryParse(['--input', 'data.csv', 'maintenance', 'clean', '--profile', 'dev'], options)).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.ArgumentConflict, argumentName: 'input' },
  });
  expect(cli.renderHelp()).toContain('[required without a subcommand]');
  expect(renderMarkdown(cli)).toContain('required without a subcommand');
  expect(describeCommand(cli).arguments).toContainEqual(expect.objectContaining({ name: 'input', presence: 'without-subcommand' }));
});

test('reports a missing subcommand when the command only supports child invocations', () => {
  const cli = command('tool', {
    args: [option('input', parsers.string, { required: 'without-subcommand' })],
    subcommands: [command('clean')],
    subcommandRequired: true,
  });
  expect(cli.tryParse([])).toMatchObject({ type: 'error', error: { kind: ErrorKind.MissingSubcommand } });
  expect(cli.parse(['clean'])).toMatchObject({ type: 'value', value: { input: undefined } });
});

test('validates supplied local values and relations when a subcommand is selected', () => {
  const cli = command('tool', {
    args: [
      flag('check'),
      option('limit', parsers.integer, { required: 'without-subcommand' }),
    ],
    requires: [['check', 'limit']],
    subcommands: [command('clean')],
  });
  expect(cli.parse(['clean'])).toMatchObject({ type: 'value', value: { limit: undefined } });
  expect(cli.parse(['--limit', '5', 'clean'])).toMatchObject({ type: 'value', value: { limit: 5 } });
  expect(cli.tryParse(['--limit', 'bad', 'clean'])).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.InvalidValue, argumentName: 'limit' },
  });
  expect(cli.tryParse(['--check', 'clean'])).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.MissingDependency },
  });
});

test('rejects incompatible direct requirement settings from runtime callers', () => {
  expect(() => option('input', parsers.string, { required: 'subcommand' } as never)).toThrow('\'required\' must be a boolean');
  expect(() => option('input', parsers.string, { required: 'without-subcommand', global: true } as never)).toThrow('cannot be global');
  expect(() => option('input', parsers.string, { required: 'without-subcommand', default: 'input' } as never)).toThrow('have a default');
  expect(() => positional('input', parsers.string, { required: 'without-subcommand', defaultValues: ['input'], numArgs: 2 } as never))
    .toThrow('have default values');
});
