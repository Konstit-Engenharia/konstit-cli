import {
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  command,
  count,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import { getArgumentDefinition } from '../src/argument';
import { getCommandDefinition } from '../src/command';
import {
  collectDeprecation,
  getWarnings,
  setWarnings,
  type DeprecationWarning,
} from '../src/deprecation';

test('stores immutable deprecation metadata on arguments', () => {
  const aliases = { old: 'Use --output.' };
  const output = option('output', parsers.string, {
    aliases: ['old'],
    deprecated: 'Use --destination.',
    deprecatedAliases: aliases,
  });
  aliases.old = 'Changed after construction';
  const definition = getArgumentDefinition(output);
  expect(definition.deprecated).toBe('Use --destination.');
  expect(definition.deprecatedAliases).toEqual({ old: 'Use --output.' });
  expect(Object.isFrozen(definition.deprecatedAliases)).toBe(true);
  expect(getArgumentDefinition(positional('input', parsers.string, { deprecated: 'Use --input.' })).deprecated)
    .toBe('Use --input.');
  expect(getArgumentDefinition(flag('legacy', { deprecated: 'Use --modern.' })).deprecated).toBe('Use --modern.');
  expect(getArgumentDefinition(count('trace', { deprecated: 'Use --verbose.' })).deprecated).toBe('Use --verbose.');
  const commandAliases = { old: 'Use build.' };
  const cli = command('build', {
    aliases: ['old'],
    deprecated: 'Use bundle.',
    deprecatedAliases: commandAliases,
  });
  commandAliases.old = 'Changed after construction';
  expect(getCommandDefinition(cli).deprecated).toBe('Use bundle.');
  expect(getCommandDefinition(cli).deprecatedAliases).toEqual({ old: 'Use build.' });
  expect(Object.isFrozen(getCommandDefinition(cli).deprecatedAliases)).toBe(true);
});

test('validates declared aliases and deprecation messages', () => {
  expect(() =>
    option('value', parsers.string, {
      // @ts-expect-error invalid runtime metadata
      deprecated: true,
    })
  ).toThrow('must be a string');
  for (const deprecatedAliases of [null, [], false, 'old']) {
    expect(() =>
      option('value', parsers.string, {
        // @ts-expect-error invalid runtime metadata
        deprecatedAliases,
      })
    ).toThrow('deprecatedAliases must be an object');
  }
  expect(() => option('value', parsers.string, { deprecatedAliases: { old: 'Use --value.' } }))
    .toThrow('must be a declared alias');
  expect(() =>
    option('value', parsers.string, {
      aliases: ['old'],
      // @ts-expect-error invalid runtime metadata
      deprecatedAliases: { old: false },
    })
  ).toThrow('must be a string');
  expect(() =>
    command('tool', {
      // @ts-expect-error invalid runtime metadata
      deprecated: true,
    })
  ).toThrow('must be a string');
  expect(() => command('tool', { deprecatedAliases: { old: 'Use tool.' } })).toThrow('must be a declared alias');
});

test('collects warnings once per target and command path and snapshots results', () => {
  const warnings: DeprecationWarning[] = [];
  collectDeprecation(warnings, 'command', 'tool', undefined, ['tool']);
  expect(warnings).toEqual([]);
  collectDeprecation(warnings, 'command', 'tool', 'Use new-tool.', ['tool']);
  collectDeprecation(warnings, 'command', 'tool', 'Use new-tool.', ['tool']);
  collectDeprecation(warnings, 'command', 'tool', 'Use new-tool.', ['tool', 'nested']);
  collectDeprecation(warnings, 'command', 'tool', 'Use new-tool.', ['other']);
  collectDeprecation(warnings, 'argument', '--old', 'Use --new.', ['tool'], 'old');
  collectDeprecation(warnings, 'alias', '--old', 'Use --new.', ['tool'], 'old');
  const result = {};
  expect(getWarnings(result)).toEqual([]);
  expect(Object.isFrozen(getWarnings(result))).toBe(true);
  setWarnings(result, warnings);
  warnings.length = 0;
  expect(getWarnings(result)).toHaveLength(5);
  expect(Object.isFrozen(getWarnings(result))).toBe(true);
  expect(Object.isFrozen(getWarnings(result)[0])).toBe(true);
  expect(Object.isFrozen(getWarnings(result)[0]?.commandPath)).toBe(true);
});

test('collects command, exact alias, positional, short, and long argument warnings without output', () => {
  const cli = command('tool', {
    deprecated: 'Use new-tool.',
    args: [count('verbose', { short: 'v', global: true, deprecated: 'Use --log-level.' })],
    subcommands: [command('build', {
      aliases: ['compile'],
      visibleAliases: ['make'],
      deprecated: 'Use bundle.',
      deprecatedAliases: { compile: 'Use build.', make: 'Use build.' },
      args: [
        option('output', parsers.string, {
          short: 'o',
          aliases: ['out'],
          deprecated: 'Use --destination.',
          deprecatedAliases: { out: 'Use --output.' },
        }),
        positional('input', parsers.string, { deprecated: 'Use --input.' }),
        flag('old', { short: 'x', deprecated: 'Use --new.' }),
      ],
    })],
  });
  const output = spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = cli.parse(['-vv', 'compile', '--out', 'dist', '-x', 'src']);
    expect(result.type).toBe('value');
    expect(output).not.toHaveBeenCalled();
    expect(getWarnings(result).map(({ target, name }) => [target, name])).toEqual([
      ['command', 'tool'],
      ['argument', 'verbose'],
      ['command', 'build'],
      ['alias', 'compile'],
      ['argument', 'output'],
      ['alias', 'out'],
      ['argument', 'old'],
      ['argument', 'input'],
    ]);
    expect(getWarnings(result).at(-1)?.commandPath).toEqual(['tool', 'build']);
    expect(getWarnings(cli.parse(['make', '-odist']))).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'alias', name: 'make' }),
      expect.objectContaining({ target: 'argument', name: 'output' }),
    ]));
    expect(getWarnings(cli.parse(['build', '--old']))).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'argument', name: 'old' }),
    ]));
  } finally {
    output.mockRestore();
  }
});

test('does not warn for omitted arguments, defaults, environment, or inferred alias prefixes', () => {
  const previous = Bun.env.KONSTIT_DEPRECATED_VALUE;
  Bun.env.KONSTIT_DEPRECATED_VALUE = 'from-env';
  try {
    const cli = command('tool', {
      inferSubcommands: true,
      args: [
        option('env', parsers.string, { env: 'KONSTIT_DEPRECATED_VALUE', deprecated: 'Use --new.' }),
        option('defaulted', parsers.string, { default: 'value', deprecated: 'Use --new.' }),
      ],
      subcommands: [command('build', {
        aliases: ['compile'],
        deprecatedAliases: { compile: 'Use build.' },
      })],
    });
    expect(getWarnings(cli.parse([]))).toEqual([]);
    expect(getWarnings(cli.parse(['comp']))).toEqual([]);
  } finally {
    if (previous === undefined) {
      delete Bun.env.KONSTIT_DEPRECATED_VALUE;
    } else {
      Bun.env.KONSTIT_DEPRECATED_VALUE = previous;
    }
  }
});

test('only reads own alias deprecation messages', () => {
  const cli = command('tool', {
    subcommands: [command('build', {
      aliases: ['toString'],
      deprecatedAliases: {},
      args: [option('output', parsers.string, {
        aliases: ['constructor'],
        deprecatedAliases: {},
      })],
    })],
  });
  expect(getWarnings(cli.parse(['toString', '--constructor', 'dist']))).toEqual([]);
});

test('preserves warnings for parse failures and emits them before execution or errors', async () => {
  const events: string[] = [];
  const cli = command('tool', {
    deprecated: 'Use next.',
    args: [option('port', parsers.integer, { deprecated: 'Use --listen.' })],
    handler: () => {
      events.push('handler');
    },
  });
  const parsed = cli.tryParse(['--port', '12']);
  expect(events).toEqual([]);
  expect(
    await cli.runParsed(parsed, {
      onWarning: ({ name }) => {
        events.push(name);
      },
    }),
  ).toBe(0);
  expect(events).toEqual(['tool', 'port', 'handler']);
  const failure = cli.tryParse(['--port', 'invalid']);
  expect(getWarnings(failure)).toHaveLength(2);
  const stderr: string[] = [];
  expect(
    await cli.runParsed(failure, {
      stderr: (text) => {
        stderr.push(text);
      },
    }),
  ).toBe(2);
  expect(stderr[0]).toContain('warning:');
  expect(stderr[0]).toContain('Use next.');
  expect(stderr[1]).toContain('Use --listen.');
  expect(stderr[2]).toContain('error:');
  expect(await cli.run({ argv: [], onWarning: () => {} })).toBe(0);
  const output = spyOn(Bun, 'write').mockResolvedValue(0);
  try {
    expect(await cli.run([])).toBe(0);
    expect(output).toHaveBeenCalledTimes(1);
    expect(output).toHaveBeenCalledWith(Bun.stderr, expect.stringContaining('warning:'));
  } finally {
    output.mockRestore();
  }
});

test('does not emit warnings for help or version and sanitizes warning text', async () => {
  const cli = command('tool', {
    deprecated: 'Use next.\n\u001b[31m',
    version: '1.0',
    handler: () => {},
  });
  const stderr: string[] = [];
  for (const argv of [['--help'], ['--version']]) {
    const result = cli.parse(argv);
    expect(getWarnings(result)).toEqual([]);
    expect(
      await cli.runParsed(result, {
        stdout: () => {},
        stderr: (text) => {
          stderr.push(text);
        },
      }),
    ).toBe(0);
  }
  expect(stderr).toEqual([]);
  expect(
    await cli.run({
      argv: [],
      stderr: (text) => {
        stderr.push(text);
      },
    }),
  ).toBe(0);
  expect(stderr[0]).toContain('Use next.\\n\\u{1b}[31m');
});
