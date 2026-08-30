import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  CliError,
  command,
  count,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
  type ParseResult,
} from '../src';
import {
  resolveDynamicCompletion,
  type DynamicCompletionContext,
  type DynamicCompletionResult,
} from '../src/completion';

const propertySeeds = [
  0x00c0ffee,
  0x1badb002,
  0x5eed1234,
  0xdecafbad,
] as const;

function formatSeed(seed: number): string {
  return `0x${seed.toString(16).padStart(8, '0')}`;
}

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function randomInteger(random: () => number, maximum: number): number {
  return Math.floor(random() * maximum);
}

function randomValue(random: () => number): string {
  const alphabet = 'abcXYZ019-_=./ ?';
  const length = randomInteger(random, 18);
  let value = '';
  for (let index = 0; index < length; index += 1) {
    value += alphabet[randomInteger(random, alphabet.length)];
  }
  return value;
}

function randomArgv(random: () => number): readonly string[] {
  const atoms = [
    '',
    '-',
    '--',
    '--help',
    '--version',
    '--mode',
    '--mode=fast',
    '--mode=invalid',
    '--profile=safe',
    '--number',
    '--number=-2',
    '--number=nope',
    '--pair',
    '--pair=left',
    '--tag=a,b',
    '--exact',
    '--exact=value',
    '--unknown',
    '-q',
    '-vvv',
    '-qvx',
    '-n-3',
    '-e=value',
    '-\u001b[31m',
    'run',
    'child',
    '-7',
    'line\nbreak',
    '\u0000',
    '🧪',
  ] as const;
  const length = randomInteger(random, 13);
  const argv: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const atom = atoms[randomInteger(random, atoms.length)] ?? '';
    argv.push(
      randomInteger(random, 4) === 0
        ? randomValue(random)
        : atom,
    );
  }
  return argv;
}

function requireCompletionContext(
  context: DynamicCompletionContext | undefined,
): DynamicCompletionContext {
  if (context === undefined) {
    throw new Error('Completion provider did not run');
  }
  return context;
}

function parseSnapshot(result: ParseResult<unknown>): object {
  if (result.type === 'error') {
    return {
      ok: result.ok,
      type: result.type,
      kind: result.error.kind,
      message: result.error.message,
      output: result.error.output,
      exitCode: result.error.exitCode,
    };
  }
  if (result.type === 'display') {
    return {
      ok: result.ok,
      type: result.type,
      kind: result.kind,
      output: result.output,
    };
  }
  return { ok: result.ok, type: result.type, value: result.value };
}

function completionSnapshot(result: DynamicCompletionResult): object {
  return {
    candidates: result.candidates,
    commandPath: result.commandPath,
    current: result.current,
    argument: result.argument?.name,
    valueHint: result.valueHint,
  };
}

function expectValidArbitraryValue(value: unknown): void {
  expect(value).toBeObject();
  const parsed = value as Record<string, unknown>;
  expect(
    parsed.mode === undefined || parsed.mode === 'fast' || parsed.mode === 'safe',
  ).toBe(true);
  expect(parsed.number === undefined || Number.isInteger(parsed.number)).toBe(true);
  expect(typeof parsed.quiet).toBe('boolean');
  expect(Number.isSafeInteger(parsed.verbose)).toBe(true);
  expect(parsed.verbose as number).toBeGreaterThanOrEqual(0);
  expect(parsed.exact === undefined || typeof parsed.exact === 'string').toBe(true);
  expect(Array.isArray(parsed.tag)).toBe(true);
  expect((parsed.tag as unknown[]).every((value) => typeof value === 'string')).toBe(true);
  expect(Array.isArray(parsed.values)).toBe(true);
  expect((parsed.values as unknown[]).every((value) => typeof value === 'string')).toBe(true);
  if (parsed.pair !== undefined) {
    expect(parsed.pair).toBeArrayOfSize(2);
    expect((parsed.pair as unknown[]).every((value) => typeof value === 'string')).toBe(true);
  }
  if (parsed.subcommand !== undefined) {
    expect(parsed.subcommand).toMatchObject({
      name: 'run',
      args: { child: expect.any(Boolean) },
    });
  }
}

function expectValidCompletion(
  result: DynamicCompletionResult,
  argv: readonly string[],
): void {
  expect((argv.at(-1) ?? '').endsWith(result.current)).toBe(true);
  expect([
    JSON.stringify(['arbitrary']),
    JSON.stringify(['arbitrary', 'run']),
  ]).toContain(JSON.stringify(result.commandPath));
  const candidateValues = result.candidates.map(({ value }) => value);
  expect(new Set(candidateValues).size).toBe(candidateValues.length);
  expect(result.candidates.every(({ description, value }) =>
    (description === undefined || typeof description === 'string')
    && typeof value === 'string'
  )).toBe(true);
  if (result.argument !== undefined) {
    expect([
      'mode',
      'number',
      'pair',
      'tag',
      'exact',
      'quiet',
      'verbose',
      'values',
      'child',
    ]).toContain(result.argument.name);
  }
}

function propertyFailure(
  seed: number,
  index: number,
  argv: readonly string[],
  cause: unknown,
): Error {
  return new Error(
    `Property failed with seed=${formatSeed(seed)}, case=${index}, argv=${JSON.stringify(argv)}`,
    { cause },
  );
}

describe('parser and completion properties', () => {
  for (const seed of propertySeeds) {
    test(`long value forms and aliases are equivalent; seed=${formatSeed(seed)}`, async () => {
      const random = randomSource(seed);
      let observed: DynamicCompletionContext | undefined;
      const cli = command('equivalence', {
        args: [
          option('target', parsers.string, {
            short: 't',
            aliases: ['destination'],
            allowHyphenValues: true,
          }),
          option('query', parsers.string, {
            complete: (context) => {
              observed = context;
              return [];
            },
          }),
        ],
      });

      const scan = async (argv: readonly string[]) => {
        observed = undefined;
        await resolveDynamicCompletion(cli, [...argv, '--query', '']);
        const context = requireCompletionContext(observed);
        return {
          values: context.values,
          rawValues: context.rawValues,
        };
      };

      for (let index = 0; index < 100; index += 1) {
        const value = randomValue(random);
        const separate = ['--target', value];
        const inline = [`--target=${value}`];
        const alias = [`--destination=${value}`];
        try {
          expect(cli.tryParse(separate)).toEqual(cli.tryParse(inline));
          expect(cli.tryParse(alias)).toEqual(cli.tryParse(inline));
          expect(await scan(separate)).toEqual(await scan(inline));
          expect(await scan(alias)).toEqual(await scan(inline));
        } catch (error) {
          throw propertyFailure(seed, index, separate, error);
        }
      }
    });

    test(`short clusters equal separated switches; seed=${formatSeed(seed)}`, async () => {
      const random = randomSource(seed);
      let observed: DynamicCompletionContext | undefined;
      const cli = command('clusters', {
        args: [
          flag('quiet', { short: 'q' }),
          flag('force', { short: 'f' }),
          count('verbose', { short: 'v' }),
          option('query', parsers.string, {
            complete: (context) => {
              observed = context;
              return [];
            },
          }),
        ],
      });

      const scan = async (argv: readonly string[]) => {
        observed = undefined;
        await resolveDynamicCompletion(cli, [...argv, '--query', '']);
        return requireCompletionContext(observed).values;
      };

      for (let index = 0; index < 100; index += 1) {
        const shorts = Array.from(
          { length: randomInteger(random, 16) + 1 },
          () => ['q', 'f', 'v'][randomInteger(random, 3)] as string,
        );
        const clustered = [`-${shorts.join('')}`];
        const separated = shorts.map((short) => `-${short}`);
        try {
          expect(cli.tryParse(clustered)).toEqual(cli.tryParse(separated));
          expect(await scan(clustered)).toEqual(await scan(separated));
        } catch (error) {
          throw propertyFailure(seed, index, clustered, error);
        }
      }
    });

    test(`arbitrary argv is structured and deterministic; seed=${formatSeed(seed)}`, async () => {
      const random = randomSource(seed);
      const cli = command('arbitrary', {
        version: '1.0.0',
        args: [
          option('mode', parsers.enum(['fast', 'safe']), {
            aliases: ['profile'],
          }),
          option('number', parsers.integer, {
            short: 'n',
            allowNegativeNumbers: true,
          }),
          option('pair', parsers.string, { numArgs: 2 }),
          option('tag', parsers.string, {
            repeatable: true,
            valueDelimiter: ',',
          }),
          option('exact', parsers.string, {
            short: 'e',
            requireEquals: true,
          }),
          flag('quiet', { short: 'q' }),
          count('verbose', { short: 'v' }),
          positional('values', parsers.string, { repeatable: true }),
        ],
        subcommands: [command('run', {
          args: [flag('child')],
        })],
      });
      const expectedErrorKinds: ReadonlySet<string> = new Set([
        ErrorKind.ArgumentConflict,
        ErrorKind.InvalidSubcommand,
        ErrorKind.InvalidValue,
        ErrorKind.NoEquals,
        ErrorKind.TooFewValues,
        ErrorKind.TooManyValues,
        ErrorKind.UnknownArgument,
      ]);

      for (let index = 0; index < 200; index += 1) {
        const argv = randomArgv(random);
        try {
          const firstParse = cli.tryParse(argv);
          const secondParse = cli.tryParse(argv);
          expect(parseSnapshot(firstParse)).toEqual(parseSnapshot(secondParse));
          if (firstParse.type === 'error') {
            expect(firstParse.error).toBeInstanceOf(CliError);
            expect(expectedErrorKinds.has(firstParse.error.kind)).toBe(true);
            expect(firstParse.error.output.startsWith('error: ')).toBe(true);
            expect(firstParse.error.exitCode).toBe(2);
          } else if (firstParse.type === 'display') {
            if (firstParse.kind === 'version') {
              expect(firstParse.output).toBe('arbitrary 1.0.0\n');
            } else {
              expect(firstParse.output).toContain('Usage: arbitrary');
            }
          } else {
            expectValidArbitraryValue(firstParse.value);
          }

          const firstCompletion = await resolveDynamicCompletion(cli, argv);
          const secondCompletion = await resolveDynamicCompletion(cli, argv);
          expect(completionSnapshot(firstCompletion)).toEqual(
            completionSnapshot(secondCompletion),
          );
          expectValidCompletion(firstCompletion, argv);
        } catch (error) {
          throw propertyFailure(seed, index, argv, error);
        }
      }
    });
  }
});
