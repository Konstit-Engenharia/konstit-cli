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
  positional,
} from '../src';
import type {
  Infer,
  ParseOptions,
} from '../src';
import { getArgumentDefinition } from '../src/argument';
import { recordSuppliedArgument } from '../src/command/parsing/argument-state';
import {
  applyConditionalDefaults,
  type RelationState,
} from '../src/command/parsing/relations';
import type { CommandDefinition } from '../src/command/schema';
import type { ParseOutcome } from '../src/result/error';

type Equal<Left, Right> = (
  <Value>() => Value extends Left ? 1 : 2
) extends (
  <Value>() => Value extends Right ? 1 : 2
) ? true
  : false;
type Expect<Value extends true> = Value;

const repeatedDefaults = option('tags', parsers.string, {
  repeatable: true,
  defaultValues: ['base'],
});
const fixedDefaults = option('pair', parsers.string, {
  numArgs: 2,
  defaultValues: ['left', 'right'],
});
const typedDefaults = command('typed-defaults', {
  args: [repeatedDefaults, fixedDefaults],
});
type _RepeatedDefaultsAreCollections = Expect<
  Equal<Infer<typeof typedDefaults>['tags'], readonly string[]>
>;
type _FixedDefaultsAreTuples = Expect<
  Equal<Infer<typeof typedDefaults>['pair'], readonly [string, string]>
>;

const conditionalTyped = command('conditional-typed', {
  args: [
    option('mode', parsers.enum(['safe', 'fast'])),
    option('tags', parsers.string, { repeatable: true }),
  ],
  defaultIf: [{
    source: 'mode',
    equals: 'safe',
    target: 'tags',
    value: ['safe'],
  }],
});
type _ConditionalDefaultTargetIsTyped = Expect<
  Equal<Infer<typeof conditionalTyped>['tags'], readonly string[]>
>;

void (() => {
  // @ts-expect-error defaultValues requires a collection argument
  option('scalar', parsers.string, { defaultValues: ['value'] });
  // @ts-expect-error defaultValues cannot be combined with required
  option('required', parsers.string, { required: true, defaultValues: ['value'], repeatable: true });
  // @ts-expect-error defaultValues cannot be combined with default
  option('both', parsers.string, { default: 'value', defaultValues: ['value'], repeatable: true });
  // @ts-expect-error a scalar value count cannot have collection defaults
  option('optional-scalar', parsers.string, {
    numArgs: { min: 0, max: 1 },
    defaultValues: ['value'],
  });
  // @ts-expect-error default values must contain parser values
  option('wrong-value', parsers.integer, { repeatable: true, defaultValues: ['not-an-integer'] });
  command('invalid-relation', {
    args: [option('mode', parsers.string), option('output', parsers.string)],
    // @ts-expect-error conditional defaults must target a declared argument
    defaultIf: [{ source: 'mode', target: 'missing', value: 'value' }],
  });
});

function parse<Value>(
  configured: { parse(argv: readonly string[], options?: ParseOptions): ParseOutcome<Value>; },
  argv: readonly string[],
  options?: ParseOptions,
): Value {
  const outcome = configured.parse(argv, options);
  if (outcome.type !== 'value') {
    throw new Error(`Expected a value, got ${outcome.type}`);
  }
  return outcome.value;
}

describe('argument collection defaults', () => {
  test('uses immutable collection defaults and tracks their source', () => {
    const cli = command('collections', {
      args: [
        option('tags', parsers.string, {
          repeatable: true,
          defaultValues: ['one', 'two'],
        }),
        option('pair', parsers.string, {
          numArgs: 2,
          defaultValues: ['left', 'right'],
        }),
      ],
    });

    const parsed = parse(cli, []);
    expect(parsed).toEqual({ tags: ['one', 'two'], pair: ['left', 'right'] });
    expect(getValueSource(parsed, 'tags')).toBe('default');
    expect(getValueSource(parsed, 'pair')).toBe('default');
    expect(Object.isFrozen(parsed.tags)).toBe(true);
    expect(Object.isFrozen(parsed.pair)).toBe(true);

    const fromCli = parse(cli, ['--tags', 'cli']);
    expect(fromCli.tags).toEqual(['cli']);
    expect(fromCli.pair).toEqual(['left', 'right']);
    expect(getValueSource(fromCli, 'tags')).toBe('cli');
    expect(getValueSource(fromCli, 'pair')).toBe('default');
  });

  test('applies config and environment precedence over collection defaults', () => {
    const environmentName = 'KONSTIT_DEFAULT_VALUES';
    const previous = Bun.env[environmentName];
    Bun.env[environmentName] = 'environment';
    try {
      const cli = command('sources', {
        args: [
          option('tags', parsers.string, {
            repeatable: true,
            defaultValues: ['default'],
            env: environmentName,
          }),
        ],
      });
      const fromEnvironment = parse(cli, [], {
        config: { values: { tags: ['config'] } },
      });
      expect(fromEnvironment.tags).toEqual(['environment']);
      expect(getValueSource(fromEnvironment, 'tags')).toBe('env');

      delete Bun.env[environmentName];
      const fromConfig = parse(cli, [], {
        config: { values: { tags: ['config'] } },
      });
      expect(fromConfig.tags).toEqual(['config']);
      expect(getValueSource(fromConfig, 'tags')).toBe('config');
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('supports custom parsers that return arrays as scalar values', () => {
    const arrayParser = parsers.custom<readonly string[]>('LIST', (input) => [input]);
    const scalar = command('scalar-array', {
      args: [option('value', arrayParser, { default: ['default'] })],
    });
    expect(parse(scalar, [])).toEqual({ value: ['default'] });

    expect(() =>
      option('value', arrayParser, {
        defaultValues: [['default']],
      } as never)
    ).toThrow('defaultValues requires a collection argument');

    const conditional = command('conditional-array', {
      args: [
        option('mode', parsers.string),
        option('value', arrayParser),
      ],
      defaultIf: [{
        source: 'mode',
        equals: 'safe',
        target: 'value',
        value: ['safe'],
      }],
    });
    expect(parse(conditional, ['--mode', 'safe'])).toEqual({
      mode: 'safe',
      value: ['safe'],
    });
  });

  test('restores collection defaults when an override clears a target', () => {
    const cli = command('restore', {
      args: [
        flag('reset'),
        option('tags', parsers.string, {
          repeatable: true,
          defaultValues: ['default'],
        }),
      ],
      overrides: [['reset', 'tags']],
    });
    const parsed = parse(cli, ['--reset', '--tags', 'cli']);
    expect(parsed).toEqual({ reset: true, tags: ['default'] });
    expect(getValueSource(parsed, 'tags')).toBe('default');

    const scalar = command('restore-scalar', {
      args: [flag('reset'), option('value', parsers.string, { default: 'default' })],
      overrides: [['reset', 'value']],
    });
    expect(parse(scalar, ['--reset', '--value', 'cli'])).toEqual({
      reset: true,
      value: 'default',
    });
  });

  test('rejects invalid collection defaults and sparse arrays', () => {
    expect(() =>
      option('not-an-array', parsers.string, {
        repeatable: true,
        defaultValues: 'value',
      } as never)
    ).toThrow('defaultValues must be an array');
    expect(() =>
      option('both', parsers.string, {
        repeatable: true,
        default: 'value',
        defaultValues: ['value'],
      } as never)
    ).toThrow('both default and defaultValues');
    expect(() =>
      option('required', parsers.string, {
        repeatable: true,
        required: true,
        defaultValues: ['value'],
      } as never)
    ).toThrow('required and have default values');
    expect(() =>
      option('pair', parsers.string, {
        numArgs: 2,
        defaultValues: ['only'],
      })
    ).toThrow('does not satisfy its value count');
    expect(() =>
      option('pair', parsers.string, {
        numArgs: 2,
        defaultValues: ['one', 'two', 'three'],
      })
    ).toThrow('does not satisfy its value count');
    expect(() =>
      option('items', parsers.string, {
        repeatable: true,
        numArgs: 2,
        defaultValues: ['one'],
      })
    ).toThrow('complete occurrence');
    expect(() =>
      option('items', parsers.string, {
        repeatable: true,
        numArgs: 2,
        defaultValues: ['one', 'two', 'three'],
      })
    ).toThrow('complete occurrences');
    expect(() =>
      option('unbounded', parsers.string, {
        repeatable: true,
        numArgs: { min: 2 },
        defaultValues: ['one'],
      })
    ).toThrow('complete occurrence');
    const sparse = [] as string[];
    sparse.length = 1;
    expect(() =>
      option('items', parsers.string, {
        repeatable: true,
        defaultValues: sparse,
      })
    ).toThrow('sparse entries');
  });
});

describe('conditional defaults', () => {
  test('copies collection rule values when the command is built', () => {
    const values = ['derived'];
    const cli = command('copy-rule-values', {
      args: [
        option('mode', parsers.string),
        option('tags', parsers.string, { repeatable: true }),
      ],
      defaultIf: [{ source: 'mode', target: 'tags', value: values }],
    });
    values.push('mutated');

    expect(parse(cli, ['--mode', 'safe'])).toEqual({
      mode: 'safe',
      tags: ['derived'],
    });
  });

  test('matches values, presence, and first matching rules', () => {
    const cli = command('conditional', {
      args: [
        option('mode', parsers.string, { default: 'safe' }),
        option('output', parsers.string, { default: 'ordinary' }),
        option('tags', parsers.string, { repeatable: true }),
      ],
      defaultIf: [
        { source: 'mode', equals: 'safe', target: 'output', value: 'first' },
        { source: 'mode', equals: 'safe', target: 'output', value: 'second' },
        { source: 'mode', target: 'tags', value: ['explicit'] },
      ],
    });
    expect(parse(cli, [])).toEqual({
      mode: 'safe',
      output: 'first',
      tags: [],
    });
    expect(parse(cli, ['--mode', 'fast'])).toEqual({
      mode: 'fast',
      output: 'ordinary',
      tags: ['explicit'],
    });
    expect(parse(cli, ['--mode', 'fast', '--tags', 'cli'])).toEqual({
      mode: 'fast',
      output: 'ordinary',
      tags: ['cli'],
    });
  });

  test('resolves conditional-default chains and preserves explicit targets', () => {
    const cli = command('chain', {
      args: [
        option('mode', parsers.string),
        option('middle', parsers.string),
        option('output', parsers.string),
      ],
      defaultIf: [
        { source: 'middle', equals: 'derived', target: 'output', value: 'final' },
        { source: 'mode', equals: 'safe', target: 'middle', value: 'derived' },
      ],
    });
    expect(parse(cli, ['--mode', 'safe'])).toEqual({
      mode: 'safe',
      middle: 'derived',
      output: 'final',
    });
    expect(parse(cli, ['--mode', 'safe', '--output', 'explicit'])).toEqual({
      mode: 'safe',
      middle: 'derived',
      output: 'explicit',
    });
  });

  test('honors CLI, environment, config, and ordinary defaults for targets', () => {
    const environmentName = 'KONSTIT_CONDITIONAL_MODE';
    const previous = Bun.env[environmentName];
    const cli = command('precedence', {
      args: [
        option('mode', parsers.string, { default: 'safe' }),
        option('output', parsers.string, {
          env: 'KONSTIT_CONDITIONAL_OUTPUT',
          default: 'ordinary',
        }),
      ],
      defaultIf: [{
        source: 'mode',
        equals: 'safe',
        target: 'output',
        value: 'conditional',
      }],
    });
    try {
      Bun.env[environmentName] = 'safe';
      expect(parse(cli, [], { config: { values: { mode: 'config' } } }).output)
        .toBe('ordinary');

      Bun.env.KONSTIT_CONDITIONAL_OUTPUT = 'environment-output';
      expect(parse(cli, [], { config: { values: { mode: 'safe' } } }).output)
        .toBe('environment-output');
      delete Bun.env.KONSTIT_CONDITIONAL_OUTPUT;

      expect(parse(cli, ['--mode', 'safe', '--output', 'cli']).output)
        .toBe('cli');
      expect(parse(cli, [], { config: { values: { mode: 'safe', output: 'config' } } }).output)
        .toBe('config');
    } finally {
      delete Bun.env.KONSTIT_CONDITIONAL_OUTPUT;
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }
  });

  test('keeps conditional defaults separate from required presence', () => {
    const cli = command('required', {
      args: [
        flag('enabled'),
        option('output', parsers.string, { required: true }),
      ],
      defaultIf: [{ source: 'enabled', target: 'output', value: 'derived' }],
    });
    expect(cli.tryParse(['--enabled'])).toMatchObject({
      ok: false,
      error: { kind: 'missing-required-argument' },
    });
  });

  test('syncs conditional color defaults into run error output', async () => {
    const cli = command('conditional-color', {
      args: [
        option('mode', parsers.string),
        colorFlag('color'),
        option('output', parsers.string, { required: true }),
      ],
      defaultIf: [
        { source: 'mode', equals: 'always', target: 'color', value: true },
        { source: 'mode', equals: 'never', target: 'color', value: false },
      ],
    });
    const previousNoColor = Bun.env.NO_COLOR;
    delete Bun.env.NO_COLOR;
    try {
      const forcedColor: string[] = [];
      expect(
        await cli.run({
          argv: ['--mode', 'always'],
          color: false,
          stderr: (output) => forcedColor.push(output),
        }),
      ).toBe(2);
      expect(forcedColor[0]).toContain('\x1b[');

      const forcedPlain: string[] = [];
      expect(
        await cli.run({
          argv: ['--mode', 'never'],
          color: true,
          stderr: (output) => forcedPlain.push(output),
        }),
      ).toBe(2);
      expect(forcedPlain[0]).not.toContain('\x1b[');

      Bun.env.NO_COLOR = '1';
      const disabledColor: string[] = [];
      expect(
        await cli.run({
          argv: ['--mode', 'always'],
          color: true,
          stderr: (output) => disabledColor.push(output),
        }),
      ).toBe(2);
      expect(disabledColor[0]).not.toContain('\x1b[');
    } finally {
      if (previousNoColor === undefined) {
        delete Bun.env.NO_COLOR;
      } else {
        Bun.env.NO_COLOR = previousNoColor;
      }
    }
  });

  test('supports global arguments in a root conditional relation', () => {
    const cli = command('root', {
      args: [
        option('mode', parsers.string, { global: true }),
        option('output', parsers.string, { global: true }),
      ],
      defaultIf: [{ source: 'mode', target: 'output', value: 'derived' }],
      subcommands: [command('child', { args: [flag('run')] })],
    });
    expect(parse(cli, ['--mode', 'safe', 'child'])).toEqual({
      mode: 'safe',
      output: 'derived',
      subcommand: { name: 'child', args: { run: false } },
    });
  });

  test('rejects malformed rules, invalid targets, and dependency cycles', () => {
    const args = [option('mode', parsers.string), option('output', parsers.string)];
    expect(() =>
      command('missing-value', {
        args,
        defaultIf: [{ source: 'mode', target: 'output' } as never],
      })
    ).toThrow('must define a value');
    expect(() =>
      command('unknown-source', {
        args,
        defaultIf: [{ source: 'missing', target: 'output', value: 'value' } as never],
      })
    ).toThrow('references unknown argument');
    expect(() =>
      command('self', {
        args,
        defaultIf: [{ source: 'mode', target: 'mode', value: 'value' } as never],
      })
    ).toThrow('cannot target its source');
    expect(() =>
      command('cycle', {
        args: [
          option('first', parsers.string),
          option('second', parsers.string),
        ],
        defaultIf: [
          { source: 'first', equals: 'one', target: 'second', value: 'two' },
          { source: 'second', equals: 'two', target: 'first', value: 'one' },
        ],
      })
    ).toThrow('dependency cycle');

    expect(() =>
      command('collection-shape', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            numArgs: 2,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: 'value' } as never],
      })
    ).toThrow('collection value must be an array');
    expect(() =>
      command('collection-arity', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            numArgs: 2,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: ['one'] } as never],
      })
    ).toThrow('does not satisfy its value count');
    expect(() =>
      command('collection-arity-valid', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            numArgs: 2,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: ['one', 'two'] }],
      })
    ).not.toThrow();
    expect(() =>
      command('invalid-flag-value', {
        args: [option('mode', parsers.string), flag('enabled')],
        defaultIf: [{ source: 'mode', target: 'enabled', value: 'yes' } as never],
      })
    ).toThrow('flag value must be a boolean');
    expect(() =>
      command('invalid-count-value', {
        args: [option('mode', parsers.string), count('retries')],
        defaultIf: [{ source: 'mode', target: 'retries', value: 1.5 } as never],
      })
    ).toThrow('count value must be a non-negative safe integer');
    expect(() =>
      command('negative-count-value', {
        args: [option('mode', parsers.string), count('retries')],
        defaultIf: [{ source: 'mode', target: 'retries', value: -1 } as never],
      })
    ).toThrow('count value must be a non-negative safe integer');
    const sparse = [] as string[];
    sparse.length = 1;
    expect(() =>
      command('collection-sparse', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            repeatable: true,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: sparse }],
      })
    ).toThrow('sparse entries');
    expect(() =>
      command('repeatable-empty', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            repeatable: true,
            numArgs: 2,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: [] } as never],
      })
    ).not.toThrow();
    expect(() =>
      command('repeatable-short', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            repeatable: true,
            numArgs: 2,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: ['one'] } as never],
      })
    ).toThrow('complete occurrences');
    expect(() =>
      command('unbounded-repeatable-short', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            repeatable: true,
            numArgs: { min: 2 },
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: ['one'] } as never],
      })
    ).toThrow('complete occurrence');
    expect(() =>
      command('unbounded-repeatable-valid', {
        args: [
          option('mode', parsers.string),
          option('values', parsers.string, {
            repeatable: true,
            numArgs: { min: 2 },
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: ['one', 'two'] }],
      })
    ).not.toThrow();
    expect(() =>
      command('unbounded-short', {
        args: [
          option('mode', parsers.string),
          positional('values', parsers.string, {
            trailingVarArg: true,
            required: true,
          }),
        ],
        defaultIf: [{ source: 'mode', target: 'values', value: [] } as never],
      })
    ).toThrow('does not satisfy its value count');
    expect(() =>
      command('invalid-name-shape', {
        args,
        defaultIf: [{ source: 1, target: 'output', value: 'value' } as never],
      })
    ).toThrow('entries must contain argument names');
    expect(() =>
      command('unsupported', {
        args,
        defaultIf: [{ source: 'mode', target: 'output', value: 'value', extra: true } as never],
      })
    ).toThrow('unsupported field');

    const first = option('first', parsers.string);
    const second = option('second', parsers.string);
    const definition = {
      arguments: [getArgumentDefinition(first), getArgumentDefinition(second)],
      defaultIf: [
        { source: 'first', target: 'second', value: 'two', hasEquals: true, equals: 'one' },
        { source: 'second', target: 'first', value: 'one', hasEquals: true, equals: 'two' },
      ],
    } as unknown as CommandDefinition;
    expect(() =>
      applyConditionalDefaults(definition, {
        values: { first: 'one', second: undefined },
        argumentStates: new Map(),
      }, {})
    ).toThrow('dependency cycle');

    const color = colorFlag('color');
    const source = option('source', parsers.string);
    const colorDefinition = {
      arguments: [getArgumentDefinition(source), getArgumentDefinition(color)],
      defaultIf: [{
        source: 'source',
        target: 'color',
        value: true,
        hasEquals: false,
      }],
    } as unknown as CommandDefinition;
    const state: RelationState = {
      values: { source: 'value', color: true },
      argumentStates: new Map(),
      session: {},
    };
    recordSuppliedArgument(state, 'source', 'cli');
    applyConditionalDefaults(colorDefinition, state, { NO_COLOR: '1' });
    expect(state.values.color).toBe(false);
    expect(state.session?.colorMode).toBe('never');
  });
});
