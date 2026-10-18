import {
  expect,
  test,
} from 'bun:test';
import {
  parsers,
  type ValueParser,
} from '../src';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const mappedInteger = parsers.map(parsers.integer, (value) => {
  const exactInput: number = value;
  return String(exactInput);
});
type _MappedIntegerIsExact = Expect<Equal<typeof mappedInteger, ValueParser<string>>>;

const refinedJson = parsers.refine(
  parsers.json(),
  (value): value is { readonly name: string; } =>
    typeof value === 'object'
    && value !== null
    && 'name' in value
    && typeof value.name === 'string',
);
type _RefinedJsonIsNarrowed = Expect<
  Equal<
    typeof refinedJson,
    ValueParser<{ readonly name: string; }>
  >
>;

const refinedInteger = parsers.refine(parsers.integer, (value) => value > 0);
type _RefinedIntegerKeepsInput = Expect<Equal<typeof refinedInteger, ValueParser<number>>>;

test('maps parsed values and preserves raw completion metadata', () => {
  const source = parsers.custom('MODE', (input) => input, {
    completions: ['dev', 'prod'],
    completionHint: 'file',
  });
  const mapped = parsers.map(source, (value) => value.toUpperCase());

  expect(mapped.label).toBe('MODE');
  expect(mapped.parse('dev')).toBe('DEV');
  expect(mapped.completions).toEqual(['dev', 'prod']);
  expect(Object.isFrozen(mapped)).toBe(true);
  expect(Object.isFrozen(mapped.completions)).toBe(true);
  expect(mapped.completionHint).toBe('file');
});

test('allows map completion metadata to override inherited values', () => {
  const source = parsers.custom('VALUE', (input) => input, {
    completions: ['source'],
    completionHint: 'file',
  });
  const mapped = parsers.map(source, (value) => value.length, {
    completions: ['replacement'],
    completionHint: 'directory',
  });
  const mappedWithoutMetadata = parsers.map(parsers.integer, (value) => value + 1);

  expect(mapped.parse('replacement')).toBe('replacement'.length);
  expect(mapped.completions).toEqual(['replacement']);
  expect(mapped.completionHint).toBe('directory');
  expect(mappedWithoutMetadata.completions).toBeUndefined();
  expect(mappedWithoutMetadata.completionHint).toBeUndefined();
});

test('refines values with a custom error and keeps only valid raw completions', () => {
  const source = parsers.enum(['http:', 'https:', 'ftp:']);
  const https = parsers.refine(
    source,
    (value) => value === 'https:',
    'expected an HTTPS protocol',
  );

  expect(https.parse('https:')).toBe('https:');
  expect(() => https.parse('http:')).toThrow('expected an HTTPS protocol');
  expect(https.completions).toEqual(['https:']);
  expect(https.completionHint).toBeUndefined();
  expect(Object.isFrozen(https.completions)).toBe(true);
});

test('refine preserves hints and filters overridden completion candidates', () => {
  const source = parsers.custom('VALUE', (input) => input, {
    completions: ['source'],
    completionHint: 'file',
  });
  const refined = parsers.refine(
    source,
    (value) => value === 'accepted',
    undefined,
    {
      completions: ['accepted', 'rejected'],
      completionHint: 'directory',
    },
  );

  expect(refined.completions).toEqual(['accepted']);
  expect(refined.completionHint).toBe('directory');
  expect(() => refined.parse('rejected')).toThrow('expected a value satisfying the refinement');

  const inheritedHint = parsers.refine(source, (value) => value === 'source');
  expect(inheritedHint.completions).toEqual(['source']);
  expect(inheritedHint.completionHint).toBe('file');
});

test('refine drops completion candidates when parsing or the predicate throws', () => {
  const source = parsers.custom('VALUE', (input) => {
    if (input === 'parse-error') {
      throw new Error('source parser failed');
    }
    return input;
  }, { completions: ['accepted', 'rejected', 'predicate-error', 'parse-error'] });
  const refined = parsers.refine(source, (value) => {
    if (value === 'predicate-error') {
      throw new Error('predicate failed');
    }
    return value === 'accepted';
  });

  expect(refined.completions).toEqual(['accepted']);
  expect(() => refined.parse('predicate-error')).toThrow('predicate failed');
  expect(() => refined.parse('rejected')).toThrow('expected a value satisfying the refinement');
});

test('refine type guards return the narrowed runtime value', () => {
  expect(refinedJson.parse('{"name":"Ada"}')).toEqual({ name: 'Ada' });
  expect(() => refinedJson.parse('{"name":1}')).toThrow(
    'expected a value satisfying the refinement',
  );
});
