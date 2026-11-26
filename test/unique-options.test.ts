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
  type Infer,
} from '../src/index.js';

const modeParser = parsers.enum([{ value: 'fast', aliases: ['f'] }, 'safe'], { ignoreCase: true });
const cli = command('tool', {
  args: [option('mode', modeParser, {
    short: 'm',
    repeatable: true,
    unique: true,
    valueDelimiter: ',',
    env: 'TEST_UNIQUE_MODES',
  })],
});

type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type _UniqueModeIsReadonlyArray = Expect<Equal<Infer<typeof cli>['mode'], readonly ('fast' | 'safe')[]>>;

void ((first: 'fast' | 'safe', second: 'fast' | 'safe') => {
  // @ts-expect-error unique options must be repeatable
  option('mode', modeParser, { unique: true });
  // @ts-expect-error unique is an option setting
  positional('mode', modeParser, { repeatable: true, unique: true });
  // @ts-expect-error the canonical literal occurs twice
  option('mode', modeParser, { repeatable: true, unique: true, defaultValues: ['fast', 'safe', 'fast'] });
  option('mode', modeParser, { repeatable: true, unique: true, defaultValues: ['safe', 'fast'] });
  option('mode', modeParser, { repeatable: true, unique: true, defaultValues: [first, second] });
});

test('returns unique canonical values in input order as a frozen array', () => {
  const parsed = cli.parse(['--mode', 'SAFE', '-m', 'F'], { env: {} });
  expect(parsed.type).toBe('value');
  if (parsed.type === 'value') {
    expect(parsed.value.mode).toEqual(['safe', 'fast']);
    expect(Object.isFrozen(parsed.value.mode)).toBe(true);
  }
  expect(cli.tryParse([], { env: {} })).toMatchObject({ type: 'value', value: { mode: [] } });
  expect(describeCommand(cli).arguments[0]?.unique).toBe(true);
});

test('rejects duplicate parsed values across occurrences and within an occurrence', () => {
  for (const argv of [['--mode', 'F', '-m', 'fast'], ['--mode=fast,F']]) {
    expect(cli.tryParse(argv, { env: {} })).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidValue, argumentName: 'mode', message: 'invalid value for \'--mode\': values must be unique' },
    });
  }
});

test('checks the resolved environment or config array', () => {
  const config = { values: { mode: ['F', 'fast'] } };
  for (const options of [{ env: { TEST_UNIQUE_MODES: 'fast,F' } }, { env: {}, config }]) {
    expect(cli.tryParse([], options)).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidValue, argumentName: 'mode' },
    });
  }
  expect(cli.tryParse(['--mode', 'safe'], { env: { TEST_UNIQUE_MODES: 'fast,F' }, config })).toMatchObject({
    type: 'value',
    value: { mode: ['safe'] },
  });
});

test('checks defaults resolved at runtime', () => {
  const defaults: readonly ('fast' | 'safe')[] = ['fast', 'fast'];
  const withDefaults = command('tool', {
    args: [
      flag('safe'),
      option('mode', modeParser, { repeatable: true, unique: true, defaultValues: defaults, defaultMissing: 'safe' }),
    ],
    defaultIf: [{ source: 'safe', target: 'mode', value: ['safe', 'safe'] }],
  });
  for (const argv of [[], ['--safe'], ['--mode', '--mode']]) {
    expect(withDefaults.tryParse(argv)).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidValue, argumentName: 'mode' },
    });
  }
  expect(withDefaults.tryParse(['--mode=fast'])).toMatchObject({ type: 'value', value: { mode: ['fast'] } });
});

test('checks inherited values together and redacts sensitive diagnostics', () => {
  const parent = command('tool', {
    args: [option('secret', parsers.string, { global: true, repeatable: true, unique: true, sensitive: true })],
    subcommands: [command('child')],
  });
  expect(parent.tryParse(['--secret', 'private', 'child', '--secret', 'private'])).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.InvalidValue, argumentName: 'secret', message: 'invalid value for \'--secret\'' },
  });
});

test('validates widened option definitions and leaves uniqueness opt-in', () => {
  expect(() => option('mode', modeParser, { unique: true } as never)).toThrow('unique requires a repeatable option');
  expect(() => option('mode', modeParser, { repeatable: true, unique: 'yes' } as never)).toThrow('\'unique\' must be a boolean');
  expect(() => positional('mode', modeParser, { repeatable: true, unique: true } as never)).toThrow('cannot configure unique');
  const repeated = command('tool', { args: [option('mode', modeParser, { repeatable: true, unique: false })] });
  expect(repeated.tryParse(['--mode', 'F', '--mode', 'fast'])).toMatchObject({
    type: 'value',
    value: { mode: ['fast', 'fast'] },
  });
});
