import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  ArgumentAction,
  count,
  flag,
  getArgumentDefinition,
  option,
  positional,
  type AnyGlobalArgument,
} from '../src/argument';
import {
  command,
  type Infer,
} from '../src/command';
import {
  ErrorKind,
  type ParseOutcome,
} from '../src/error';

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

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;

describe('argument actions', () => {
  test('constructors keep their action-compatible defaults', () => {
    expect(getArgumentDefinition(option('value')).action).toBe(ArgumentAction.Set);
    expect(getArgumentDefinition(flag('enabled'))).toMatchObject({
      action: ArgumentAction.SetTrue,
      defaultValue: false,
      minValues: 0,
      maxValues: 0,
    });
    expect(getArgumentDefinition(count('verbose'))).toMatchObject({
      action: ArgumentAction.Count,
      defaultValue: 0,
      minValues: 0,
      maxValues: 0,
    });
  });

  test('infers action output types', () => {
    const cli = command('actions')
      .arg(option('tag').repeatable())
      .arg(flag('enabled'))
      .arg(flag('quiet').negated())
      .arg(count('verbose'));

    type Actual = Infer<typeof cli>;
    type Expected = {
      readonly tag: readonly string[];
      readonly enabled: boolean;
      readonly quiet: boolean;
      readonly verbose: number;
    };
    type _ActionsAreExact = Expect<Equal<Actual, Expected>>;
    const provesType: _ActionsAreExact = true;
    expect(provesType).toBe(true);
  });

  test('sets, appends, inverts, and counts', () => {
    const cli = command('actions')
      .arg(option('name'))
      .arg(option('tag').repeatable())
      .arg(flag('enabled'))
      .arg(flag('quiet').negated())
      .arg(count('verbose').short('v'));

    expect(parse(cli, [
      '--name',
      'demo',
      '--tag',
      'one',
      '--tag=two',
      '--enabled',
      '--quiet',
      '-vvv',
    ])).toEqual({
      name: 'demo',
      tag: ['one', 'two'],
      enabled: true,
      quiet: false,
      verbose: 3,
    });
    expect(parse(cli, [])).toEqual({
      name: undefined,
      tag: [],
      enabled: false,
      quiet: true,
      verbose: 0,
    });
    expect(cli.tryParse(['--name', 'one', '--name', 'two'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
  });
});

describe('optional value arity', () => {
  test('allows a zero-or-one value range without a fallback', () => {
    const color = option('color').numArgs({ min: 0, max: 1 });
    expect(getArgumentDefinition(color)).toMatchObject({
      minValues: 0,
      maxValues: 1,
      hasDefaultMissingValue: false,
    });

    const cli = command('paint')
      .arg(color)
      .arg(flag('force'));
    expect(parse(cli, [])).toEqual({ color: undefined, force: false });
    expect(parse(cli, ['--color'])).toEqual({ color: undefined, force: false });
    expect(parse(cli, ['--color', 'always'])).toEqual({
      color: 'always',
      force: false,
    });
    expect(parse(cli, ['--color', '--force'])).toEqual({
      color: undefined,
      force: true,
    });

    const requiredOccurrence = command('paint')
      .arg(option('color').numArgs({ min: 0, max: 1 }).required());
    type RequiredValue = Infer<typeof requiredOccurrence>['color'];
    type _ValueStaysOptional = Expect<Equal<RequiredValue, string | undefined>>;
    const provesType: _ValueStaysOptional = true;
    expect(provesType).toBe(true);
    expect(parse(requiredOccurrence, ['--color'])).toEqual({ color: undefined });
  });

  test('distinguishes optional values from default-missing values', () => {
    const color = option('color').defaultMissing('auto');
    expect(getArgumentDefinition(color)).toMatchObject({
      minValues: 0,
      maxValues: 1,
      defaultMissingValue: 'auto',
      hasDefaultMissingValue: true,
    });
  });
});

void (() => {
  const acceptsGlobal = <Global extends AnyGlobalArgument>(argument: Global): Global => argument;
  acceptsGlobal(option('profile').global());
  acceptsGlobal(option('profile').global().describe('Profile'));
  acceptsGlobal(option('profile').global().default('default'));
  // @ts-expect-error local arguments do not carry the global brand
  acceptsGlobal(option('profile'));
  // @ts-expect-error positionals cannot be negated switches
  positional('value').negated();
  // @ts-expect-error flags cannot be repeatable values
  flag('enabled').repeatable();
  // @ts-expect-error flags have factory-defined defaults
  flag('enabled').default(true);
});
