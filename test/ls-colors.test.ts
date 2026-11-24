/* oxlint-disable no-control-regex -- ANSI SGR sequences contain control characters. */
import {
  afterAll,
  beforeAll,
  expect,
  spyOn,
  test,
} from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLsColors } from '../src/ls-colors';
import { createStyle } from '../src/style';

const colors = {
  stdout: { enabled: true, format: 'ansi-16m' },
  stderr: { enabled: true, format: 'ansi-16m' },
} as const;
const regular = { mode: 0o100644, nlink: 1 };
const symlink = { mode: 0o120777 };
const directory = { mode: 0o040755 };
const wrap = (sequence: string, text = 'name') => `\x1b[${sequence}m${text}\x1b[0m`;
let temporary: string;

beforeAll(async () => {
  temporary = await fs.mkdtemp(join(tmpdir(), 'konstit-cli-colors-'));
  await fs.writeFile(join(temporary, 'data.csv'), 'data\n');
  await fs.writeFile(join(temporary, 'run.csv'), '#!/bin/sh\n', { mode: 0o755 });
  await fs.link(join(temporary, 'data.csv'), join(temporary, 'hard.csv'));
  await fs.mkdir(join(temporary, 'dir.csv'));
  await fs.symlink('data.csv', join(temporary, 'link.csv'));
  await fs.symlink('missing', join(temporary, 'broken.csv'));
  await fs.symlink('loop.csv', join(temporary, 'loop.csv'));
});

afterAll(async () => {
  await fs.rm(temporary, { recursive: true, force: true });
});

test('matches suffixes in declaration order and uses metadata before suffixes', () => {
  const style = createStyle(colors, 'fi=37:di=34:ex=32:mh=35:*.csv=31:*.tar.gz=33:*.gz=36');
  expect(style.file('/input/data.CSV', { label: 'name' })).toBe(wrap('31'));
  expect(style.file('backup.tar.gz', { label: 'name' })).toBe(wrap('36'));
  expect(style.file('name', { stats: regular })).toBe(wrap('37'));
  expect(style.file('name.csv', { label: 'name', stats: directory })).toBe(wrap('34'));
  expect(style.file('name.csv', { label: 'name', stats: { mode: 0o100755, nlink: 2 } })).toBe(wrap('32'));
  expect(style.file('name.csv', { label: 'name', stats: { ...regular, nlink: 2 } })).toBe(wrap('35'));
  expect(style.file('name')).toBe(wrap('37'));
  expect(createStyle(colors, 'ex=0:*.csv=31').file('name.csv', { stats: { mode: 0o100755 } })).toBe(wrap('31', 'name.csv'));
  expect(createStyle(colors, 'fi=0:*.csv=00:di=34').file('name.csv')).toBe('name.csv');
  expect(createStyle(colors, 'fi=:*.csv=:di=34').file('name.csv')).toBe('name.csv');
  expect(createStyle(colors, 'di=34').file('name')).toBe('name');
  expect(createStyle(colors, 'no=35').file('name')).toBe(wrap('35'));
  expect(createStyle(colors, '*README=31:*.t?=32').file('a.ts')).toBe('a.ts');
  expect(createStyle(colors, '*=31').file('name')).toBe(wrap('31'));
});

test('handles duplicate suffixes and GNU ASCII case distinctions', () => {
  const style = createStyle(colors, '*.txt=31:*.TXT=32:*.txt=33:*.csv=34:*.CSV=34');
  expect(style.file('file.txt')).toBe(wrap('33', 'file.txt'));
  expect(style.file('file.TXT')).toBe(wrap('32', 'file.TXT'));
  expect(style.file('file.Txt')).toBe('file.Txt');
  expect(style.file('file.CsV')).toBe(wrap('34', 'file.CsV'));
  const merged = createStyle(colors, '*.x=31:*.X=32:*.x=32');
  expect(merged.file('file.X')).toBe(wrap('32', 'file.X'));
});

test('keeps parsed suffixes separate from resolved precedence state', () => {
  const rules = parseLsColors('*.txt=31:*.TXT=32:*.txt=33');
  expect(rules.suffixes.map(({ suffix, sequence, caseSensitive, shadowed }) => ({
    suffix,
    sequence,
    caseSensitive,
    shadowed,
  }))).toEqual([
    { suffix: '.txt', sequence: '33', caseSensitive: true, shadowed: false },
    { suffix: '.TXT', sequence: '32', caseSensitive: true, shadowed: false },
  ]);
});

test('distinguishes suffix-only matching from a missing path', () => {
  const style = createStyle(colors, 'mi=35:*.csv=31');
  expect(style.file('missing.csv')).toBe(wrap('31', 'missing.csv'));
  expect(style.file('missing.csv', { stats: null })).toBe(wrap('35', 'missing.csv'));
});

test.each(
  [
    [0o104755, 2, 'su'],
    [0o102755, 2, 'sg'],
    [0o100755, 2, 'ex'],
    [0o100644, 2, 'mh'],
    [0o041777, 1, 'tw'],
    [0o040777, 1, 'ow'],
    [0o041755, 1, 'st'],
    [0o040755, 1, 'di'],
    [0o010644, 1, 'pi'],
    [0o140644, 1, 'so'],
    [0o060644, 1, 'bd'],
    [0o020644, 1, 'cd'],
    [0, 1, 'or'],
  ] as const,
)('classifies mode %s and link count %s as %s', (mode, nlink, indicator) => {
  const rules = ['su', 'sg', 'ex', 'mh', 'tw', 'ow', 'st', 'di', 'pi', 'so', 'bd', 'cd', 'or'];
  const style = createStyle(colors, rules.map((name, index) => `${name}=38;5;${index + 1}`).join(':'));
  expect(style.file('name', { stats: { mode, nlink } })).toBe(wrap(`38;5;${rules.indexOf(indicator) + 1}`));
});

test('falls back through permission rules and distinguishes unknown, broken, and followed links', () => {
  expect(createStyle(colors, 'su=0:sg=31').file('name', { stats: { mode: 0o106755 } })).toBe(wrap('31'));
  expect(createStyle(colors, 'tw=0:ow=31').file('name', { stats: { mode: 0o041777 } })).toBe(wrap('31'));
  expect(createStyle(colors, 'tw=0:ow=0:st=31').file('name', { stats: { mode: 0o041777 } })).toBe(wrap('31'));
  const style = createStyle(colors, 'ln=36:or=31:mi=33:di=34');
  expect(style.file('name', { stats: symlink })).toBe(wrap('36'));
  expect(style.file('name', { stats: symlink, targetStats: null })).toBe(wrap('31'));
  expect(style.file('name', { stats: null })).toBe(wrap('33'));
  expect(createStyle(colors, 'ln=36:or=0').file('name', { stats: symlink, targetStats: null })).toBe(wrap('36'));
  const target = createStyle(colors, 'ln=target:di=34:or=31:*.csv=32');
  expect(target.file('name', { stats: symlink, targetStats: directory })).toBe(wrap('34'));
  expect(target.file('name.csv', { stats: symlink, targetStats: regular })).toBe(wrap('32', 'name.csv'));
  expect(
    createStyle(colors, 'ln=target:mh=35:*.csv=32').file('name.csv', {
      stats: symlink,
      targetStats: { ...regular, nlink: 2 },
    }),
  ).toBe(wrap('32', 'name.csv'));
  expect(target.file('name', { stats: symlink })).toBe('name');
  expect(target.file('name', { stats: null })).toBe(wrap('31'));
  expect(createStyle(colors, 'no=35:ln=target').file('name', { stats: symlink })).toBe(wrap('35'));
  expect(createStyle(colors, 'no=35').file('name', { stats: null })).toBe(wrap('35'));
});

test('decodes escaped suffixes and retains indexed colors, RGB colors, and SGR attributes', () => {
  const style = createStyle(
    colors,
    String.raw`*\:log=01;31:*a\=b=38;5;114:*\x2ecsv=48;2;1;2;3;4:*\056txt=90;107;9:*^?=33:*\?=34:*\_=35:*\\=36`,
  );
  expect(style.file('a:log')).toBe(wrap('01;31', 'a:log'));
  expect(style.file('a=b')).toBe(wrap('38;5;114', 'a=b'));
  expect(style.file('file.csv')).toBe(wrap('48;2;1;2;3;4', 'file.csv'));
  expect(style.file('file.txt')).toBe(wrap('90;107;9', 'file.txt'));
  expect(style.file('file\x7f')).toBe(wrap('34', 'file\x7f'));
  expect(style.file('file ')).toBe(wrap('35', 'file '));
  expect(style.file('file\\')).toBe(wrap('36', 'file\\'));
  expect(createStyle(colors, '*^A=31').file('file\x01')).toBe(wrap('31', 'file\x01'));
  expect(createStyle(colors, '*\x07=31').file('file\x07')).toBe(wrap('31', 'file\x07'));
  expect(createStyle(colors, 'fi=40;37;22;23;24;25;27;28;29;39;49;53;55').file('name')).toContain('\x1b[40;37;');
});

test('skips malformed and unsupported rules without discarding valid entries', () => {
  const style = createStyle(colors, 'di=31:broken:*bad=38;5;256:*bad=38;2;1;2:*bad=38;3;1:*bad=999:*bad=red:lc=hello:di=32:a=b=c');
  expect(style.file('name', { stats: directory })).toBe(wrap('32'));
  expect(style.file('bad')).toBe('bad');
  expect(style(`before ${style.file('name', { stats: directory })} after`, { bold: true }))
    .toContain('\x1b[0m\x1b[1m after');
});

test('inspects real paths, links, directories, executable files, and missing paths', async () => {
  const style = createStyle(colors, 'fi=37:di=34:ln=target:or=31:mi=35:ex=32:*.csv=36');
  for (
    const [name, sequence,] of [
      ['data.csv', '36'],
      ['dir.csv', '34'],
      ['run.csv', '32'],
      ['link.csv', '36'],
      ['broken.csv', '31'],
      ['loop.csv', '31'],
      ['missing', '35'],
      ['data.csv/child', '35'],
    ]
  ) {
    expect(await style.path(join(temporary, name as string), { label: 'name' })).toBe(wrap(sequence as string));
  }
  expect(await style.path(join(temporary, 'dir.csv'))).toBe(wrap('34', join(temporary, 'dir.csv')));
});

test('avoids unnecessary filesystem calls and propagates lookup failures', async () => {
  const lstat = spyOn(fs, 'lstat');
  const stat = spyOn(fs, 'stat');
  try {
    const disabled = createStyle({ stdout: { ...colors.stdout, enabled: false }, stderr: colors.stderr }, 'di=34');
    expect(disabled.file('file', { label: 'label' })).toBe('label');
    expect(await disabled.path('missing', { label: 'label' })).toBe('label');
    for (const setting of [undefined, false, '', 'broken', 'fi=0:di=00', 'ln=target'] as const) {
      expect(await createStyle(colors, setting).path('missing')).toBe('missing');
    }
    expect(lstat).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    const link = join(temporary, 'link.csv');
    expect(await createStyle(colors, 'ln=36:or=0').path(link)).toBe(wrap('36', link));
    expect(stat).not.toHaveBeenCalled();
    expect(await createStyle(colors, 'ln=36:or=31').path(link)).toBe(wrap('36', link));
    expect(stat).toHaveBeenCalledTimes(1);
    const failure = Object.assign(new Error('denied'), { code: 'EACCES' });
    lstat.mockRejectedValueOnce(failure);
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(createStyle(colors, 'fi=31').path('file')).rejects.toBe(failure);
    stat.mockRejectedValueOnce(failure);
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(createStyle(colors, 'ln=target:fi=31').path(link)).rejects.toBe(failure);
  } finally {
    lstat.mockRestore();
    stat.mockRestore();
  }
});

const ls = Bun.which('gls') ?? Bun.which('ls');
const gnuLs = ls !== null && Bun.spawnSync([ls, '--version']).stdout.toString().includes('GNU coreutils') ? ls : undefined;

test.skipIf(gnuLs === undefined)('matches GNU ls for supported type, suffix, and symlink rules', async () => {
  const cleared = ['no', 'fi', 'di', 'ln', 'pi', 'so', 'bd', 'cd', 'or', 'mi', 'ex', 'su', 'sg', 'st', 'ow', 'tw', 'mh', 'ca', 'do']
    .map((name) => `${name}=0`).join(':');
  for (
    const rules of [
      'fi=37:di=34:ln=36:or=31:ex=32:mh=35:*.csv=33',
      'ln=target:or=31:di=34:*.csv=32',
      'ln=target:or=31:mh=35:*.csv=32',
      '*.csv=31:*.CSV=32:*.csv=33',
      '*.csv=31:*.CSV=31',
      'ex=0:*.csv=31',
    ]
  ) {
    const setting = `${cleared}:${rules}`;
    const style = createStyle(colors, setting);
    for (const name of ['data.csv', 'hard.csv', 'dir.csv', 'run.csv', 'link.csv', 'broken.csv']) {
      const path = join(temporary, name);
      const process = Bun.spawnSync([gnuLs as string, '--color=always', '--quoting-style=literal', '-d', '--', path], {
        env: { ...Bun.env, LS_COLORS: setting, LC_ALL: 'C' },
      });
      expect(process.exitCode).toBe(0);
      const expected = process.stdout.toString();
      const actual = await style.path(path);
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Compare GNU and library SGR sequences.
      const prefix = (text: string) => [...text.slice(0, text.indexOf(path)).matchAll(/\x1b\[([\d;]*)m/g)].at(-1)?.[1];
      const normalized = (sequence: string | undefined) => sequence === '0' || sequence === '00' || sequence === '' ? undefined : sequence;
      expect(normalized(prefix(actual))).toBe(normalized(prefix(expected)));
      expect(Bun.stripANSI(actual)).toBe(path);
    }
  }
});
