import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  ErrorKind,
  option,
  parsers,
} from '../src';

describe('range parser integer mode', () => {
  test('preserves fractional parsing by default and when disabled', () => {
    for (const options of [undefined, {}, { integer: false }]) {
      const range = parsers.range(-10, 100, options);
      expect(range.parse('12.5')).toBe(12.5);
      expect(range.parse('-1.5')).toBe(-1.5);
      expect(range.parse('1e2')).toBe(100);
      expect(() => range.parse('100.5')).toThrow('expected a number from -10 to 100');
    }
  });

  test('accepts signed integers and inclusive bounds', () => {
    const range = parsers.range(-10, 10, { integer: true });
    expect(range.parse('-10')).toBe(-10);
    expect(range.parse('+10')).toBe(10);
    expect(range.parse('0')).toBe(0);
    expect(range.parse('-0')).toBe(-0);
    expect(range.parse('007')).toBe(7);
    expect(() => range.parse('-11')).toThrow('expected an integer from -10 to 10');
    expect(() => range.parse('11')).toThrow('expected an integer from -10 to 10');
    expect(parsers.range(3, 3, { integer: true }).parse('3')).toBe(3);
  });

  test('uses the same integer syntax as parsers.integer', () => {
    const range = parsers.range(-100, 100, { integer: true });
    for (const input of ['1.5', '-1.5', '1.0', '1e1', '0x10', '', ' ', ' 1 ', 'NaN', 'Infinity', 'text']) {
      expect(() => range.parse(input)).toThrow('expected an integer');
    }
  });

  test('rejects unsafe integers before checking the configured bounds', () => {
    const range = parsers.range(-1e20, 1e20, { integer: true });
    expect(range.parse(String(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
    expect(range.parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    for (const input of ['9007199254740992', '9007199254740993', '-9007199254740992']) {
      expect(() => range.parse(input)).toThrow('integer is outside the safe range');
    }
  });

  test('keeps fractional bounds inclusive without rounding them', () => {
    const range = parsers.range(1.5, 3.5, { integer: true });
    expect(range.parse('2')).toBe(2);
    expect(range.parse('3')).toBe(3);
    expect(() => range.parse('1')).toThrow('expected an integer from 1.5 to 3.5');
    expect(() => range.parse('4')).toThrow('expected an integer from 1.5 to 3.5');
  });

  test('continues validating range bounds in integer mode', () => {
    expect(() => parsers.range(Number.NaN, 1, { integer: true })).toThrow(RangeError);
    expect(() => parsers.range(0, Number.POSITIVE_INFINITY, { integer: true })).toThrow(RangeError);
    expect(() => parsers.range(2, 1, { integer: true })).toThrow(
      'A parser range must have finite, ascending bounds',
    );
  });

  test('rejects non-boolean integer settings', () => {
    for (const integer of [null, 'true', 1, [], {}]) {
      expect(() => parsers.range(0, 10, { integer: integer as never })).toThrow(
        'Range parser option \'integer\' must be a boolean',
      );
    }
  });

  test('captures the setting when the parser is created', () => {
    const options = { integer: true };
    const range = parsers.range(0, 10, options);
    options.integer = false;
    expect(() => range.parse('1.5')).toThrow('expected an integer');
  });

  test('reports integer and range failures through command parsing', () => {
    const cli = command('serve', {
      args: [option('port', parsers.range(1, 65_535, { integer: true }), { required: true })],
    });
    expect(cli.parse(['--port', '8080'])).toMatchObject({ type: 'value', value: { port: 8080 } });
    expect(cli.tryParse(['--port', '8080.5'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidValue, message: 'invalid value \'8080.5\' for \'--port\': expected an integer' },
    });
    expect(cli.tryParse(['--port', '65536'])).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidValue, message: 'invalid value \'65536\' for \'--port\': expected an integer from 1 to 65535' },
    });
  });
});
