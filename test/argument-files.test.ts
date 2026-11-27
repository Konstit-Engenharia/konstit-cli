import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDynamicCompletion } from '../src/completion.js';
import {
  command,
  ErrorKind,
  flag,
  hookToken,
  option,
  parsers,
  positional,
} from '../src/index.js';
import { invoke } from '../src/testing.js';

describe('argument files', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'konstit-cli-argv-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const cli = command('tool', {
    args: [flag('quiet', { short: 'q' }), flag('trace', { short: 't' })],
    subcommands: [command('send', {
      args: [option('count', parsers.integer), positional('items', parsers.string, { trailingVarArg: true })],
      handler: async (args, { stdout }) => stdout(JSON.stringify(args)),
    })],
  });

  test('expands relative includes in place, with one literal argument per line', async () => {
    const file = join(directory, 'args.txt');
    await Bun.write(file, '\uFEFF-q\r\nsend\r\n@child.txt\r\n');
    await Bun.write(join(directory, 'child.txt'), '--count\r2\r--\r spaced value \r@@literal\r\r');
    const args = { count: 2, items: [' spaced value ', '@literal', '', '@'] };
    const argv = [`@${file}`, '@'];
    expect(cli.parse(argv, { argumentFiles: true })).toMatchObject({
      type: 'value',
      value: { quiet: true, subcommand: { name: 'send', args } },
    });
    expect(await invoke(cli, argv, { argumentFiles: true })).toMatchObject({ exitCode: 0, stdout: JSON.stringify(args) });
    expect(cli.tryParse(argv)).toMatchObject({ type: 'error' });
  });

  test('allows empty files and repeated includes', async () => {
    const empty = join(directory, 'empty.txt');
    const item = join(directory, 'item.txt');
    await Bun.write(empty, '');
    await Bun.write(item, 'item');
    expect(cli.parse([`@${empty}`, 'send', '--', `@${item}`, `@${item}`], { argumentFiles: true })).toMatchObject({
      type: 'value',
      value: { subcommand: { args: { items: ['item', 'item'] } } },
    });
  });

  test('keeps the original argv index and identifies the source line in diagnostics', async () => {
    const badValue = join(directory, '$&-bad-value.txt');
    await Bun.write(badValue, 'send\n--count\nwrong\n');
    const { stderr } = await invoke(cli, ['-q', `@${badValue}`], { argumentFiles: true, diagnostics: 'json' });
    expect(JSON.parse(stderr)).toMatchObject({
      type: 'parse-error',
      kind: ErrorKind.InvalidValue,
      commandPath: ['tool', 'send'],
      tokenIndex: 1,
      argumentFile: { path: badValue, line: 3 },
    });
    const human = await invoke(cli, ['-q', `@${badValue}`], { argumentFiles: true });
    expect(human.stderr).toContain(`(from '${badValue}', line 3)`);

    const commandFile = join(directory, 'command.txt');
    await Bun.write(commandFile, '-q\n-t\n');
    expect(cli.tryParse([`@${commandFile}`, '--quie'], { argumentFiles: true })).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.UnknownArgument, tokenIndex: 1, suggestions: ['--quiet'] },
    });
    expect(cli.tryParse(['--quie', `@${commandFile}`], { argumentFiles: true })).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.UnknownArgument, tokenIndex: 0, suggestions: ['--quiet'] },
    });
  });

  test('reports missing, nonregular, invalid UTF-8, recursive, and overnested files', async () => {
    const bad = join(directory, 'bad.txt');
    await Bun.write(bad, new Uint8Array([0xff]));
    const cycle = join(directory, 'cycle.txt');
    await Bun.write(cycle, '@alias.txt\n');
    await symlink(cycle, join(directory, 'alias.txt'));
    await Promise.all(Array.from({ length: 33 }, (_, i) => Bun.write(join(directory, `${i}.txt`), `@${i + 1}.txt\n`)));
    const examples = [
      [join(directory, 'missing.txt'), 'could not resolve'],
      [directory, 'as a regular file'],
      [bad, 'not valid UTF-8'],
      [cycle, 'includes itself'],
      [join(directory, '0.txt'), 'maximum nesting depth'],
    ] as const;
    for (const [path, message,] of examples) {
      expect(cli.tryParse(['-q', `@${path}`], { argumentFiles: true })).toMatchObject({
        type: 'error',
        error: { kind: ErrorKind.InvalidArgumentFile, tokenIndex: 1, message: expect.stringContaining(message) },
      });
    }
    expect(cli.tryParse([`@${cycle}`], { argumentFiles: true })).toMatchObject({
      type: 'error',
      error: { argumentFile: { path: cycle, line: 1 } },
    });
  });

  test('scans completed file references and leaves the cursor word untouched', async () => {
    const completionCli = command('tool', {
      subcommands: [command('send', { args: [option('count', parsers.integer)] })],
    });
    const file = join(directory, 'completion.txt');
    await Bun.write(file, 'send\n');
    expect(await resolveDynamicCompletion(completionCli, [`@${file}`, '--co'], { argumentFiles: true })).toMatchObject({
      commandPath: ['tool', 'send'],
      current: '--co',
      candidates: [{ value: '--count' }],
    });
    expect(await resolveDynamicCompletion(completionCli, ['@unfinished'], { argumentFiles: true })).toMatchObject({
      commandPath: ['tool'],
      current: '@unfinished',
    });
    const env = { KONSTIT_CLI_COMPLETE: '1' };
    const completed = await invoke(completionCli, [`@${file}`, '--co'], { argumentFiles: true, env });
    expect(completed.stdout).toBe(`${Buffer.from('--count').toString('hex')}\t\n`);
    expect(await invoke(completionCli, [`@${join(directory, 'missing')}`, '--co'], { argumentFiles: true, env })).toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
    const failedProvider = command('tool', {
      args: [option('option', parsers.string, {
        complete() {
          throw new Error('completion failed');
        },
      })],
    });
    await assert.rejects(invoke(failedProvider, ['--option', ''], { env }), /completion failed/);
  });

  test('runs default commands with file arguments, prompt answers, and JSON output', async () => {
    const file = join(directory, 'run.txt');
    await Bun.write(file, '--json\n--port\n');
    const project = hookToken<string>('project');
    const account = option('account', parsers.string, { global: true, required: true, prompt: 'Account' });
    const lifecycle: string[] = [];
    const deploy = command('tool', {
      args: [account],
      defaultSubcommand: 'deploy',
      setup: ({ provide }) => provide(project, 'workspace'),
      cleanup: ({ get }) => {
        lifecycle.push(get(project));
      },
      subcommands: [command('deploy', {
        args: [option('port', parsers.integer, { required: true, prompt: 'Port' })],
        enableJsonFlag: true,
        handler: ({ port }, context) => ({ project: context.get(project), account: context.global(account), port }),
      })],
    });
    const result = await invoke(deploy, [`@${file}`], {
      argumentFiles: true,
      prompt: (request) => {
        if (request.argumentName === 'account') {
          expect(request.commandPath).toEqual(['tool']);
          return 'production';
        }
        expect(request).toMatchObject({ commandPath: ['tool', 'deploy'], argumentName: 'port' });
        return '8080';
      },
    });
    expect(result).toMatchObject({ exitCode: 0, stdout: '{"project":"workspace","account":"production","port":8080}\n', stderr: '' });
    expect(lifecycle).toEqual(['workspace']);
  });
});
