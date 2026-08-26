import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  count,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import {
  getArgumentDefinition,
  type ArgumentType,
} from '../src/argument';

describe('built-in value parsers', () => {
  test('parses every supported scalar form', () => {
    expect(parsers.string.parse('text')).toBe('text');
    expect(parsers.integer.parse('+42')).toBe(42);
    expect(parsers.float.parse('1.5')).toBe(1.5);
    expect(parsers.bigint.parse('9007199254740993')).toBe(9007199254740993n);

    for (const input of ['1', 'true', 'yes', 'on']) {
      expect(parsers.boolean.parse(input)).toBe(true);
    }
    for (const input of ['0', 'false', 'no', 'off']) {
      expect(parsers.boolean.parse(input)).toBe(false);
    }

    expect(parsers.url.parse('https://example.com/path').hostname).toBe(
      'example.com',
    );
    expect(parsers.date.parse('2026-08-23').toISOString()).toBe(
      '2026-08-23T00:00:00.000Z',
    );
  });

  test('reports invalid scalar values', () => {
    expect(() => parsers.integer.parse('4.2')).toThrow('expected an integer');
    expect(() => parsers.integer.parse('9007199254740992')).toThrow(
      'integer is outside the safe range',
    );
    expect(() => parsers.float.parse('   ')).toThrow('expected a number');
    expect(() => parsers.float.parse('Infinity')).toThrow(
      'expected a finite number',
    );
    expect(() => parsers.bigint.parse('1.5')).toThrow('expected an integer');
    for (const input of ['', '   ', '0x10', '1e3']) {
      expect(() => parsers.bigint.parse(input)).toThrow('expected an integer');
    }
    expect(() => parsers.boolean.parse('sometimes')).toThrow(
      'expected true or false',
    );
    expect(() => parsers.url.parse('not a URL')).toThrow(
      'expected a valid URL',
    );
    expect(() => parsers.date.parse('not a date')).toThrow(
      'expected a valid date',
    );
  });

  test('parses JSON with and without a type guard', () => {
    expect(parsers.json().parse('{"name":"Ada"}')).toEqual({ name: 'Ada' });
    expect(() => parsers.json().parse('{'))
      .toThrow('expected valid JSON');

    const objectWithName = parsers.json(
      (value): value is { readonly name: string; } =>
        typeof value === 'object'
        && value !== null
        && 'name' in value
        && typeof value.name === 'string',
    );
    expect(objectWithName.parse('{"name":"Grace"}')).toEqual({
      name: 'Grace',
    });
    expect(() => objectWithName.parse('{"name":1}')).toThrow(
      'JSON value has an invalid shape',
    );
  });

  test('parses enums, custom values, and bounded numbers', () => {
    const color = parsers.enum(['red', 'green']);
    expect(color.parse('green')).toBe('green');
    expect(() => color.parse('blue')).toThrow('expected one of: red, green');

    const doubled = parsers.custom('DOUBLED', (input) => Number(input) * 2, {
      completions: ['2', '4'],
      completionHint: 'file',
    });
    expect(doubled.parse('3')).toBe(6);
    expect(doubled.completions).toEqual(['2', '4']);
    expect(doubled.completionHint).toBe('file');

    const percentage = parsers.range(0, 100);
    expect(percentage.parse('12.5')).toBe(12.5);
    expect(() => percentage.parse('-1')).toThrow(
      'expected a number from 0 to 100',
    );
    expect(() => percentage.parse('101')).toThrow(
      'expected a number from 0 to 100',
    );
  });

  test('rejects invalid range definitions', () => {
    expect(() => parsers.range(Number.NaN, 1)).toThrow(RangeError);
    expect(() => parsers.range(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => parsers.range(2, 1)).toThrow(
      'A parser range must have finite, ascending bounds',
    );
  });

  test('creates immutable parser metadata', () => {
    const parser = parsers.custom('CHOICE', (input) => input.length, {
      completions: ['short', 'long'],
      completionHint: 'directory',
    });
    expect(parser.parse('value')).toBe(5);
    expect(parser).toMatchObject({
      label: 'CHOICE',
      completions: ['short', 'long'],
      completionHint: 'directory',
    });
    expect(Object.isFrozen(parser)).toBe(true);
    expect(Object.isFrozen(parser.completions)).toBe(true);
  });
});

describe('argument builder aliases and metadata', () => {
  test('applies factory configuration without changing parser ownership', () => {
    const colorParser = parsers.enum(['auto', 'always', 'never']);
    const completion = () => ['auto'];
    const withDefault = option('color', colorParser, {
      global: true,
      default: 'auto',
      short: 'c',
      describe: 'Color mode',
      valueName: 'WHEN',
      valueHint: 'file',
      complete: completion,
      env: 'COLOR_MODE',
      hide: false,
    });
    const withoutDefault = option('fallback', colorParser);
    const verbose = count('verbose', {
      global: true,
      short: 'v',
      long: 'verbosity',
      aliases: ['details'],
      describe: 'Verbosity',
    });

    expect(getArgumentDefinition(withDefault)).toMatchObject({
      parser: colorParser,
      presence: 'default',
      defaultValue: 'auto',
      short: 'c',
      help: 'Color mode',
      valueName: 'WHEN',
      completionHint: 'file',
      completion,
      env: 'COLOR_MODE',
      hidden: false,
      global: true,
    });
    expect(getArgumentDefinition(withoutDefault)).toMatchObject({
      parser: colorParser,
      presence: 'optional',
      global: false,
    });
    expect(getArgumentDefinition(verbose)).toMatchObject({
      short: 'v',
      long: 'verbosity',
      aliases: ['details'],
      help: 'Verbosity',
      global: true,
    });
    expect(getArgumentDefinition(positional('input', parsers.string, {
      required: true,
      valueName: 'SOURCE',
    }))).toMatchObject({
      presence: 'required',
      valueName: 'SOURCE',
    });
    expect(getArgumentDefinition(flag('quiet', { global: true, negated: true }))).toMatchObject({
      action: 'setFalse',
      defaultValue: true,
      global: true,
    });
  });

  test('validates conflicting factory presence and global positionals', () => {
    const conflicting = {
      required: true,
      default: 'safe',
    } as never;
    expect(() => option('mode', parsers.string, conflicting)).toThrow(
      'cannot be required and have a default',
    );
    expect(() => positional('path', parsers.string, { global: true } as never)).toThrow(
      'Positional arguments cannot be global',
    );
  });

  test('sets an explicit long name and positional value label', () => {
    const output = option('output').long('destination');
    const input = positional('input').valueName('SOURCE');

    expect(getArgumentDefinition(output).long).toBe('destination');
    expect(getArgumentDefinition(input).valueName).toBe('SOURCE');
  });

  test('restores optional behavior after requiring an argument', () => {
    const input = option('input').required().optional();
    expect(getArgumentDefinition(input)).toMatchObject({
      presence: 'optional',
      defaultValue: undefined,
    });
  });

  test('rejects optional scalar behavior on a repeatable argument', () => {
    const values = option('value').repeatable() as unknown as {
      optional(): unknown;
    };
    expect(() => values.optional()).toThrow(
      'A repeatable argument always defaults to an empty array',
    );
  });

  test('sets a default value', () => {
    const mode = option('mode').default('safe');
    expect(getArgumentDefinition(mode)).toMatchObject({
      presence: 'default',
      defaultValue: 'safe',
    });
  });

  test('rejects invalid builder definitions at runtime', () => {
    expect(() => getArgumentDefinition({} as ArgumentType)).toThrow(
      'Expected an argument created by option(), positional(), flag(), or count()',
    );

    const unsafeShort = flag('verbose') as unknown as {
      short(value: string): unknown;
    };
    expect(() => unsafeShort.short('vv')).toThrow(
      'A short option must be one character',
    );
    expect(() => option('pair').default('x').numArgs(2)).toThrow(
      'A multi-value argument cannot have a scalar default',
    );
    expect(() => option('value').valueDelimiter('::')).toThrow(
      'A value delimiter must be one character',
    );
    expect(() => option('value').valueTerminator('')).toThrow(
      'A value terminator cannot be empty',
    );
    expect(() => positional('value').default('x').trailingVarArg()).toThrow(
      'A trailing argument cannot have a scalar default',
    );

    const repeated = option('value').repeatable() as unknown as {
      default(value: string): unknown;
    };
    expect(() => repeated.default('x')).toThrow(
      'A repeatable argument cannot have a scalar default',
    );
    const unsafeFlag = flag('enabled') as unknown as {
      repeatable(): unknown;
    };
    expect(() => unsafeFlag.repeatable()).toThrow(
      'Flags and counters cannot be repeatable values',
    );
    const unsafeCount = count('verbose') as unknown as {
      repeatable(): unknown;
    };
    expect(() => unsafeCount.repeatable()).toThrow(
      'Flags and counters cannot be repeatable values',
    );

    expect(() => option('value').env('')).toThrow(
      'An environment variable name cannot be empty',
    );
    expect(() => option('not valid')).toThrow('Invalid argument name');
    expect(() => option('value').long('--invalid')).toThrow(
      'Invalid argument name',
    );
    expect(() => option('value').numArgs(-1)).toThrow(
      'The minimum value count must be a non-negative integer',
    );
    expect(() => option('value').numArgs({ min: 2, max: 1 })).toThrow(
      'The maximum value count must be an integer at least equal to min',
    );
  });
});
