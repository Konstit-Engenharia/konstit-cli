import {
  expect,
  test,
} from 'bun:test';
import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  command,
  ErrorKind,
  option,
  parsers,
  positional,
} from '../src';
import {
  completionShells,
  generateCompletion,
  resolveDynamicCompletion,
} from '../src/completion';

test('path parsers check existing kinds and allow missing paths unless required', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-path-'));
  try {
    const file = join(directory, 'input file.txt');
    const linkedFile = join(directory, 'link.txt');
    const missing = join(directory, 'missing');
    await writeFile(file, 'input');
    await symlink(file, linkedFile, 'file');

    const input = parsers.path({ kind: 'file', mustExist: true });
    const output = parsers.path({ kind: 'file', mustExist: false });
    const folder = parsers.path({ kind: 'directory' });
    expect(input.parse(file)).toBe(file);
    expect(input.parse(linkedFile)).toBe(linkedFile);
    expect(folder.parse(directory)).toBe(directory);
    expect(folder.parse('.')).toBe('.');
    expect(output.parse(missing)).toBe(missing);
    expect(folder.parse(missing)).toBe(missing);
    expect(() => input.parse(missing)).toThrow('expected an existing file');
    expect(() => parsers.path({ kind: 'directory', mustExist: true }).parse(missing)).toThrow('expected an existing directory');
    expect(() => output.parse(directory)).toThrow('expected a file');
    expect(() => folder.parse(file)).toThrow('expected a directory');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('joins an unquoted literal trailing path before checking that it exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-joined-path-'));
  try {
    const file = join(directory, 'input file.txt');
    await writeFile(file, 'input');
    const cli = command('tool', {
      args: [
        option('mode'),
        positional('program', parsers.string, { required: true }),
        positional('path', parsers.path({ kind: 'file', mustExist: true }), {
          trailingVarArg: true,
          literal: true,
          joinWith: ' ',
          required: true,
        }),
      ],
    });
    for (const tokens of [[join(directory, 'input'), 'file.txt'], [file]]) {
      expect(cli.parse(['--mode', 'safe', 'read', ...tokens])).toEqual({
        ok: true,
        type: 'value',
        value: { mode: 'safe', program: 'read', path: [file] },
      });
    }
    expect(cli.tryParse(['read', join(directory, 'missing'), 'file.txt'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidValue, argumentName: 'path', tokenIndex: 1 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('path parsers reject malformed paths and options', () => {
  const file = parsers.path({ kind: 'file' });
  expect(() => file.parse('')).toThrow('expected a non-empty path');
  expect(() => file.parse('input\0.txt')).toThrow('without null bytes');
  expect(() => parsers.path(null as never)).toThrow('options must be an object');
  expect(() => parsers.path({ kind: 'folder' } as never)).toThrow('must be \'file\' or \'directory\'');
  expect(() => parsers.path({ kind: 'file', mustExist: 'true' } as never)).toThrow('must be a boolean');
});

test('path parsers provide shell completion hints and standard CLI errors', async () => {
  const cli = command('tool', {
    args: [
      option('input', parsers.path({ kind: 'file', mustExist: true })),
      positional('destination', parsers.path({ kind: 'directory' })),
    ],
  });
  const explicitHints = command('tool', {
    args: [
      option('input', parsers.string, { valueHint: 'file' }),
      positional('destination', parsers.string, { valueHint: 'directory' }),
    ],
  });
  for (const shell of completionShells) {
    expect(generateCompletion(cli, shell)).toBe(generateCompletion(explicitHints, shell));
  }
  expect((await resolveDynamicCompletion(cli, ['--input', ''])).valueHint).toBe('file');
  expect((await resolveDynamicCompletion(cli, [''])).valueHint).toBe('directory');
  expect(cli.tryParse(['--input', '.'])).toMatchObject({
    type: 'error',
    error: { kind: ErrorKind.InvalidValue, argumentName: 'input' },
  });
});
