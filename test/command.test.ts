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
import { getCommandDefinition } from '../src/command';
import type { ParseOutcome } from '../src/error';

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
    const cli = command('serve')
      .arg(option('port', parsers.integer).short('p').required())
      .arg(option('host').default('localhost'))
      .arg(flag('open').short('o'))
      .arg(positional('root').required());

    expect(parse(cli, ['-p', '8080', '--open', 'public'])).toEqual({
      port: 8080,
      host: 'localhost',
      open: true,
      root: 'public',
    });
  });

  test('supports long equals values, attached short values, and aliases', () => {
    const cli = command('app')
      .arg(option('port', parsers.integer).short('p'))
      .arg(option('output').alias('out'));

    expect(parse(cli, ['-p3000', '--out=result.txt'])).toEqual({
      port: 3000,
      output: 'result.txt',
    });
  });

  test('clusters flags and counts occurrences', () => {
    const cli = command('app')
      .arg(flag('quiet').short('q'))
      .arg(count('verbose').short('v'));

    expect(parse(cli, ['-qvvv'])).toEqual({ quiet: true, verbose: 3 });
  });

  test('collects repeatable options and positionals', () => {
    const cli = command('copy')
      .arg(option('tag').short('t').repeatable())
      .arg(positional('files').repeatable());

    const result = parse(cli, ['-t', 'one', '--tag=two', 'a', 'b']);
    expect(result).toEqual({ tag: ['one', 'two'], files: ['a', 'b'] });
    expect(Object.isFrozen(result.tag)).toBe(true);
  });

  test('uses -- to stop option parsing', () => {
    const cli = command('print').arg(positional('values').repeatable());
    expect(parse(cli, ['--', '--literal', '-x'])).toEqual({
      values: ['--literal', '-x'],
    });
  });

  test('keeps absent optional fields in the stable result shape', () => {
    const cli = command('app').arg(option('config'));
    const result = parse(cli, []);
    expect(result).toEqual({ config: undefined });
    expect(Object.hasOwn(result, 'config')).toBe(true);
  });

  test('uses CLI values instead of environment fallbacks', () => {
    const original = Bun.env.TYPECLAP_TEST_PORT;
    Bun.env.TYPECLAP_TEST_PORT = '1000';
    try {
      const cli = command('serve').arg(
        option('port', parsers.integer).env('TYPECLAP_TEST_PORT'),
      );
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
    const cli = command('copy')
      .arg(option('pair').numArgs(2).required())
      .arg(option('point', parsers.integer).numArgs(2).repeatable())
      .arg(option('tag').numArgs({ min: 1, max: 3 }).valueDelimiter(','))
      .arg(option('include').repeatable().valueDelimiter(','))
      .arg(option('define').numArgs({ min: 1, max: 3 }).valueTerminator(';'));

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

  test('supports equals-only and optional option values', () => {
    const cli = command('app')
      .arg(option('config').requireEquals())
      .arg(option('color').defaultMissing('auto'));

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
  });

  test('supports hyphen values, negative numbers, and trailing arguments', () => {
    const cli = command('run')
      .arg(option('pattern').allowHyphenValues())
      .arg(option('offset', parsers.integer).allowNegativeNumbers())
      .arg(positional('command').trailingVarArg());

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
  const cli = command('tool')
    .arg(flag('quiet').short('q'))
    .subcommand(
      command('add')
        .about('Add a file')
        .arg(positional('file').required()),
    )
    .subcommand(
      command('remove')
        .arg(option('id', parsers.integer).required()),
    )
    .requireSubcommand();

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

  test('supports aliases, inferred names, and the help subcommand', () => {
    const aliased = command('repo')
      .subcommand(command('clone').visibleAlias('copy').alias('cp'))
      .inferSubcommands();

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
    const cli = command('repo')
      .subcommand(command('clone'))
      .subcommand(command('close'))
      .inferSubcommands();
    expect(cli.tryParse(['cl'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.InvalidSubcommand },
    });
  });

  test('accepts global arguments before and after nested subcommands', () => {
    const cli = command('tool')
      .arg(count('verbose').short('v').global())
      .arg(option('profile').global())
      .subcommand(
        command('serve').subcommand(command('http').arg(option('port', parsers.integer))),
      );

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
    const cli = command('serve')
      .arg(option('port', parsers.range(1, 65_535)).required());

    const missing = cli.tryParse([]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toBeInstanceOf(CliError);
      expect(missing.error.kind).toBe(ErrorKind.MissingRequiredArgument);
      expect(missing.error.output).toContain('Usage: serve [OPTIONS]');
    }

    const invalid = cli.tryParse(['--port', '70000']);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.kind).toBe(ErrorKind.InvalidValue);
      expect(invalid.error.message).toContain('from 1 to 65535');
    }
  });

  test('suggests close option names', () => {
    const cli = command('app').arg(flag('verbose'));
    const result = cli.tryParse(['--verbse']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('--verbose');
    }
  });

  test('enforces requirements, conflicts, and groups', () => {
    const cli = command('release')
      .arg(flag('major'))
      .arg(flag('minor'))
      .arg(flag('dry-run'))
      .arg(option('token'))
      .conflicts('major', 'minor')
      .requires('token', 'dry-run')
      .group('level', ['major', 'minor'], { required: true });

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
    expect(() => command('app').arg(flag('one').short('x')).arg(flag('two').short('x')))
      .toThrow('Duplicate short option');
    expect(() => command('app').arg(positional('rest').repeatable()).arg(positional('last')))
      .toThrow('No positional can follow repeatable');
    expect(() => command('app').arg(flag('one').alias('one')))
      .toThrow('duplicate long options');
  });

  test('supports conditional requirements, required-unless, and overrides', () => {
    const cli = command('publish')
      .arg(option('format', parsers.enum(['text', 'json'])).default('text'))
      .arg(option('schema'))
      .arg(option('token'))
      .arg(flag('offline'))
      .arg(flag('quiet'))
      .arg(count('verbose'))
      .requiresIf('format', 'json', 'schema')
      .requiredUnlessPresent(['offline'], 'token')
      .overrides('quiet', 'verbose');

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
  const cli = command('demo')
    .about('A demo')
    .version('1.2.3')
    .arg(flag('verbose').short('v').describe('Show details'));

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
    const help = command('demo')
      .disableHelpFlag()
      .arg(option('mode').valueName('界').describe('Wide'))
      .arg(flag('verbose').describe('ASCII'))
      .renderHelp();

    expect(help).toContain('  --mode <界>  Wide');
    expect(help).toContain('  --verbose    ASCII');
  });

  test('aligns help labels without counting ANSI escape codes', () => {
    const redValue = '\x1b[31mVALUE\x1b[0m';
    const help = command('demo')
      .disableHelpFlag()
      .arg(option('color').valueName(redValue).describe('Color'))
      .arg(flag('verbose').describe('ASCII'))
      .renderHelp();

    expect(help).toContain(`  --color <${redValue}>  Color`);
    expect(help).toContain('  --verbose        ASCII');
  });

  test('runner writes control output and returns its exit code', async () => {
    const output: string[] = [];
    const code = await cli.handler(() => {}).run({
      argv: ['--help'],
      stdout: (text) => output.push(text),
    });
    expect(code).toBe(0);
    expect(output[0]).toContain('A demo');
  });

  test('customizes help and built-in flags', () => {
    const cli = command('demo')
      .about('A demo')
      .author('Konstit')
      .beforeHelp('Before')
      .afterHelp('After')
      .overrideUsage('demo [CUSTOM]')
      .arg(flag('verbose'));
    const help = cli.renderHelp();
    expect(help).toStartWith('Before\n');
    expect(help).toContain('Author: Konstit');
    expect(help).toContain('Usage: demo [CUSTOM]');
    expect(help).toEndWith('After\n');
    expect(cli.renderUsage()).toBe('demo [CUSTOM]');

    const exact = command('exact').overrideHelp('custom help\n');
    expect(exact.renderHelp()).toBe('custom help\n');

    const disabled = command('plain')
      .version('1.0.0')
      .disableHelpFlag()
      .disableVersionFlag();
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
    const cli = command('serve')
      .arg(option('port', parsers.integer).required())
      .arg(flag('open'))
      .handler(({ port, open }) => {
        received = { port, open };
      });

    expect(await cli.run(['--port', '8080', '--open'])).toBe(0);
    expect(received).toEqual({ port: 8080, open: true });
  });

  test('awaits asynchronous handlers and returns their exit code', async () => {
    let completed = false;
    const cli = command('check')
      .arg(positional('file').required())
      .handler(async ({ file }) => {
        await Promise.resolve();
        completed = file === 'README.md';
        return 7;
      });

    expect(await cli.run(['README.md'])).toBe(7);
    expect(completed).toBe(true);
  });

  test('invokes only the deepest matched subcommand handler', async () => {
    const calls: string[] = [];
    const http = command('http')
      .arg(option('port', parsers.integer).required())
      .handler(({ port }) => {
        calls.push(`http:${port}`);
        return 3;
      });
    const serve = command('serve')
      .subcommand(http)
      .handler(() => {
        calls.push('serve');
        return 2;
      });
    const cli = command('tool')
      .subcommand(serve)
      .handler(() => {
        calls.push('tool');
        return 1;
      });

    expect(await cli.run(['serve', 'http', '--port', '8080'])).toBe(3);
    expect(calls).toEqual(['http:8080']);
  });

  test('runs a handler attached to a configured schema', async () => {
    let received: string | undefined;
    const cli = command('print')
      .arg(positional('value').required())
      .handler(({ value }) => {
        received = value;
      });
    const code = await cli.run(['hello']);

    expect(code).toBe(0);
    expect(received).toBe('hello');
  });

  test('routes aliases and inferred prefixes to the canonical handler', async () => {
    const calls: string[] = [];
    const cli = command('repo')
      .subcommand(
        command('clone')
          .visibleAlias('copy')
          .handler(() => {
            calls.push('clone');
          }),
      )
      .inferSubcommands();

    expect(await cli.run(['copy'])).toBe(0);
    expect(await cli.run(['clo'])).toBe(0);
    expect(calls).toEqual(['clone', 'clone']);
  });

  test('keeps handler attachment immutable and requires a selected handler', async () => {
    const base = command('tool');
    const configured = base.handler(() => {});
    expect(getCommandDefinition(base).handler).toBeUndefined();
    expect(getCommandDefinition(configured).handler).toBeFunction();

    const missing = command('tool')
      .subcommand(command('status'))
      .handler(() => {});
    await expect(missing.run(['status'])).rejects.toThrow(
      'No handler is configured for command \'tool status\'',
    );
  });

  test('does not invoke handlers for help and validates exit codes', async () => {
    let calls = 0;
    const output: string[] = [];
    const cli = command('demo').handler(() => {
      calls += 1;
    });

    expect(await cli.run({ argv: ['--help'], stdout: (text) => output.push(text) }))
      .toBe(0);
    expect(calls).toBe(0);
    expect(output[0]).toContain('Usage: demo');

    await expect(command('bad').handler(() => 256).run([])).rejects.toThrow(
      'exit code must be an integer from 0 to 255',
    );
  });
});
