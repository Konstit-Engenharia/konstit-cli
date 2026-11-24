import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  option,
  parsers,
  positional,
  type ValueParser,
} from '../src';
import type {
  EnumParserOptions,
  EnumValue,
} from '../src/parser';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const descriptorParser = parsers.enum(
  [
    { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
    { value: 'slow', hide: true },
  ] as const,
);
type _DescriptorValuesAreCanonical = Expect<
  Equal<typeof descriptorParser, ValueParser<'fast' | 'slow'>>
>;

const stringParser = parsers.enum(['dev', 'prod'] as const);
type _StringValuesRemainCanonical = Expect<
  Equal<typeof stringParser, ValueParser<'dev' | 'prod'>>
>;

const descriptor: EnumValue<'fast'> = { value: 'fast', aliases: ['f'] };
const enumOptions: EnumParserOptions = { ignoreCase: true };
void [descriptor, enumOptions];

describe('enum value parsers', () => {
  test('lists visible choices in help when the value label uses a name', () => {
    const parser = parsers.enum([
      'fast',
      { value: 'slow', aliases: ['s'], describe: 'Slow mode' },
      { value: 'legacy', hide: true },
    ], { ignoreCase: true });
    const cli = command('tool', {
      args: [
        positional('mode', parser, { required: true }),
        option('fallback', parser, { valueName: 'MODE' }),
        option('preferred', parser),
      ],
    });

    const help = cli.renderHelp();
    expect(help).toContain('Usage: tool [options] <mode>');
    expect(help).toContain('  <mode>  [possible values: fast, slow] [slow: Slow mode; aliases: s] [case-insensitive values]');
    expect(help).toMatch(/--fallback <MODE> +\[possible values: fast, slow\]/);
    expect(help).toMatch(/--preferred <fast\|slow> +\[slow: /);
    expect(help).not.toContain('legacy');
  });

  test('accepts descriptors, aliases, and case-insensitive canonical values', () => {
    const parser = parsers.enum(
      [
        { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
        { value: 'slow', aliases: ['s'], hide: true },
      ] as const,
      { ignoreCase: true },
    );

    expect(parser.label).toBe('fast');
    expect(parser.completions).toEqual(['fast']);
    expect(parser.ignoreCase).toBe(true);
    expect(parser.choices).toEqual([
      { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
      { value: 'slow', aliases: ['s'], hide: true },
    ]);
    expect(Object.isFrozen(parser)).toBe(true);
    expect(Object.isFrozen(parser.choices)).toBe(true);
    expect(Object.isFrozen(parser.choices?.[0])).toBe(true);
    expect(Object.isFrozen(parser.choices?.[0]?.aliases)).toBe(true);
    expect(parser.parse('fast')).toBe('fast');
    expect(parser.parse('FAST')).toBe('fast');
    expect(parser.parse('f')).toBe('fast');
    expect(parser.parse('S')).toBe('slow');
    expect(() => parser.parse('other')).toThrow('expected one of: fast');
    expect(() => parser.parse('other')).not.toThrow('slow');
  });

  test('keeps the string tuple API and exposes immutable canonical choices', () => {
    const parser = parsers.enum(['dev', 'prod'] as const);

    expect(parser.label).toBe('dev|prod');
    expect(parser.completions).toEqual(['dev', 'prod']);
    expect(parser.choices).toEqual([{ value: 'dev' }, { value: 'prod' }]);
    expect(Object.isFrozen(parser.completions)).toBe(true);
    expect(Object.isFrozen(parser.choices)).toBe(true);
    expect(parser.parse('prod')).toBe('prod');
  });

  test('accepts hidden-only enums without exposing their values', () => {
    const parser = parsers.enum(
      [
        { value: 'secret', aliases: ['s'], hide: true },
      ] as const,
    );

    expect(parser.label).toBe('value');
    expect(parser.completions).toEqual([]);
    expect(parser.parse('secret')).toBe('secret');
    expect(parser.parse('s')).toBe('secret');
    expect(() => parser.parse('other')).toThrow('expected a configured value');
    expect(() => parser.parse('other')).not.toThrow('secret');
    expect(() => stringParser.parse('other')).toThrow('expected one of: dev, prod');
  });

  test('preserves and filters choice metadata through map and refine', () => {
    const source = parsers.enum(
      [
        { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
        { value: 'slow', aliases: ['s'], hide: true },
      ] as const,
      { ignoreCase: true },
    );
    const mapped = parsers.map(source, (value) => value.length, {
      completions: ['F'],
    });
    expect(mapped.parse('f')).toBe(4);
    expect(mapped.completions).toEqual(['F']);
    expect(mapped.choices).toEqual([
      { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
    ]);
    expect(mapped.ignoreCase).toBe(true);
    expect(Object.isFrozen(mapped.choices)).toBe(true);

    const refined = parsers.refine(source, (value) => {
      if (value === 'slow') {
        throw new Error('predicate failed');
      }
      return value === 'fast';
    });
    expect(refined.parse('F')).toBe('fast');
    expect(refined.completions).toEqual(['fast']);
    expect(refined.choices).toEqual([
      { value: 'fast', aliases: ['f'], describe: 'Fast mode' },
    ]);
    expect(refined.ignoreCase).toBe(true);
    expect(Object.isFrozen(refined.choices)).toBe(true);
    expect(() => refined.parse('slow')).toThrow('predicate failed');

    const override = parsers.map(source, (value) => value, {
      completions: ['s', 'custom'],
    });
    expect(override.completions).toEqual(['custom']);
    expect(override.choices).toEqual([]);

    const refinedOverride = parsers.refine(source, () => true, undefined, {
      completions: ['s'],
    });
    expect(refinedOverride.completions).toEqual([]);
    expect(refinedOverride.choices).toEqual([]);
  });

  test('rejects malformed and ambiguous enum definitions', () => {
    const sparseValues: unknown[] = [];
    sparseValues.length = 1;
    const sparseAliases: unknown[] = [];
    sparseAliases.length = 1;

    expect(() => parsers.enum([] as never)).toThrow('non-empty array');
    expect(() => parsers.enum(sparseValues as never)).toThrow('non-empty array');
    expect(() => parsers.enum(['ok', 1] as never)).toThrow('strings');
    expect(() => parsers.enum([{ value: 1 }] as never)).toThrow('string value');
    expect(() => parsers.enum([{ value: 'ok', aliases: [''] as never }] as never)).not.toThrow();
    expect(() => parsers.enum([{ value: 'ok', aliases: [1] }] as never)).toThrow('array of strings');
    expect(() => parsers.enum([{ value: 'ok', aliases: sparseAliases }] as never)).toThrow('array of strings');
    expect(() => parsers.enum([{ value: 'ok', describe: 1 }] as never)).toThrow('describe');
    expect(() => parsers.enum([{ value: 'ok', hide: 'yes' }] as never)).toThrow('hide');
    expect(() => parsers.enum([{ value: 'ok', extra: true }] as never)).toThrow('extra');
    expect(() => parsers.enum(['same', 'same'] as never)).toThrow('duplicated');
    expect(() => parsers.enum([{ value: 'one', aliases: ['x'] }, { value: 'two', aliases: ['x'] }] as never)).toThrow('duplicated');
    expect(() => parsers.enum([{ value: 'one', aliases: ['ONE'] }] as never, { ignoreCase: true })).toThrow('duplicated');
    expect(() => parsers.enum(['one'] as const, { ignoreCase: 'yes' } as never)).toThrow('boolean');
    expect(() => parsers.enum(['one'] as const, { extra: true } as never)).toThrow('cannot configure');
    expect(() => parsers.enum(['one'] as const, null as never)).toThrow('options must be an object');
    expect(() => parsers.enum(null as never)).toThrow('non-empty array');
    expect(() =>
      parsers.map({
        label: 'VALUE',
        parse: (input: string) => input,
        choices: [null],
      } as never, (value) => value)
    ).toThrow('choices');
    expect(() =>
      parsers.map({
        label: 'VALUE',
        parse: (input: string) => input,
        ignoreCase: 'yes',
      } as never, (value) => value)
    ).toThrow('ignoreCase');
  });
});
