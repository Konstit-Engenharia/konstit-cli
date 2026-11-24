import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  flag,
  option,
  parsers,
  positional,
  type HandledCommand,
} from '../src';
import { getArgumentDefinition } from '../src/argument';
import { getCommandDefinition } from '../src/command';
import { validateArgument } from '../src/command/validation/definition';

const runtimeCommand = command as unknown as (
  name: unknown,
  options?: unknown,
) => HandledCommand;

function changingOption(
  key: string,
  valid: unknown,
  invalid: unknown,
  invalidRead: number,
): object {
  let reads = 0;
  const options: Record<string, unknown> = {
    args: [flag('one'), flag('two')],
  };
  Object.defineProperty(options, key, {
    enumerable: true,
    get() {
      reads += 1;
      return reads === invalidRead ? invalid : valid;
    },
  });
  return options;
}

function optionWithoutLong(short?: string) {
  let reads = 0;
  return option('value', parsers.string, {
    required: true,
    ...(short === undefined ? {} : { short }),
    get long() {
      reads += 1;
      return reads === 2 || reads === 3 ? 'temporary' : undefined;
    },
  } as never);
}

describe('modular command coverage', () => {
  test('validates every widened command configuration shape', () => {
    const one = flag('one');
    const two = flag('two');
    const args = [one, two];
    const cases: readonly [unknown, string][] = [
      [null, 'Command configuration must be an object'],
      [{ unsupported: true }, 'unsupported field \'unsupported\''],
      [{ version: 1 }, 'option \'version\' must be a string'],
      [{ inferSubcommands: 'yes' }, 'option \'inferSubcommands\' must be a boolean'],
      [{ aliases: {} }, 'option \'aliases\' must be an array'],
      [{ exclusive: [] }, 'must contain at least 1 value'],
      [{ aliases: [1] }, 'must contain only argument names'],
      [{ requires: [['one']] }, 'must contain exactly 2 values'],
      [{ requires: [[1, 'one']] }, 'entries must contain argument names'],
      [{ requiresIf: [[1, true, 'one']] }, 'entries must contain argument names'],
      [{ requiresValue: [['one', 'two']] }, 'must contain exactly 3 values'],
      [{ requiresValue: [['one', false, 'value']] }, 'entries must contain argument names'],
      [{ args, requiresValue: [['one', 'unknown', true]] }, 'references unknown argument \'unknown\''],
      [{ args, requiresValue: [['one', 'one', true]] }, 'cannot target its source argument \'one\''],
      [{ requiredIfAny: [{ conditions: [], target: 'two' }] }, 'must contain a condition'],
      [{ requiredIfAny: [{ conditions: [[1, true]], target: 'two' }] }, 'must start with an argument name'],
      [{ requiredIfAny: [{ conditions: [['one', true]], target: 1 }] }, 'target must be an argument name'],
      [{ requiredUnlessPresent: [{ alternatives: ['one'], target: 1 }] }, 'target must be an argument name'],
      [{ groups: [{ name: 1, members: ['one'] }] }, 'group name must be a string'],
      [{ groups: [{ name: 'group', members: ['one'], required: 'yes' }] }, 'required must be a boolean'],
      [{ groups: [{ name: 'group', members: ['one'], multiple: 'yes' }] }, 'multiple must be a boolean'],
      [{ handler: true }, 'option \'handler\' must be a function'],
      [{ args, requires: [['one', 'one']] }, 'cannot target its source argument \'one\''],
      [{ args, conflicts: [['one', 'two', 'two']] }, 'cannot contain duplicate arguments'],
    ];

    for (const [options, message,] of cases) {
      expect(() => runtimeCommand('tool', options)).toThrow(message);
    }
    expect(() => runtimeCommand('invalid name')).toThrow('Invalid command name');
  });

  test('retains defensive relation checks when option getters change', () => {
    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'requiredUnlessPresent',
          [{ alternatives: ['one'], target: 'two' }],
          [{ alternatives: ['one', 'one'], target: 'two' }],
          4,
        ),
      )
    ).toThrow('required-unless list cannot contain duplicate arguments');

    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'requiredUnlessAll',
          [{ alternatives: ['one'], target: 'two' }],
          [{ alternatives: ['one', 'one'], target: 'two' }],
          4,
        ),
      )
    ).toThrow('required-unless-all list cannot contain duplicate arguments');

    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'conflicts',
          [['one', 'two']],
          [['one', 'two', 'two']],
          4,
        ),
      )
    ).toThrow('conflict list cannot contain duplicate arguments');

    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'exclusive',
          ['one'],
          ['one', 'one'],
          7,
        ),
      )
    ).toThrow('exclusive argument cannot be registered more than once');

    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'groups',
          [{ name: 'group', members: ['one'] }],
          [{ name: 'group', members: [] }],
          4,
        ),
      )
    ).toThrow('group \'group\' must contain a member');

    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'groups',
          [{ name: 'group', members: ['one'] }],
          [{ name: 'group', members: ['one', 'one'] }],
          4,
        ),
      )
    ).toThrow('group \'group\' has duplicate members');
  });

  test('rejects a group name that changes before its relation is applied', () => {
    let groupReads = 0;
    const shiftingGroup = {
      get name() {
        groupReads += 1;
        return groupReads === 1 ? 'known' : 'missing';
      },
      members: ['one'],
      requires: ['two'],
    };
    expect(() =>
      runtimeCommand(
        'tool',
        changingOption(
          'groups',
          [{ name: 'known', members: ['one'] }],
          [shiftingGroup],
          4,
        ),
      )
    ).toThrow('Unknown argument group: missing');
  });

  test('renders short-only, fallback, zero-width, unbounded, trailing, and default values', () => {
    const shortOnly = command('short', { args: [optionWithoutLong('x')] });
    expect(shortOnly.renderUsage()).toContain('-x <STRING>');

    const fallback = command('fallback', { args: [optionWithoutLong()] });
    expect(fallback.renderUsage()).toContain('value <STRING>');

    const help = command('help-shapes', {
      args: [
        option('zero', parsers.string, { numArgs: 0 }),
        option('optional-many', parsers.string, { numArgs: { min: 0 } }),
        option('required-many', parsers.string, { numArgs: { min: 2 } }),
        option('mode', parsers.string, { default: 'safe' }),
        positional('tail', parsers.string, { trailingVarArg: true }),
      ],
    }).renderHelp();
    expect(help).toContain('--zero');
    expect(help).toContain('[<STRING>...]');
    expect(help).toContain('<STRING> <STRING>...');
    expect(help).toContain('[TAIL]...');
    expect(help).toContain('[default: safe]');
  });

  test('sanitizes carriage returns and tabs in public parse errors', () => {
    const result = command('safe').tryParse(['--bad\r\tvalue']);
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.message).toContain('\\r\\t');
    }
  });

  test('rejects named trailing arguments created through a widened option proxy', () => {
    let descriptorReads = 0;
    const widened = new Proxy({ trailingVarArg: true }, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'trailingVarArg') {
          descriptorReads += 1;
          if (descriptorReads === 3) {
            return undefined;
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });
    const trailing = option('trailing', parsers.string, widened as never);
    expect(() => command('tool', { args: [trailing] }))
      .toThrow('Named argument \'trailing\' cannot be trailing');
  });

  test('retains the internal guard against option names on positionals', () => {
    const definition = getCommandDefinition(command('tool'));
    const invalid = {
      ...getArgumentDefinition(positional('value', parsers.string)),
      short: 'v',
    };
    expect(() => validateArgument(definition, invalid))
      .toThrow('Positional \'value\' cannot have option names');

    const invalidGlobal = {
      ...getArgumentDefinition(positional('global', parsers.string)),
      global: true,
    };
    expect(() => validateArgument(definition, invalidGlobal))
      .toThrow('Positional \'global\' cannot be global');
  });

  test('handles explicit runner color and invalid parser-owned subcommand data', async () => {
    const output: string[] = [];
    const colorful = command('colorful', { args: [colorFlag('color')] });
    expect(
      await colorful.run({
        argv: ['--help'],
        color: true,
        stdout: (value) => output.push(value),
      }),
    ).toBe(0);
    expect(output).toHaveLength(1);

    const invalidSubcommand = command('root', {
      args: [option(
        'subcommand',
        parsers.custom('SUBCOMMAND', () => ({
          name: 'missing',
          args: {},
        })),
        { required: true },
      )],
      handler: () => 0,
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(invalidSubcommand.run(['--subcommand', 'value']))
      .rejects.toThrow('unknown subcommand \'missing\'');
  });

  test('rejects a local argument passed through a widened handler context', async () => {
    const local = flag('local');
    const cli = command('tool', {
      args: [local],
      handler: (_args, context) => {
        context.global(local as never);
      },
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(cli.run([])).rejects.toThrow('Argument \'local\' is not global');
  });
});
