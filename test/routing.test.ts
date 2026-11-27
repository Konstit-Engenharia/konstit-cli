import {
  describe,
  expect,
  mock,
  test,
} from 'bun:test';
import {
  command,
  ErrorKind,
  flag,
  option,
  parsers,
  positional,
  type Infer,
  type ParseResult,
} from '../src';
import { invoke } from '../src/testing';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;

describe('default and external subcommands', () => {
  test('selects the configured default for an empty invocation and marks it in help', async () => {
    const handler = mock(() => {});
    const status = command('status', { handler });
    const cli = command('tool', {
      defaultSubcommand: 'status',
      subcommands: [status],
    });

    expect(cli.renderHelp()).toContain('status            [default]');
    expect(cli.parse(['--help'])).toMatchObject({ ok: true, type: 'display' });
    expect(cli.parse([])).toEqual({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'status', args: {} } },
    });
    expect(await cli.run({ argv: [], stdout: () => {}, stderr: () => {} })).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(cli.tryParse(['typo'])).toMatchObject({
      ok: false,
      error: { commandPath: ['tool'] },
    });
    expect(cli.tryParse(['status'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'status' } },
    });
  });

  test('consumes parent option values before selecting a default or an inferred subcommand', async () => {
    const cli = command('tool', {
      version: '1.0.0',
      args: [option('profile', parsers.string, { short: 'p' })],
      inferSubcommands: true,
      defaultSubcommand: 'render',
      subcommands: [
        command('render', {
          args: [positional('file')],
          enableJsonFlag: true,
          handler: ({ file }) => ({ file: file ?? null }),
        }),
        command('compare'),
      ],
    });
    expect(cli.renderUsage()).toContain('[<command>]');
    const stdout: string[] = [];
    expect(
      await cli.run({
        argv: ['-p', 'compare', '--json'],
        stdout: (chunk) => {
          stdout.push(chunk);
        },
      }),
    ).toBe(0);
    expect(stdout).toEqual(['{"file":null}\n']);
    expect(cli.tryParse(['-p', 'prod', 'comp'])).toMatchObject({
      type: 'value',
      value: { profile: 'prod', subcommand: { name: 'compare' } },
    });
    expect(cli.tryParse(['comapre'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidSubcommand, suggestions: ['compare'] },
    });
    expect(cli.tryParse(['--', 'comapre'])).toMatchObject({
      type: 'value',
      value: { subcommand: { name: 'render', args: { file: 'comapre' } } },
    });
    expect(cli.tryParse(['--version'])).toMatchObject({ type: 'display', output: 'tool 1.0.0\n' });
  });

  test('routes default arguments and inherited globals to the default child', () => {
    const handler = mock(() => {});
    const status = command('status', {
      args: [flag('json', { short: 'j' })],
      handler,
    });
    const verbose = flag('verbose', { global: true, short: 'v' });
    const profile = option('profile', parsers.string, { global: true, short: 'p' });
    const cli = command('tool', {
      args: [verbose, profile],
      defaultSubcommand: 'status',
      subcommands: [status],
    });

    const result = cli.tryParse(['-v', '-p', 'dev', '-j']);
    expect(result).toMatchObject({
      ok: true,
      type: 'value',
      value: {
        verbose: true,
        profile: 'dev',
        subcommand: { name: 'status', args: { json: true } },
      },
    });
    expect(cli.tryParse(['--profile', 'dev', '--json'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'status', args: { json: true } } },
    });
    expect(cli.tryParse(['--json'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'status', args: { json: true } } },
    });
  });

  test('keeps an option terminator in the default child argv', () => {
    const run = command('run', {
      args: [positional('input')],
    });
    const cli = command('tool', {
      defaultSubcommand: 'run',
      subcommands: [run],
    });

    expect(cli.tryParse(['--', '--help'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'run', args: { input: '--help' } } },
    });
    expect(cli.tryParse(['input'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'run', args: { input: 'input' } } },
    });
  });

  test('inherits globals while selecting nested defaults', () => {
    const leaf = command('leaf');
    const middle = command('middle', {
      defaultSubcommand: 'leaf',
      subcommands: [leaf],
    });
    const cli = command('tool', {
      args: [flag('verbose', { global: true, short: 'v' })],
      defaultSubcommand: 'middle',
      subcommands: [middle],
    });

    expect(cli.tryParse(['-v'])).toMatchObject({
      ok: true,
      type: 'value',
      value: {
        subcommand: {
          name: 'middle',
          args: { subcommand: { name: 'leaf', args: {} } },
        },
      },
    });
  });

  test('resolves an external command with its opaque trailing argv', async () => {
    const handler = mock(() => {});
    const remote = command('remote', {
      args: [flag('verbose', { short: 'v' })],
      handler,
    });
    const calls: Array<readonly [string, readonly string[]]> = [];
    const cli = command('tool', {
      externalSubcommand: (name, argv) => {
        calls.push([name, argv]);
        return name === 'remote' ? remote : undefined;
      },
    });

    expect(cli.renderHelp()).toContain('<external-command>');
    expect(cli.tryParse(['remote', '-v'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { subcommand: { name: 'remote', args: { verbose: true } } },
    });
    expect(calls).toEqual([['remote', ['-v']]]);
    expect(await cli.run({ argv: ['remote', '-v'], stdout: () => {}, stderr: () => {} })).toBe(0);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('includes external selections in static result and validator types', () => {
    const remote = command('remote', { args: [flag('verbose')] });
    const status = command('status');
    const cli = command('tool', {
      subcommands: [status],
      externalSubcommand: (name) => name === 'remote' ? remote : undefined,
      validate: (value) => {
        if (value.subcommand?.name === 'remote') {
          const verbose: boolean = value.subcommand.args.verbose;
          void verbose;
        }
      },
      handler: (value) => {
        if (value.subcommand?.name === 'remote') {
          const verbose: boolean = value.subcommand.args.verbose;
          void verbose;
        }
      },
    });
    type _ExternalResult = Expect<
      Equal<
        Infer<typeof cli>['subcommand'],
        | { readonly name: 'status'; readonly args: Record<never, never>; }
        | { readonly name: 'remote'; readonly args: { readonly verbose: boolean; }; }
        | undefined
      >
    >;

    const result = cli.tryParse(['remote', '--verbose']);
    if (result.type === 'value' && result.value.subcommand?.name === 'remote') {
      expect(result.value.subcommand.args.verbose).toBe(true);
    }
  });

  test('keeps unresolved external names as structured unknown-argument failures', () => {
    const cli = command('tool', {
      externalSubcommand: () => undefined,
    });
    const result: ParseResult<unknown> = cli.tryParse(['unknown']);
    expect(result).toMatchObject({
      ok: false,
      type: 'error',
      error: { kind: ErrorKind.UnknownArgument, tokenIndex: 0 },
    });
  });

  test('dispatches a parsed external command without calling its resolver again', async () => {
    const verbose = flag('verbose', { global: true });
    const report = command('report', {
      handler: async (_args, context) => context.stdout(context.global(verbose) ? 'verbose' : 'quiet'),
    });
    const resolver = mock((name: string) => name === 'report' ? report : undefined);
    const cli = command('tool', { args: [verbose], externalSubcommand: resolver });
    const parsed = cli.tryParse(['report', '--verbose']);
    const stdout: string[] = [];
    expect(
      await cli.runParsed(parsed, {
        stdout: (chunk) => {
          stdout.push(chunk);
        },
      }),
    ).toBe(0);
    expect(stdout).toEqual(['verbose']);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  test('accepts external-only commands and preserves direct-invocation argument types', async () => {
    const report = command('report', { handler: () => 3 });
    const externalSubcommand = (name: string) => name === 'report' ? report : undefined;
    const required = command('tool', { externalSubcommand, subcommandRequired: true });
    expect(required.tryParse([])).toMatchObject({ type: 'error', error: { kind: ErrorKind.MissingSubcommand } });
    expect(await invoke(required, ['report'])).toMatchObject({ exitCode: 3 });

    const direct = command('tool', {
      args: [option('input', parsers.string, { required: 'without-subcommand' })],
      externalSubcommand,
    });
    type _ExternalInput = Expect<Equal<Extract<Infer<typeof direct>, { subcommand: { name: 'report'; }; }>['input'], string | undefined>>;
    expect(direct.tryParse(['report'])).toMatchObject({ type: 'value', value: { input: undefined, subcommand: { name: 'report' } } });
  });

  test('prompts for missing values on an external command', async () => {
    const verbose = flag('verbose', { global: true });
    const report = command('report', {
      args: [option('port', parsers.integer, { required: true, prompt: 'Port' })],
      handler: ({ port }, { stdout }) => stdout(String(port)),
    });
    const cli = command('tool', { args: [verbose], externalSubcommand: (name) => name === 'report' ? report : undefined });
    expect(await invoke(cli, ['report'], { prompt: () => '8080' })).toMatchObject({ exitCode: 0, stdout: '8080' });
    expect(await invoke(cli, ['report', '--port', 'bad'])).toMatchObject({ exitCode: 2 });
  });

  test('leaves declared positionals ahead of external resolution', () => {
    const resolver = mock(() => undefined);
    const cli = command('tool', {
      args: [positional('input')],
      externalSubcommand: resolver,
    });

    expect(cli.tryParse(['file.txt'])).toMatchObject({
      ok: true,
      type: 'value',
      value: { input: 'file.txt' },
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  test('rejects an external resolver result that collides with a declared child', () => {
    const declared = command('status');
    const cli = command('tool', {
      subcommands: [declared],
      externalSubcommand: () => declared,
    });

    expect(() => cli.parse(['remote'])).toThrow(
      'External subcommand \'remote\' resolved to declared subcommand \'status\'',
    );
  });

  test('rejects a default subcommand that is not declared', () => {
    expect(() => command('tool', { defaultSubcommand: 'status' } as never)).toThrow(
      'Unknown default subcommand: status',
    );
  });
});
