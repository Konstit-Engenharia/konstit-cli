import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  CliError,
  command,
  count,
  DisplayKind,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import type { ParseOutcome } from '../src/result/error';

function parse<Value>(
  configured: { parse(argv: readonly string[]): ParseOutcome<Value>; },
  argv: readonly string[],
): Value {
  const outcome = configured.parse(argv);
  if (outcome.type !== 'value') {
    throw new Error(`Expected a value, got ${outcome.kind}`);
  }
  return outcome.value;
}

describe('command parsing', () => {
  test('parses typed options, defaults, flags, and positionals', () => {
    const cli = command('serve', {
      args: [
        option('port', parsers.integer, { short: 'p', required: true }),
        option('host', parsers.string, { default: 'localhost' }),
        flag('open', { short: 'o' }),
        positional('root', parsers.string, { required: true }),
      ],
    });

    expect(parse(cli, ['-p', '8080', '--open', 'public'])).toEqual({
      port: 8080,
      host: 'localhost',
      open: true,
      root: 'public',
    });
  });

  test('supports long equals values, attached short values, and aliases', () => {
    const cli = command('app', {
      args: [
        option('port', parsers.integer, { short: 'p' }),
        option('output', parsers.string, { short: 'o', aliases: ['out'] }),
      ],
    });

    expect(parse(cli, ['-p3000', '--out=result.txt'])).toEqual({
      port: 3000,
      output: 'result.txt',
    });
    expect(parse(cli, ['-p=3000', '-o=result.txt'])).toEqual({
      port: 3000,
      output: 'result.txt',
    });
    expect(parse(cli, ['-o='])).toEqual({
      port: undefined,
      output: '',
    });
  });

  test('clusters flags and counts occurrences', () => {
    const cli = command('app', {
      args: [
        flag('quiet', { short: 'q' }),
        count('verbose', { short: 'v' }),
      ],
    });

    expect(parse(cli, ['-qvvv'])).toEqual({ quiet: true, verbose: 3 });
  });

  test('collects repeatable options and positionals', () => {
    const cli = command('copy', {
      args: [
        option('tag', parsers.string, { short: 't', repeatable: true }),
        positional('files', parsers.string, { repeatable: true }),
      ],
    });

    const result = parse(cli, ['-t', 'one', '--tag=two', 'a', 'b']);
    expect(result).toEqual({ tag: ['one', 'two'], files: ['a', 'b'] });
    expect(Object.isFrozen(result.tag)).toBe(true);
  });

  test('uses -- to stop option parsing', () => {
    const cli = command('print', {
      args: [positional('values', parsers.string, { repeatable: true })],
    });
    expect(parse(cli, ['--', '--literal', '-x'])).toEqual({
      values: ['--literal', '-x'],
    });
  });

  test('keeps absent optional fields in the stable result shape', () => {
    const cli = command('app', { args: [option('config')] });
    const result = parse(cli, []);
    expect(result).toEqual({ config: undefined });
    expect(Object.hasOwn(result, 'config')).toBe(true);
  });

  test('uses CLI values instead of environment fallbacks', () => {
    const original = Bun.env.TYPECLAP_TEST_PORT;
    Bun.env.TYPECLAP_TEST_PORT = '1000';
    try {
      const cli = command('serve', {
        args: [
          option('port', parsers.integer, { env: 'TYPECLAP_TEST_PORT' }),
        ],
      });
      expect(parse(cli, []).port).toBe(1000);
      expect(parse(cli, ['--port', '2000']).port).toBe(2000);
    } finally {
      if (original === undefined) {
        delete Bun.env.TYPECLAP_TEST_PORT;
      } else {
        Bun.env.TYPECLAP_TEST_PORT = original;
      }
    }
  });

  test('supports fixed and ranged value counts, delimiters, and terminators', () => {
    const cli = command('copy', {
      args: [
        option('pair', parsers.string, { numArgs: 2, required: true }),
        option('point', parsers.integer, { numArgs: 2, repeatable: true }),
        option('tag', parsers.string, {
          numArgs: { min: 1, max: 3 },
          valueDelimiter: ',',
        }),
        option('include', parsers.string, {
          repeatable: true,
          valueDelimiter: ',',
        }),
        option('define', parsers.string, {
          numArgs: { min: 1, max: 3 },
          valueTerminator: ';',
        }),
      ],
    });

    expect(
      parse(cli, [
        '--pair',
        'left',
        'right',
        '--point',
        '1',
        '2',
        '--point',
        '3',
        '4',
        '--tag',
        'one,two',
        'three',
        '--include',
        'a,b',
        '--include',
        'c',
        '--define',
        'x',
        'y',
        ';',
      ]),
    ).toEqual({
      pair: ['left', 'right'],
      point: [1, 2, 3, 4],
      tag: ['one', 'two', 'three'],
      include: ['a', 'b', 'c'],
      define: ['x', 'y'],
    });
    expect(cli.tryParse(['--pair', 'only', '--include', 'x'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.TooFewValues },
    });
    expect(cli.tryParse(['--tag', 'one,two,three,four'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.TooManyValues },
    });
  });

  test('applies declarative cardinality and value behavior', () => {
    const cli = command('configured', {
      args: [
        option('pair', parsers.string, { numArgs: 2, required: true }),
        option('point', parsers.integer, { numArgs: 2, repeatable: true }),
        option('tag', parsers.string, {
          numArgs: { min: 1, max: 3 },
          valueDelimiter: ',',
        }),
        option('include', parsers.string, {
          repeatable: true,
          valueDelimiter: ',',
        }),
        option('define', parsers.string, {
          numArgs: { min: 1, max: 3 },
          valueTerminator: ';',
        }),
        option('mode', parsers.enum(['fast', 'safe']), {
          defaultMissing: 'safe',
        }),
        option('exact', parsers.string, { requireEquals: true }),
        option('pattern', parsers.string, { allowHyphenValues: true }),
        option('number', parsers.integer, { allowNegativeNumbers: true }),
        positional('command', parsers.string, { trailingVarArg: true }),
      ],
    });

    const result = parse(cli, [
      '--pair',
      'left',
      'right',
      '--point',
      '1',
      '2',
      '--point',
      '3',
      '4',
      '--tag',
      'one,two',
      'three',
      '--define',
      'x',
      'y',
      ';',
      '--mode',
      '--exact=value',
      '--pattern',
      '-literal',
      '--number',
      '-5',
      'run',
      '--raw',
    ]);

    expect(result).toEqual({
      pair: ['left', 'right'],
      point: [1, 2, 3, 4],
      tag: ['one', 'two', 'three'],
      include: [],
      define: ['x', 'y'],
      mode: 'safe',
      exact: 'value',
      pattern: '-literal',
      number: -5,
      command: ['run', '--raw'],
    });
    expect(Object.isFrozen(result.point)).toBe(true);
    expect(Object.isFrozen(result.include)).toBe(true);
    expect(Object.isFrozen(result.command)).toBe(true);

    const positionalCli = command('files', {
      args: [positional('files', parsers.string, { repeatable: true })],
    });
    expect(parse(positionalCli, ['one', 'two'])).toEqual({
      files: ['one', 'two'],
    });

    const optionalRequiredCli = command('optional-required', {
      args: [option('maybe', parsers.string, {
        numArgs: { min: 0, max: 1 },
        required: true,
      })],
    });
    expect(parse(optionalRequiredCli, ['--maybe'])).toEqual({ maybe: undefined });
    expect(optionalRequiredCli.tryParse([])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
  });

  test('supports equals-only and optional option values', () => {
    const cli = command('app', {
      args: [
        option('config', parsers.string, { requireEquals: true }),
        option('color', parsers.string, { defaultMissing: 'auto' }),
      ],
    });

    expect(parse(cli, ['--config=app.json', '--color'])).toEqual({
      config: 'app.json',
      color: 'auto',
    });
    expect(parse(cli, ['--color=always'])).toEqual({
      config: undefined,
      color: 'always',
    });
    expect(cli.tryParse(['--config', 'app.json'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.NoEquals },
    });

    const flexibleCli = command('app', {
      args: [
        option('color', parsers.string, {
          defaultMissing: 'auto',
          requireEquals: false,
        }),
        flag('force'),
      ],
    });
    expect(parse(flexibleCli, ['--color', 'always'])).toEqual({
      color: 'always',
      force: false,
    });
    expect(parse(flexibleCli, ['--color', '--force'])).toEqual({
      color: 'auto',
      force: true,
    });
  });

  test('supports hyphen values, negative numbers, and trailing arguments', () => {
    const cli = command('run', {
      args: [
        option('pattern', parsers.string, { allowHyphenValues: true }),
        option('offset', parsers.integer, { allowNegativeNumbers: true }),
        positional('command', parsers.string, { trailingVarArg: true }),
      ],
    });

    expect(parse(cli, [
      '--pattern',
      '--literal',
      '--offset',
      '-10',
      'node',
      '--inspect',
      'app.ts',
    ])).toEqual({
      pattern: '--literal',
      offset: -10,
      command: ['node', '--inspect', 'app.ts'],
    });
  });
});

describe('subcommands', () => {
  const cli = command('tool', {
    args: [flag('quiet', { short: 'q' })],
    subcommands: [
      command('add', {
        about: 'Add a file',
        args: [positional('file', parsers.string, { required: true })],
      }),
      command('remove', {
        args: [option('id', parsers.integer, { required: true })],
      }),
    ],
    subcommandRequired: true,
  });

  test('returns a discriminated subcommand result', () => {
    expect(parse(cli, ['-q', 'add', 'README.md'])).toEqual({
      quiet: true,
      subcommand: { name: 'add', args: { file: 'README.md' } },
    });
  });

  test('requires a subcommand', () => {
    const result = cli.tryParse([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(ErrorKind.MissingSubcommand);
    }
  });

  test('renders help for a nested command', () => {
    const result = cli.tryParse(['add', '--help']);
    expect(result).toMatchObject({ ok: true, type: 'display', kind: DisplayKind.Help });
    if (result.type === 'display') {
      expect(result.output).toContain('Usage: tool add <FILE>');
    }
  });

  test('renders commands before options', () => {
    const help = cli.renderHelp();
    const commands = help.indexOf('Commands:');
    const options = help.indexOf('Options:');

    expect(commands).toBeGreaterThan(-1);
    expect(options).toBeGreaterThan(commands);
  });

  test('supports aliases, inferred names, and the help subcommand', () => {
    const aliased = command('repo', {
      subcommands: [
        command('clone', {
          visibleAliases: ['copy'],
          aliases: ['cp'],
        }),
      ],
      inferSubcommands: true,
    });

    for (const name of ['clone', 'copy', 'cp', 'clo']) {
      expect(parse(aliased, [name]).subcommand?.name).toBe('clone');
    }
    expect(aliased.renderHelp()).toContain('clone (aliases: copy)');
    expect(aliased.renderHelp()).not.toContain('cp');

    const help = aliased.tryParse(['help', 'copy']);
    expect(help).toMatchObject({ ok: true, type: 'display', kind: DisplayKind.Help });
    if (help.type === 'display') {
      expect(help.output).toContain('Usage: repo clone');
    }
  });

  test('reports ambiguous inferred subcommands', () => {
    const cli = command('repo', {
      subcommands: [command('clone'), command('close')],
      inferSubcommands: true,
    });
    expect(cli.tryParse(['cl'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.InvalidSubcommand },
    });
  });

  test('accepts global arguments before and after nested subcommands', () => {
    const cli = command('tool', {
      args: [
        count('verbose', { short: 'v', global: true }),
        option('profile', parsers.string, { global: true }),
      ],
      subcommands: [
        command('serve', {
          subcommands: [
            command('http', {
              args: [option('port', parsers.integer)],
            }),
          ],
        }),
      ],
    });

    expect(parse(cli, ['--profile', 'dev', 'serve', 'http', '-vv', '--port', '8080']))
      .toEqual({
        verbose: 2,
        profile: 'dev',
        subcommand: {
          name: 'serve',
          args: {
            subcommand: {
              name: 'http',
              args: { port: 8080 },
            },
          },
        },
      });

    const help = cli.tryParse(['serve', 'http', '--help']);
    expect(help).toMatchObject({ ok: true, type: 'display', kind: DisplayKind.Help });
    if (help.type === 'display') {
      expect(help.output).toContain('-v, --verbose');
      expect(help.output).toContain('--profile');
    }
  });
});

describe('validation and errors', () => {
  test('reports missing and invalid values as structured errors', () => {
    const cli = command('serve', {
      args: [
        option('port', parsers.range(1, 65_535), { required: true }),
      ],
    });

    const missing = cli.tryParse([]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBeInstanceOf(CliError);
      expect(missing.error.kind).toBe(ErrorKind.MissingRequiredArgument);
      expect(missing.error.output).toContain('Usage: serve --port <1..65535>');
    }

    const invalid = cli.tryParse(['--port', '70000']);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.kind).toBe(ErrorKind.InvalidValue);
      expect(invalid.error.message).toContain('from 1 to 65535');
    }
  });

  test.each(
    [
      { options: { required: true }, label: '<COUNT>' },
      { options: { required: true, valueName: 'TOTAL' }, label: '<TOTAL>' },
    ] as const,
  )('uses $label in invalid positional value errors', ({ options, label }) => {
    const cli = command('tool', {
      args: [positional('count', parsers.integer, options)],
    });

    expect(cli.tryParse(['many'])).toMatchObject({
      type: 'error',
      error: {
        kind: ErrorKind.InvalidValue,
        argumentName: 'count',
        tokenIndex: 0,
        message: `invalid value 'many' for ${label}: expected an integer`,
      },
    });
  });

  test('rejects undefined values returned by value parsers', () => {
    const cli = command('defined', {
      args: [
        option(
          'value',
          parsers.custom<string | undefined>('DEFINED', () => undefined),
          { required: true },
        ),
      ],
    });

    const result = cli.tryParse(['--value', 'input']);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.InvalidValue },
    });
    if (!result.ok) {
      expect(result.error.message).toContain('value parser returned undefined');
    }
  });

  test('escapes untrusted control characters in diagnostics', () => {
    const cli = command('safe', {
      args: [option('count', parsers.integer, { required: true })],
    });
    const result = cli.tryParse([
      '--count',
      '\u001b[31mBAD\nINJECTED\u202e',
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(
        '\\u{1b}[31mBAD\\nINJECTED\\u{202e}',
      );
      expect(result.error.message).not.toMatch(/[\p{Cc}\p{Cf}]/u);
      expect(result.error.output.split('\n')[0]).toBe(
        `error: ${result.error.message}`,
      );
    }
  });

  test('suggests close option names', () => {
    const cli = command('app', { args: [flag('verbose')] });
    const result = cli.tryParse(['--verbse']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('--verbose');
    }
  });

  test('enforces requirements, conflicts, and groups', () => {
    const cli = command('release', {
      args: [
        flag('major'),
        flag('minor'),
        flag('dry-run'),
        option('token'),
      ],
      conflicts: [['major', 'minor']],
      requires: [['token', 'dry-run']],
      groups: [{
        name: 'level',
        members: ['major', 'minor'],
        required: true,
      }],
    });

    expect(cli.tryParse([])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
    expect(cli.tryParse(['--major', '--minor'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    expect(cli.tryParse(['--major', '--token', 'secret'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(parse(cli, ['--minor']).minor).toBe(true);
  });

  test('detects invalid command definitions', () => {
    expect(() =>
      command('app', {
        args: [flag('one', { short: 'x' }), flag('two', { short: 'x' })],
      })
    )
      .toThrow('Duplicate short option');
    expect(() =>
      command('app', {
        args: [
          positional('rest', parsers.string, { repeatable: true }),
          positional('last'),
        ],
      })
    )
      .toThrow('No positional can follow repeatable');
    expect(() => command('app', { args: [flag('one', { aliases: ['one'] })] }))
      .toThrow('duplicate long options');
  });

  test('supports conditional requirements, required-unless, and overrides', () => {
    const cli = command('publish', {
      args: [
        option('format', parsers.enum(['text', 'json']), { default: 'text' }),
        option('schema'),
        option('token'),
        flag('offline'),
        flag('quiet'),
        count('verbose'),
      ],
      requiresIf: [['format', 'json', 'schema']],
      requiredUnlessPresent: [{ alternatives: ['offline'], target: 'token' }],
      overrides: [['quiet', 'verbose']],
    });

    expect(cli.tryParse(['--format', 'json', '--offline'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(cli.tryParse([])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
    expect(parse(cli, ['--offline', '--verbose', '--quiet'])).toMatchObject({
      quiet: true,
      verbose: 0,
    });
  });
});

describe('help, version, and runner', () => {
  const cli = command('demo', {
    about: 'A demo',
    version: '1.2.3',
    args: [flag('verbose', { short: 'v', describe: 'Show details' })],
    handler: () => {},
  });

  test('generates help and version output', () => {
    const help = cli.tryParse(['--help']);
    expect(help).toMatchObject({ ok: true, type: 'display', kind: DisplayKind.Help });
    if (help.type === 'display') {
      expect(help.output).toContain('-v, --verbose');
    }

    const version = cli.tryParse(['--version']);
    expect(version).toMatchObject({ ok: true, type: 'display', kind: DisplayKind.Version });
    if (version.type === 'display') {
      expect(version.output).toBe('demo 1.2.3\n');
    }
  });

  test('aligns help labels that contain wide Unicode characters', () => {
    const help = command('demo', {
      disableHelpFlag: true,
      args: [
        option('mode', parsers.string, { valueName: '界', describe: 'Wide' }),
        flag('verbose', { describe: 'ASCII' }),
      ],
    }).renderHelp();

    expect(help).toContain('  --mode <界>  Wide');
    expect(help).toContain('  --verbose    ASCII');
  });

  test('aligns help labels without counting ANSI escape codes', () => {
    const redValue = '\x1b[31mVALUE\x1b[0m';
    const help = command('demo', {
      disableHelpFlag: true,
      args: [
        option('color', parsers.string, {
          valueName: redValue,
          describe: 'Color',
        }),
        flag('verbose', { describe: 'ASCII' }),
      ],
    }).renderHelp();

    expect(help).toContain(`  --color <${redValue}>  Color`);
    expect(help).toContain('  --verbose        ASCII');
  });

  test('runner writes control output and returns its exit code', async () => {
    const output: string[] = [];
    const code = await cli.run({
      argv: ['--help'],
      stdout: (text) => output.push(text),
    });
    expect(code).toBe(0);
    expect(output[0]).toContain('A demo');
  });

  test('styles interactive help without changing plain or custom help', async () => {
    const previousNoColor = Bun.env.NO_COLOR;
    delete Bun.env.NO_COLOR;
    try {
      const styledCli = command('styled', {
        about: 'A styled command',
        author: 'Konstit',
        args: [
          positional('file', parsers.string, { describe: 'Input file' }),
          flag('verbose', { describe: 'Show details' }),
        ],
        subcommands: [command('child')],
        handler: () => {},
      });
      const plain = styledCli.renderHelp();
      const plainOutput: string[] = [];
      const styledOutput: string[] = [];

      await styledCli.run({ argv: ['--help'], stdout: (text) => plainOutput.push(text) });
      await styledCli.run({
        argv: ['--help'],
        color: true,
        stdout: (text) => styledOutput.push(text),
      });

      const accent = Bun.color('#0891b2', 'ansi-16m') ?? '';
      expect(accent).not.toBe('');
      expect(plainOutput[0]).toBe(plain);
      expect(styledOutput[0]).toContain(`\x1b[1m${accent}Usage:\x1b[0m`);
      expect(styledOutput[0]).toContain(`\x1b[1m${accent}Commands:\x1b[0m`);
      expect(styledOutput[0]).toContain(`  ${accent}child\x1b[0m`);
      const unstyled = styledOutput[0]
        ?.replaceAll(accent, '')
        .replaceAll('\x1b[1m', '')
        .replaceAll('\x1b[0m', '');
      expect(unstyled).toBe(plain);

      const custom = command('custom', {
        overrideHelp: 'Custom help\n',
        handler: () => {},
      });
      const customOutput: string[] = [];
      await custom.run({
        argv: ['--help'],
        color: true,
        stdout: (text) => customOutput.push(text),
      });
      expect(customOutput[0]).toBe('Custom help\n');
    } finally {
      if (previousNoColor === undefined) {
        delete Bun.env.NO_COLOR;
      } else {
        Bun.env.NO_COLOR = previousNoColor;
      }
    }
  });

  test('customizes help and built-in flags', () => {
    const cli = command('demo', {
      about: 'A demo',
      author: 'Konstit',
      beforeHelp: 'Before',
      afterHelp: 'After',
      overrideUsage: 'demo [CUSTOM]',
      args: [flag('verbose')],
    });
    const help = cli.renderHelp();
    expect(help).toStartWith('Before\n');
    expect(help).toContain('Author: Konstit');
    expect(help).toContain('Usage: demo [CUSTOM]');
    expect(help).toEndWith('After\n');
    expect(cli.renderUsage()).toBe('demo [CUSTOM]');

    const exact = command('exact', { overrideHelp: 'custom help\n' });
    expect(exact.renderHelp()).toBe('custom help\n');

    const disabled = command('plain', {
      version: '1.0.0',
      disableHelpFlag: true,
      disableVersionFlag: true,
    });
    expect(disabled.tryParse(['--help'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.UnknownArgument },
    });
    expect(disabled.tryParse(['--version'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.UnknownArgument },
    });
  });
});

describe('command handlers', () => {
  test('passes parsed arguments to a synchronous handler', async () => {
    let received: { readonly port: number; readonly open: boolean; } | undefined;
    const cli = command('serve', {
      args: [
        option('port', parsers.integer, { required: true }),
        flag('open'),
      ],
      handler: ({ port, open }) => {
        received = { port, open };
      },
    });

    expect(await cli.run(['--port', '8080', '--open'])).toBe(0);
    expect(received).toEqual({ port: 8080, open: true });
  });

  test('awaits asynchronous handlers and returns their exit code', async () => {
    let completed = false;
    const cli = command('check', {
      args: [positional('file', parsers.string, { required: true })],
      handler: async ({ file }) => {
        await Promise.resolve();
        completed = file === 'README.md';
        return 7;
      },
    });

    expect(await cli.run(['README.md'])).toBe(7);
    expect(completed).toBe(true);
  });

  test('invokes only the deepest matched subcommand handler', async () => {
    const calls: string[] = [];
    const http = command('http', {
      args: [option('port', parsers.integer, { required: true })],
      handler: ({ port }) => {
        calls.push(`http:${port}`);
        return 3;
      },
    });
    const serve = command('serve', {
      subcommands: [http],
      handler: () => {
        calls.push('serve');
        return 2;
      },
    });
    const cli = command('tool', {
      subcommands: [serve],
      handler: () => {
        calls.push('tool');
        return 1;
      },
    });

    expect(await cli.run(['serve', 'http', '--port', '8080'])).toBe(3);
    expect(calls).toEqual(['http:8080']);
  });

  test('runs a handler attached to a configured schema', async () => {
    let received: string | undefined;
    const cli = command('print', {
      args: [positional('value', parsers.string, { required: true })],
      handler: ({ value }) => {
        received = value;
      },
    });
    const code = await cli.run(['hello']);

    expect(code).toBe(0);
    expect(received).toBe('hello');
  });

  test('routes aliases and inferred prefixes to the canonical handler', async () => {
    const calls: string[] = [];
    const cli = command('repo', {
      subcommands: [
        command('clone', {
          visibleAliases: ['copy'],
          handler: () => {
            calls.push('clone');
          },
        }),
      ],
      inferSubcommands: true,
    });

    expect(await cli.run(['copy'])).toBe(0);
    expect(await cli.run(['clo'])).toBe(0);
    expect(calls).toEqual(['clone', 'clone']);
  });

  test('requires a handler on the selected command', async () => {
    const missing = command('tool', {
      subcommands: [command('status')],
      handler: () => {},
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(missing.run(['status'])).rejects.toThrow(
      'No handler is configured for command \'tool status\'',
    );
  });

  test('does not invoke handlers for help and validates exit codes', async () => {
    let calls = 0;
    const output: string[] = [];
    const cli = command('demo', {
      handler: () => {
        calls += 1;
      },
    });

    expect(await cli.run({ argv: ['--help'], stdout: (text) => output.push(text) }))
      .toBe(0);
    expect(calls).toBe(0);
    expect(output[0]).toContain('Usage: demo');

    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(command('bad', { handler: () => 256 }).run([])).rejects.toThrow(
      'exit code must be an integer from 0 to 255',
    );
  });
});
