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
  type CommandGroupOptions,
  type Infer,
  type KeyValuePair,
  type ValueParser,
} from '../src';
import type {
  // @ts-expect-error internal shape types are not part of the application API
  AnyArgument,
  // @ts-expect-error builder classes are internal
  Argument,
  // @ts-expect-error runtime actions and definition plumbing are internal
  ArgumentAction,
  // @ts-expect-error internal shape types are not part of the application API
  ArgumentCardinality,
  // @ts-expect-error runtime actions and definition plumbing are internal
  ArgumentDefinition,
  // @ts-expect-error internal shape types are not part of the application API
  ArgumentPresence,
  // @ts-expect-error builder classes are internal
  Command,
  // @ts-expect-error runtime actions and definition plumbing are internal
  CommandDefinition,
  // @ts-expect-error internal group configuration is not part of the application API
  GroupOptions,
  // @ts-expect-error custom parsers are created through parsers.custom
  valueParser,
} from '../src';
import {
  getCommandDefinition,
  type CommandType,
} from '../src/command';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;
type _InternalExportsStayPrivate = [
  Argument,
  Command,
  ArgumentAction,
  ArgumentDefinition,
  CommandDefinition,
  GroupOptions,
  AnyArgument,
  ArgumentCardinality,
  ArgumentPresence,
  valueParser,
];

test('keeps the small factory surface exactly typed', () => {
  const percentage: ValueParser<number> = parsers.custom(
    'PERCENTAGE',
    (input) => Number(input),
  );
  const slug: ValueParser<string> = parsers.regex(/^[a-z-]+$/);
  const duration: ValueParser<number> = parsers.duration;
  const byteSize: ValueParser<number> = parsers.byteSize;
  const pair: ValueParser<KeyValuePair> = parsers.keyValue;
  const cli = command('build', {
    args: [
      option('percentage', percentage, { required: true }),
      option('slug', slug),
      option('timeout', duration),
      option('limit', byteSize),
      option('define', pair),
      option('mode', parsers.enum(['fast', 'safe']), { default: 'safe' }),
      positional('file'),
      flag('cache', { negated: true }),
      count('verbose'),
    ],
  });

  type Actual = Infer<typeof cli>;
  type Expected = {
    readonly percentage: number;
    readonly slug: string | undefined;
    readonly timeout: number | undefined;
    readonly limit: number | undefined;
    readonly define: KeyValuePair | undefined;
    readonly mode: 'fast' | 'safe';
    readonly file: string | undefined;
    readonly cache: boolean;
    readonly verbose: number;
  };
  const exact: Expect<Equal<Actual, Expected>> = true;
  const group: CommandGroupOptions<'format', 'mode' | 'file'> = {
    name: 'format',
    members: ['mode', 'file'],
  };
  expect(exact).toBe(true);
  expect(group.name).toBe('format');
});

test('hides runtime definitions and type carriers from factory values', () => {
  const argument = option('output');
  const cli = command('build', { args: [argument] });

  type ArgumentPlumbing = Extract<
    Extract<keyof typeof argument, string>,
    'definition' | `$${string}`
  >;
  type CommandPlumbing = Extract<
    Extract<keyof typeof cli, string>,
    'definition' | `$${string}`
  >;
  type ArgumentMutation = Extract<
    Extract<keyof typeof argument, string>,
    'required' | 'default' | 'repeatable' | 'short'
  >;
  type CommandMutation = Extract<
    Extract<keyof typeof cli, string>,
    'arg' | 'subcommand' | 'handler' | 'about'
  >;
  const argumentIsClean: Expect<Equal<ArgumentPlumbing, never>> = true;
  const commandIsClean: Expect<Equal<CommandPlumbing, never>> = true;
  const argumentIsTerminal: Expect<Equal<ArgumentMutation, never>> = true;
  const commandIsTerminal: Expect<Equal<CommandMutation, never>> = true;

  expect(argumentIsClean).toBe(true);
  expect(commandIsClean).toBe(true);
  expect(argumentIsTerminal).toBe(true);
  expect(commandIsTerminal).toBe(true);
  expect('definition' in argument).toBe(false);
  expect('definition' in cli).toBe(false);
  expect('required' in argument).toBe(false);
  expect('arg' in cli).toBe(false);
  expect(Reflect.ownKeys(argument)).toEqual([]);
  expect(Reflect.ownKeys(cli)).toEqual([
    'parse',
    'tryParse',
    'run',
    'renderHelp',
    'renderUsage',
  ]);

  void (() => {
    // @ts-expect-error internal runtime definitions are not public properties
    void argument.definition;
    // @ts-expect-error type-level argument carriers are inaccessible
    void argument.$output;
    // @ts-expect-error internal runtime definitions are not public properties
    void cli.definition;
    // @ts-expect-error type-level command carriers are inaccessible
    void cli.$fields;
  });
});

test('rejects objects that did not come from the command factory', () => {
  expect(() => getCommandDefinition({} as CommandType)).toThrow(
    'Expected a command created by command()',
  );
});

test('renders the configured long description', () => {
  expect(command('build', { longAbout: 'Detailed build help.' }).renderHelp())
    .toContain('Detailed build help.');
});
