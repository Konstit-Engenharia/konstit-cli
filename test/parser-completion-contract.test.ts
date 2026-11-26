import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  count,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import {
  resolveDynamicCompletion,
  type DynamicCompletionContext,
} from '../src/completion';

type ScannerAgreement = 'shared rule' | 'intentional difference';

interface ScannerRule {
  readonly agreement: ScannerAgreement;
  readonly name: string;
  readonly parseArgv: readonly string[];
  readonly completionArgv: readonly string[];
  readonly parseExpected: object;
  readonly completionExpected: {
    readonly argument: string;
    readonly values: object;
    readonly rawValues?: object;
  };
}

const scannerRules: readonly ScannerRule[] = [
  {
    agreement: 'shared rule',
    name: 'long options accept a separate value',
    parseArgv: ['--mode', 'safe'],
    completionArgv: ['--mode', 'safe', '--query', ''],
    parseExpected: { ok: true, type: 'value', value: { mode: 'safe' } },
    completionExpected: {
      argument: 'query',
      values: { mode: 'safe' },
      rawValues: { mode: ['safe'] },
    },
  },
  {
    agreement: 'shared rule',
    name: 'long options accept an equals value',
    parseArgv: ['--mode=fast'],
    completionArgv: ['--mode=fast', '--query', ''],
    parseExpected: { ok: true, type: 'value', value: { mode: 'fast' } },
    completionExpected: {
      argument: 'query',
      values: { mode: 'fast' },
      rawValues: { mode: ['fast'] },
    },
  },
  {
    agreement: 'shared rule',
    name: 'short switches can be clustered',
    parseArgv: ['-qvv'],
    completionArgv: ['-qvv', '--query', ''],
    parseExpected: {
      ok: true,
      type: 'value',
      value: { quiet: true, verbose: 2 },
    },
    completionExpected: {
      argument: 'query',
      values: { quiet: true, verbose: 2 },
    },
  },
  {
    agreement: 'shared rule',
    name: 'long aliases store values under the canonical name',
    parseArgv: ['--profile', 'fast'],
    completionArgv: ['--profile', 'fast', '--query', ''],
    parseExpected: { ok: true, type: 'value', value: { mode: 'fast' } },
    completionExpected: {
      argument: 'query',
      values: { mode: 'fast' },
      rawValues: { mode: ['fast'] },
    },
  },
  {
    agreement: 'shared rule',
    name: 'double dash disables option recognition',
    parseArgv: ['--', '--mode'],
    completionArgv: ['--', '--mode', ''],
    parseExpected: {
      ok: true,
      type: 'value',
      value: { literal: ['--mode'], mode: undefined },
    },
    completionExpected: {
      argument: 'literal',
      values: { literal: ['--mode'], mode: undefined },
      rawValues: { literal: ['--mode'] },
    },
  },
  {
    agreement: 'shared rule',
    name: 'negative numbers remain option values',
    parseArgv: ['--number', '-7'],
    completionArgv: ['--number', '-7', '--query', ''],
    parseExpected: { ok: true, type: 'value', value: { number: -7 } },
    completionExpected: {
      argument: 'query',
      values: { number: -7 },
      rawValues: { number: ['-7'] },
    },
  },
  {
    agreement: 'shared rule',
    name: 'value delimiters split values consistently',
    parseArgv: ['--tag=a,b'],
    completionArgv: ['--tag=a,b', '--query', ''],
    parseExpected: { ok: true, type: 'value', value: { tag: ['a', 'b'] } },
    completionExpected: {
      argument: 'query',
      values: { tag: ['a', 'b'] },
      rawValues: { tag: ['a', 'b'] },
    },
  },
  {
    agreement: 'intentional difference',
    name: 'completion ignores an unknown long option while parsing rejects it',
    parseArgv: ['--unknown'],
    completionArgv: ['--unknown', '--query', ''],
    parseExpected: {
      ok: false,
      type: 'error',
      error: { kind: ErrorKind.UnknownArgument },
    },
    completionExpected: {
      argument: 'query',
      values: { mode: undefined, quiet: false, verbose: 0 },
    },
  },
  {
    agreement: 'intentional difference',
    name: 'completion keeps an invalid partial raw value while parsing rejects it',
    parseArgv: ['--number', 'not-an-integer'],
    completionArgv: ['--number', 'not-an-integer', '--query', ''],
    parseExpected: {
      ok: false,
      type: 'error',
      error: { kind: ErrorKind.InvalidValue },
    },
    completionExpected: {
      argument: 'query',
      values: { number: undefined },
      rawValues: { number: ['not-an-integer'] },
    },
  },
  {
    agreement: 'intentional difference',
    name: 'completion retains a known cluster prefix while parsing rejects the suffix',
    parseArgv: ['-qz'],
    completionArgv: ['-qz', '--query', ''],
    parseExpected: {
      ok: false,
      type: 'error',
      error: { kind: ErrorKind.UnknownArgument },
    },
    completionExpected: {
      argument: 'query',
      values: { quiet: true },
    },
  },
];

describe('parser and completion scanner contract', () => {
  for (const rule of scannerRules) {
    test(`[${rule.agreement}] ${rule.name}`, async () => {
      let observed: DynamicCompletionContext | undefined;
      const record = (context: DynamicCompletionContext) => {
        observed = context;
        return ['candidate'];
      };
      const cli = command('contract', {
        args: [
          option('mode', parsers.enum(['fast', 'safe']), {
            short: 'm',
            aliases: ['profile'],
          }),
          option('number', parsers.integer, {
            short: 'n',
            allowNegativeNumbers: true,
          }),
          option('tag', parsers.string, {
            repeatable: true,
            valueDelimiter: ',',
          }),
          flag('quiet', { short: 'q' }),
          count('verbose', { short: 'v' }),
          option('query', parsers.string, { complete: record }),
          positional('literal', parsers.string, {
            repeatable: true,
            complete: record,
          }),
        ],
      });

      expect(cli.tryParse(rule.parseArgv)).toMatchObject(rule.parseExpected);

      const result = await resolveDynamicCompletion(
        cli,
        rule.completionArgv,
      );
      expect(result.argument?.name).toBe(rule.completionExpected.argument);
      if (observed === undefined) {
        throw new Error(`Completion provider did not run for '${rule.name}'`);
      }
      expect(observed.values).toMatchObject(rule.completionExpected.values);
      if (rule.completionExpected.rawValues !== undefined) {
        expect(observed.rawValues).toMatchObject(
          rule.completionExpected.rawValues,
        );
      }
    });
  }

  test('[shared rule] double dash ends options and terminates the active positional', async () => {
    const diff = command('diff', {
      args: [
        positional('revisions', parsers.string, {
          numArgs: { min: 0, max: 2 },
          valueName: 'REV',
          valueTerminator: '--',
        }),
        positional('paths', parsers.string, {
          trailingVarArg: true,
          valueName: 'PATH',
          valueHint: 'file',
        }),
      ],
    });

    expect(diff.renderHelp()).toContain('Usage: diff [REV] [REV] [--] [PATH]...');
    for (const revisions of [[], ['HEAD'], ['HEAD', 'HEAD~1']]) {
      expect(diff.tryParse([...revisions, '--', 'src/', '--help'])).toEqual({
        ok: true,
        type: 'value',
        value: { revisions: revisions.length === 0 ? undefined : revisions, paths: ['src/', '--help'] },
      });
      const completion = await resolveDynamicCompletion(diff, [...revisions, '--', 'src']);
      expect(completion.argument?.name).toBe('paths');
      expect(completion.valueHint).toBe('file');
    }
  });

  test('[shared rule] a unique inferred subcommand selects the same child', async () => {
    let observed: DynamicCompletionContext | undefined;
    const cli = command('contract', {
      inferSubcommands: true,
      subcommands: [
        command('remote', {
          args: [
            flag('child'),
            option('query', parsers.string, {
              complete: (context) => {
                observed = context;
                return [];
              },
            }),
          ],
        }),
        command('remove'),
      ],
    });

    expect(cli.tryParse(['remot', '--child'])).toMatchObject({
      ok: true,
      type: 'value',
      value: {
        subcommand: {
          name: 'remote',
          args: { child: true },
        },
      },
    });
    const result = await resolveDynamicCompletion(
      cli,
      ['remot', '--child', '--query', ''],
    );
    expect(result.commandPath).toEqual(['contract', 'remote']);
    expect(observed?.values).toMatchObject({ child: true });
  });
});
