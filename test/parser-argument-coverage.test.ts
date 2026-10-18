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

  test('parses durations as integer milliseconds', () => {
    expect(parsers.duration.parse('500ms')).toBe(500);
    expect(parsers.duration.parse('1.001s')).toBe(1_001);
    expect(parsers.duration.parse('1.5m')).toBe(90_000);
    expect(parsers.duration.parse('2h')).toBe(7_200_000);
    expect(parsers.duration.parse('1d')).toBe(86_400_000);

    for (
      const input of [
        '1',
        '-1s',
        '1 s',
        '1w',
        '1toString',
        '1constructor',
        '1valueOf',
        '0.5ms',
        '9007199254740992ms',
      ]
    ) {
      expect(() => parsers.duration.parse(input)).toThrow(
        'expected a duration',
      );
    }
  });

  test('parses SI and IEC byte sizes as integer bytes', () => {
    expect(parsers.byteSize.parse('512B')).toBe(512);
    expect(parsers.byteSize.parse('1.5KB')).toBe(1_500);
    expect(parsers.byteSize.parse('2MB')).toBe(2_000_000);
    expect(parsers.byteSize.parse('4MiB')).toBe(4_194_304);
    expect(parsers.byteSize.parse('1TiB')).toBe(1_099_511_627_776);

    for (
      const input of [
        '1',
        '-1KB',
        '1 KB',
        '1kb',
        '1toString',
        '1constructor',
        '1valueOf',
        '0.5B',
        '9007199254740992B',
      ]
    ) {
      expect(() => parsers.byteSize.parse(input)).toThrow(
        'expected a byte size',
      );
    }
  });

  test('parses key/value pairs at the first equals sign', () => {
    const pair = parsers.keyValue.parse('TOKEN=a=b');
    expect(pair).toEqual({ key: 'TOKEN', value: 'a=b' });
    expect(Object.isFrozen(pair)).toBe(true);
    expect(parsers.keyValue.parse('EMPTY=')).toEqual({
      key: 'EMPTY',
      value: '',
    });
    expect(() => parsers.keyValue.parse('missing')).toThrow(
      'expected KEY=VALUE with a non-empty key',
    );
    expect(() => parsers.keyValue.parse('=value')).toThrow(
      'expected KEY=VALUE with a non-empty key',
    );
  });

  test('validates schedulable Bun cron expressions', () => {
    const weekdayMorning = '30 9 * * MON-FRI';
    expect(parsers.cron.parse(weekdayMorning)).toBe(weekdayMorning);
    expect(parsers.cron.parse('@daily')).toBe('@daily');
    expect(parsers.cron.label).toBe('CRON');
    expect(() => parsers.cron.parse('0 0 * * * *')).toThrow(
      'expected a schedulable Bun cron expression',
    );
    expect(() => parsers.cron.parse('0 0 30 2 *')).toThrow(
      'expected a schedulable Bun cron expression',
    );
  });

  test('validates CSS colors without normalizing their text', () => {
    for (
      const input of [
        'red',
        '#ff6600',
        'rgb(255 102 0 / 50%)',
        'hsl(24 100% 50%)',
        'lab(60% 40 60)',
        'oklch(65% 0.2 30)',
      ]
    ) {
      expect(parsers.color.parse(input)).toBe(input);
    }
    expect(parsers.color.label).toBe('COLOR');
    for (const input of ['not-a-color', 'var(--brand)', '16711680']) {
      expect(() => parsers.color.parse(input)).toThrow(
        'expected a valid CSS color',
      );
    }
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

  test('validates strings with regular expressions', () => {
    const slug = parsers.regex(/^[a-z][a-z0-9-]*$/);
    expect(slug.parse('release-1')).toBe('release-1');
    expect(slug.label).toBe('/^[a-z][a-z0-9-]*$/');
    expect(() => slug.parse('Release 1')).toThrow(
      'expected value matching /^[a-z][a-z0-9-]*$/',
    );

    const global = parsers.regex(/^value$/g);
    expect(global.parse('value')).toBe('value');
    expect(global.parse('value')).toBe('value');

    expect(() => parsers.regex('value' as never)).toThrow(
      'A regex parser requires a RegExp',
    );
  });

  test('rejects invalid range definitions', () => {
    expect(() => parsers.range(Number.NaN, 1)).toThrow(RangeError);
    expect(() => parsers.range(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => parsers.range(2, 1)).toThrow(
      'A parser range must have finite, ascending bounds',
    );
  });

  test('validates parser factory inputs at construction', () => {
    expect(() => parsers.enum([] as never)).toThrow(
      'non-empty array of strings',
    );
    expect(() => parsers.enum(['ok', 1] as never)).toThrow(
      'non-empty array of strings',
    );
    const sparseValues: string[] = [];
    sparseValues.length = 1;
    expect(() => parsers.enum(sparseValues as never)).toThrow(
      'non-empty array of strings',
    );
    expect(() => parsers.custom('VALUE', (input) => input, { completions: sparseValues }))
      .toThrow('Value parser completions must be an array of strings');
    expect(() => parsers.json(1 as never)).toThrow(
      'JSON parser guard must be a function',
    );
    expect(() => parsers.custom(1 as never, (input) => input)).toThrow(
      'value parser label must be a string',
    );
    expect(() => parsers.custom('VALUE', 1 as never)).toThrow(
      'value parser parse field must be a function',
    );
    expect(() => parsers.custom('VALUE', (input) => input, null as never)).toThrow(
      'Value parser options must be an object',
    );
    expect(() =>
      parsers.custom('VALUE', (input) => input, {
        completions: [1],
      } as never)
    ).toThrow('Value parser completions must be an array of strings');
    expect(() =>
      parsers.custom('VALUE', (input) => input, {
        completionHint: 'socket',
      } as never)
    ).toThrow('completion hint must be \'file\' or \'directory\'');
    expect(() => parsers.map({ label: 1, parse: () => 'value' } as never, () => 'value'))
      .toThrow('value parser label must be a string');
    expect(() => parsers.map({ label: 'VALUE', parse: 1 } as never, () => 'value'))
      .toThrow('value parser parse field must be a function');
    expect(() => parsers.map(null as never, () => 'value')).toThrow(
      'A value parser must be an object',
    );
    expect(() => parsers.map(parsers.string, null as never)).toThrow(
      'map parser transform must be a function',
    );
    expect(() => parsers.refine(parsers.string, null as never)).toThrow(
      'refine parser predicate must be a function',
    );
    expect(() => parsers.refine(parsers.string, () => true, 1 as never)).toThrow(
      'refine parser message must be a string',
    );
    expect(() => parsers.range(0, 1, 1 as never)).toThrow(
      'Range parser options must be an object',
    );
    expect(() => parsers.range(0, 1, { integer: 1 } as never)).toThrow(
      'Range parser option \'integer\' must be a boolean',
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

describe('argument configuration and metadata', () => {
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
    const parsedPositional = positional('port', parsers.integer);
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
    expect(getArgumentDefinition(parsedPositional)).toMatchObject({
      parser: parsers.integer,
      presence: 'optional',
    });
    expect(getArgumentDefinition(option('optional-default', parsers.string, {
      default: 'value',
      numArgs: { min: 0, max: 1 },
    }))).toMatchObject({
      defaultValue: 'value',
      minValues: 0,
      maxValues: 1,
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

  test('validates conflicting declarative argument configurations', () => {
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
    expect(() =>
      option(
        'trailing-option',
        parsers.string,
        { trailingVarArg: true } as never,
      )
    ).toThrow('Options cannot be trailing positional arguments');
    expect(() =>
      positional(
        'missing-positional',
        parsers.string,
        { defaultMissing: 'value' } as never,
      )
    ).toThrow('Positional arguments cannot configure defaultMissing');
    expect(() =>
      positional(
        'equals-positional',
        parsers.string,
        { requireEquals: true } as never,
      )
    ).toThrow('Positional arguments cannot require equals-form values');
    expect(() =>
      option(
        'repeatable-default',
        parsers.string,
        { repeatable: true, default: 'value' } as never,
      )
    ).toThrow('A repeatable argument cannot have a scalar default');
    expect(() =>
      positional(
        'trailing-default',
        parsers.string,
        { trailingVarArg: true, default: 'value' } as never,
      )
    ).toThrow('A trailing argument cannot have a scalar default');
    expect(() =>
      option(
        'multi-default',
        parsers.string,
        { numArgs: 2, default: 'value' } as never,
      )
    ).toThrow('A multi-value argument cannot have a scalar default');
    expect(() =>
      option(
        'ranged-default',
        parsers.string,
        { numArgs: { min: 1, max: 2 }, default: 'value' } as never,
      )
    ).toThrow('A multi-value argument cannot have a scalar default');
    expect(() =>
      option(
        'missing-count',
        parsers.string,
        { defaultMissing: 'value', numArgs: 1 } as never,
      )
    ).toThrow('defaultMissing cannot be combined with numArgs');
    expect(() => flag('verbose', { repeatable: true } as never)).toThrow(
      'flag arguments cannot configure repeatable',
    );
    expect(() => count('verbose', { numArgs: 2 } as never)).toThrow(
      'count arguments cannot configure numArgs',
    );
    expect(() =>
      positional(
        'named-positional',
        parsers.string,
        { required: true, short: 'p' } as never,
      )
    ).toThrow('positional arguments cannot configure short');
    expect(() =>
      option(
        'negated-option',
        parsers.string,
        { required: true, negated: true } as never,
      )
    ).toThrow('option arguments cannot configure negated');
    expect(() =>
      positional(
        'repeatable-trailing',
        parsers.string,
        { trailingVarArg: true, repeatable: true } as never,
      )
    ).toThrow('A trailing argument cannot be repeatable');
    expect(() =>
      positional(
        'counted-trailing',
        parsers.string,
        { trailingVarArg: true, numArgs: 2 } as never,
      )
    ).toThrow('A trailing argument cannot configure numArgs');
    expect(() =>
      positional(
        'strict-trailing',
        parsers.string,
        { trailingVarArg: true, allowHyphenValues: false } as never,
      )
    ).toThrow('A trailing argument must allow hyphen values');
  });

  test('sets an explicit long name and positional value label', () => {
    const output = option('output', parsers.string, { long: 'destination' });
    const input = positional('input', parsers.string, { valueName: 'SOURCE' });

    expect(getArgumentDefinition(output).long).toBe('destination');
    expect(getArgumentDefinition(input).valueName).toBe('SOURCE');
  });

  test('uses optional behavior unless required or defaulted', () => {
    const input = option('input');
    const definition = getArgumentDefinition(input);
    expect(definition.presence).toBe('optional');
    expect(definition.defaultValue).toBeUndefined();
  });

  test('does not expose fluent methods on configured arguments', () => {
    for (
      const argument of [
        option('value'),
        positional('input'),
        flag('enabled'),
        count('verbose'),
      ]
    ) {
      expect(Reflect.ownKeys(argument)).toEqual([]);
      expect('required' in argument).toBe(false);
      expect('short' in argument).toBe(false);
      expect('hide' in argument).toBe(false);
      expect(Object.isFrozen(argument)).toBe(true);
    }
  });

  test('sets a default value', () => {
    const mode = option('mode', parsers.string, { default: 'safe' });
    expect(getArgumentDefinition(mode)).toMatchObject({
      presence: 'default',
      defaultValue: 'safe',
    });
  });

  test('rejects invalid declarative definitions at runtime', () => {
    expect(() => getArgumentDefinition({} as ArgumentType)).toThrow(
      'Expected an argument created by option(), positional(), flag(), colorFlag(), or count()',
    );

    expect(() => flag('verbose', { short: 'vv' } as never)).toThrow(
      'one UTF-16 character',
    );
    expect(() =>
      option('pair', parsers.string, {
        default: 'x',
        numArgs: 2,
      } as never)
    ).toThrow(
      'A multi-value argument cannot have a scalar default',
    );
    expect(() => option('value', parsers.string, { valueDelimiter: '::' } as never)).toThrow(
      'A value delimiter must be one character',
    );
    expect(() => option('value', parsers.string, { valueTerminator: '' } as never)).toThrow(
      'A value terminator cannot be empty',
    );
    expect(() =>
      positional('value', parsers.string, {
        default: 'x',
        trailingVarArg: true,
      } as never)
    ).toThrow(
      'A trailing argument cannot have a scalar default',
    );

    expect(() =>
      option('value', parsers.string, {
        default: 'x',
        repeatable: true,
      } as never)
    ).toThrow(
      'A repeatable argument cannot have a scalar default',
    );

    expect(() => option('value', parsers.string, { env: '' })).toThrow(
      'An environment variable name cannot be empty',
    );
    expect(() => option('not valid')).toThrow('Invalid argument name');
    expect(() => option('value', parsers.string, { long: '--invalid' })).toThrow(
      'Invalid argument name',
    );
    expect(() => option('value', parsers.string, { numArgs: -1 })).toThrow(
      'The minimum value count must be a non-negative integer',
    );
    expect(() => option('value', parsers.string, { numArgs: { min: 2, max: 1 } })).toThrow(
      'The maximum value count must be an integer at least equal to min',
    );
  });

  test('validates widened argument names, parsers, and option field types', () => {
    expect(() => option(1 as never)).toThrow('argument name must be a string');
    expect(() => flag({ toString: () => 'valid' } as never)).toThrow(
      'argument name must be a string',
    );
    expect(() => option('value', parsers.string, { long: 1 } as never)).toThrow('option \'long\' must be a string');

    const sparseCompletions: unknown[] = [];
    sparseCompletions.length = 1;

    for (
      const parser of [
        null,
        {},
        { label: 1, parse: () => '' },
        { label: 'VALUE', parse: 'invalid' },
        { label: 'VALUE', parse: () => '', completions: ['ok', 1] },
        { label: 'VALUE', parse: () => '', completions: sparseCompletions },
        { label: 'VALUE', parse: () => '', completionHint: 'database' },
        { label: 'VALUE', parse: () => '', choices: [null] },
        { label: 'VALUE', parse: () => '', ignoreCase: 'yes' },
      ]
    ) {
      expect(() => option('value', parser as never)).toThrow(/value parser/i);
      expect(() => positional('value', parser as never)).toThrow(/value parser/i);
    }

    for (
      const configuration of [
        null,
        [],
        { describe: 1 },
        { env: 1 },
        { hide: 'yes' },
        { global: 'yes' },
        { short: 1 },
        { aliases: ['valid', 1] },
        { valueName: 1 },
        { valueHint: 'database' },
        { complete: 'invalid' },
        { required: 'yes' },
        { repeatable: 'yes' },
        { numArgs: 'many' },
        { numArgs: { min: 'one' } },
        { numArgs: { min: 1, max: 'two' } },
        { numArgs: { min: 1, extra: 2 } },
        { valueDelimiter: 1 },
        { valueTerminator: 1 },
        { requireEquals: 'yes' },
        { allowHyphenValues: 'yes' },
        { allowNegativeNumbers: 'yes' },
      ]
    ) {
      expect(() => option('value', parsers.string, configuration as never)).toThrow();
    }
    expect(() => positional('value', parsers.string, { trailingVarArg: 'yes' } as never)).toThrow(
      'option \'trailingVarArg\' must be a boolean',
    );
    expect(() => flag('value', { negated: 'yes' } as never)).toThrow(
      'option \'negated\' must be a boolean',
    );
  });

  test('uses one non-dash UTF-16 character for short options', () => {
    expect(getArgumentDefinition(flag('valid', { short: '界' })).short).toBe(
      '界',
    );
    expect(() => flag('dash', { short: '-' } as never)).toThrow(
      'one UTF-16 character',
    );
    expect(() => flag('emoji', { short: '💥' } as never)).toThrow(
      'one UTF-16 character',
    );
  });
});
