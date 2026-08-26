import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  count,
  flag,
  option,
  parsers,
  positional,
  type Infer,
  type ValueParser,
} from '../src';
// @ts-expect-error builder classes are internal
import type {
  Argument,
  Command,
} from '../src';
// @ts-expect-error runtime actions and definition plumbing are internal
import type {
  ArgumentAction,
  ArgumentDefinition,
  CommandDefinition,
} from '../src';
// @ts-expect-error internal shape types are not part of the application API
import type {
  AnyArgument,
  ArgumentCardinality,
  ArgumentPresence,
} from '../src';
// @ts-expect-error custom parsers are created through parsers.custom
import type { valueParser } from '../src';
import {
  getCommandDefinition,
  type CommandType,
} from '../src/command';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;

test('keeps the small factory surface exactly typed', () => {
  const percentage: ValueParser<number> = parsers.custom(
    'PERCENTAGE',
    (input) => Number(input),
  );
  const cli = command('build')
    .arg(option('percentage', percentage).required())
    .arg(option('mode', parsers.enum(['fast', 'safe'])).default('safe'))
    .arg(positional('file'))
    .arg(flag('cache').negated())
    .arg(count('verbose'));

  type Actual = Infer<typeof cli>;
  type Expected = {
    readonly percentage: number;
    readonly mode: 'fast' | 'safe';
    readonly file: string | undefined;
    readonly cache: boolean;
    readonly verbose: number;
  };
  const exact: Expect<Equal<Actual, Expected>> = true;
  expect(exact).toBe(true);
});

test('hides runtime definitions and type carriers from factory values', () => {
  const argument = option('output');
  const cli = command('build').arg(argument);

  type ArgumentPlumbing = Extract<
    Extract<keyof typeof argument, string>,
    'definition' | `$${string}`
  >;
  type CommandPlumbing = Extract<
    Extract<keyof typeof cli, string>,
    'definition' | `$${string}`
  >;
  const argumentIsClean: Expect<Equal<ArgumentPlumbing, never>> = true;
  const commandIsClean: Expect<Equal<CommandPlumbing, never>> = true;

  expect(argumentIsClean).toBe(true);
  expect(commandIsClean).toBe(true);
  expect('definition' in argument).toBe(false);
  expect('definition' in cli).toBe(false);
  expect(Reflect.ownKeys(argument)).toEqual([]);
  expect(Reflect.ownKeys(cli)).toEqual([]);

  if (false) {
    // @ts-expect-error internal runtime definitions are not public properties
    argument.definition;
    // @ts-expect-error type-level argument carriers are inaccessible
    argument.$output;
    // @ts-expect-error internal runtime definitions are not public properties
    cli.definition;
    // @ts-expect-error type-level command carriers are inaccessible
    cli.$fields;
  }
});

test('rejects objects that did not come from the command factory', () => {
  expect(() => getCommandDefinition({} as CommandType)).toThrow(
    'Expected a command created by command()',
  );
});

test('renders the configured long description', () => {
  expect(command('build').longAbout('Detailed build help.').renderHelp()).toContain(
    'Detailed build help.',
  );
});
