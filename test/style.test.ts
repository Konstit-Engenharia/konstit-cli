import {
  expect,
  test,
} from 'bun:test';
import type { Style } from '../src';
import { createStyle } from '../src/style';

const enabled = { enabled: true, format: 'ansi-16m' } as const;
const style = createStyle({ stdout: enabled, stderr: { ...enabled, enabled: false } }, undefined);

test('styles foreground, background, and every modifier while retaining exact text', () => {
  expect(style('hello  ', { color: '#ff0000' })).toBe('\x1b[38;2;255;0;0mhello  \x1b[0m');
  expect(style('hello', { background: 'rgb(0, 0, 255)' })).toBe('\x1b[48;2;0;0;255mhello\x1b[0m');
  expect(style('hello', { bold: true, dim: true, italic: true, underline: true, inverse: true }))
    .toBe('\x1b[1m\x1b[2m\x1b[3m\x1b[4m\x1b[7mhello\x1b[0m');
  expect(style('plain', {})).toBe('plain');
  expect(style('', { color: 'red' })).toBe('');
  expect(style('plain', { color: 'red', bold: true, stream: 'stderr' })).toBe('plain');
  expect(Object.isFrozen(style)).toBe(true);
});

test('restores enclosing styles after nested segments and closes styles around line endings', () => {
  const inner = style('inner', { color: 'red' });
  const nested = style(`before ${inner} after`, { bold: true });
  expect(nested).toBe('\x1b[1mbefore \x1b[38;2;255;0;0minner\x1b[0m\x1b[1m after\x1b[0m');
  expect(style('one\r\ntwo\n\nthree\rfour\n', { underline: true })).toBe(
    '\x1b[4mone\x1b[0m\r\n\x1b[4mtwo\x1b[0m\n\n\x1b[4mthree\x1b[0m\r\x1b[4mfour\x1b[0m\n',
  );
  const multiline = style(`before ${style('inner\ncontinued', { color: 'red' })} after`, { bold: true });
  expect(Bun.stripANSI(multiline)).toBe('before inner\ncontinued after');
  expect(multiline).toContain('\x1b[0m\n\x1b[1m\x1b[38;2;255;0;0m');
  expect(style('text\x1b[mplain', { bold: true })).toContain('\x1b[0m\x1b[1mplain');
});

test('validates CSS colors even for disabled output and supports every output depth', () => {
  expect(() => style('value', { color: 'invalid', stream: 'stderr' })).toThrow('Invalid CSS color');
  expect(() => style('value', { background: 'invalid' })).toThrow('Invalid CSS color');
  expect(() => style('value', { color: 42 as never })).toThrow('Invalid CSS color');
  for (const format of ['ansi-16', 'ansi-256'] as const) {
    const color = createStyle({ stdout: { enabled: true, format }, stderr: enabled }, undefined);
    expect(color('red', { color: 'red', background: 'blue' })).toBe(
      format === 'ansi-16'
        ? '\x1b[91m\x1b[104mred\x1b[0m'
        : '\x1b[38;5;196m\x1b[48;5;21mred\x1b[0m',
    );
  }
  expect(style('css', { color: 'oklch(65% 0.2 30)' })).toContain('\x1b[38;2;');
});

void (() => {
  const typed: Style = style;
  const file: string = typed.file('file.csv', { stats: { mode: 0o100644, nlink: 1 } });
  const path: Promise<string> = typed.path('file.csv');
  // @ts-expect-error stream names are a closed union
  typed('text', { stream: 'log' });
  // @ts-expect-error styles are supplied through the options object
  typed('text', 'red');
  // @ts-expect-error file metadata uses numeric stat values
  typed.file('file', { stats: { mode: 1n } });
  void [file, path];
});
