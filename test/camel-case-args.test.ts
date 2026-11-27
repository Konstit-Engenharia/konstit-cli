import {
  expect,
  test,
} from 'bun:test';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  command,
  flag,
  getConfigValueFile,
  getValueSource,
  loadConfig,
  option,
  parsers,
  type CommandOptions,
  type Infer,
} from '../src';
import { invoke } from '../src/testing';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;

type _CasingOption = Expect<Equal<CommandOptions['camelCaseArgs'], boolean | undefined>>;

test('camelCases handler keys and keeps parsed and validated arguments canonical', async () => {
  const maximum = option('max-value', parsers.integer, { required: true });
  const payload = option('raw_payload', parsers.map(parsers.string, (text) => ({ inner_key: text })));
  const observed: object[] = [];
  const cli = command('tool', {
    camelCaseArgs: true,
    args: [maximum, payload, flag('dry_run'), flag('mixed-_name'), flag('plain')],
    validate(args) {
      expect(args['max-value']).toBe(5);
      expect(args.dry_run).toBe(true);
    },
    handler(args) {
      type _Keys = Expect<Equal<keyof typeof args, 'maxValue' | 'rawPayload' | 'dryRun' | 'mixedName' | 'plain'>>;
      type _Maximum = Expect<Equal<typeof args.maxValue, number>>;
      expect(Object.isFrozen(args)).toBe(true);
      expect(getValueSource(args, 'maxValue')).toBe('cli');
      expect(getValueSource(args, maximum)).toBe('cli');
      expect(getValueSource(args, 'plain')).toBe('default');
      observed.push(args);
    },
  });
  type _ParsedKeys = Expect<Equal<keyof Infer<typeof cli>, 'max-value' | 'raw_payload' | 'dry_run' | 'mixed-_name' | 'plain'>>;
  const argv = ['--max-value', '5', '--raw-payload', 'data', '--dry-run'];
  const parsed = cli.tryParse(argv);
  const expectedParsed = { 'max-value': 5, 'raw_payload': { inner_key: 'data' }, 'dry_run': true, 'mixed-_name': false, 'plain': false };
  expect(parsed).toMatchObject({ type: 'value', value: expectedParsed });
  expect(await cli.runParsed(parsed)).toBe(0);
  expect(await cli.run(argv)).toBe(0);
  expect(observed).toEqual(Array(2).fill({ maxValue: 5, rawPayload: { inner_key: 'data' }, dryRun: true, mixedName: false, plain: false }));
  expect(parsed).toMatchObject({ type: 'value', value: expectedParsed });
  expect(cli.renderHelp()).toContain('--max-value');
});

test('sets casing per selected command and preserves file provenance and global access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-casing-'));
  try {
    const file = join(directory, 'config.json');
    await Bun.write(file, '{"subcommands":{"deploy":{"values":{"profile_id":"local"}}}}');
    const globalProfile = option('profileId', parsers.string, { global: true, env: 'APP_PROFILE' });
    const localProfile = option('profile_id');
    const cli = command('tool', {
      camelCaseArgs: true,
      args: [globalProfile],
      subcommands: [
        command('deploy', {
          camelCaseArgs: true,
          args: [localProfile],
          handler(args, context) {
            expect(args).toEqual({ profileId: 'local' });
            expect(getValueSource(args, 'profileId')).toBe('config');
            expect(getConfigValueFile(args, 'profileId')).toBe(file);
            expect(getConfigValueFile(args, localProfile)).toBe(file);
            expect(getValueSource(args, globalProfile)).toBe('env');
            expect(context.global(globalProfile)).toBe('shared');
            return 3;
          },
        }),
        command('list', {
          args: [flag('show_hidden')],
          handler(args) {
            expect(args.show_hidden).toBe(true);
            expect(args).toEqual({ show_hidden: true });
            return 4;
          },
        }),
      ],
    });
    const config = await loadConfig(file);
    expect((await invoke(cli, ['deploy'], { config, env: { APP_PROFILE: 'shared' } })).exitCode).toBe(3);
    expect((await invoke(cli, ['list', '--show-hidden'])).exitCode).toBe(4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('accepts a boolean setting and preserves argument identity when no key changes', async () => {
  const configure = (camelCaseArgs: boolean) =>
    command('tool', {
      camelCaseArgs,
      args: [flag('dry-run')],
      handler(args) {
        if ('dryRun' in args) {
          expect(args.dryRun).toBe(true);
          return 3;
        }
        expect(args['dry-run']).toBe(true);
        return 4;
      },
    });
  expect(await configure(true).run(['--dry-run'])).toBe(3);
  expect(await configure(false).run(['--dry-run'])).toBe(4);

  const observed: object[] = [];
  const cli = command('tool', {
    camelCaseArgs: true,
    args: [option('port', parsers.integer)],
    handler(args) {
      observed.push(args);
    },
  });
  const parsed = cli.tryParse(['--port', '8']);
  expect(parsed.type).toBe('value');
  if (parsed.type === 'value') {
    expect(await cli.runParsed(parsed)).toBe(0);
    expect(observed[0]).toBe(parsed.value);
  }
});

test('rejects non-boolean casing and ambiguous projected keys', () => {
  expect(() => command('tool', { camelCaseArgs: 'true' } as never)).toThrow('\'camelCaseArgs\' must be a boolean');
  expect(() =>
    command('tool', {
      camelCaseArgs: true,
      args: [flag('max-value'), flag('maxValue')],
    })
  ).toThrow('duplicate handler key \'maxValue\'');
  expect(() =>
    command('tool', {
      camelCaseArgs: true,
      args: [flag('subcommand_')],
      subcommands: [command('list')],
    })
  ).toThrow('duplicate handler key \'subcommand\'');
});
