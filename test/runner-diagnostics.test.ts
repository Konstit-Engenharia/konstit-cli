import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  CommandFailure,
  option,
  parsers,
} from '../src';
import { invoke } from '../src/testing';

test('exposes the caller signal to handlers and supports cooperative cancellation', async () => {
  const controller = new AbortController();
  const seen: AbortSignal[] = [];
  const cli = command('work', {
    handler: async (_args, context) => {
      seen.push(context.signal);
      controller.abort();
      await Promise.resolve();
      return context.signal.aborted ? 7 : 0;
    },
  });

  expect(await invoke(cli, [], { signal: controller.signal })).toMatchObject({ exitCode: 7 });
  expect(seen).toEqual([controller.signal]);
});

test('keeps an already aborted signal available for a handler to inspect', async () => {
  const controller = new AbortController();
  controller.abort();
  let aborted = false;
  const cli = command('work', {
    handler: (_args, context) => {
      aborted = context.signal.aborted;
    },
  });

  expect(await cli.run({ argv: [], signal: controller.signal, stdout: () => {} })).toBe(0);
  expect(aborted).toBe(true);
});

test('runParsed uses the supplied signal and preserves redaction in JSON diagnostics', async () => {
  const controller = new AbortController();
  const cli = command('tool', {
    args: [option('token', parsers.integer, { sensitive: true })],
    handler: (_args, { signal }) => {
      expect(signal).toBe(controller.signal);
    },
  });
  expect(await cli.runParsed(cli.parse([]), { signal: controller.signal })).toBe(0);

  const errors: string[] = [];
  const failure = cli.tryParse(['--token', 'secret']);
  const code = await cli.runParsed(failure, {
    color: true,
    diagnostics: 'json',
    stderr: (chunk) => errors.push(chunk),
  });
  expect(code).toBe(2);
  expect(errors).toHaveLength(1);
  expect(errors[0]).not.toContain('secret');
  expect(JSON.parse(errors.join(''))).toMatchObject({
    type: 'parse-error',
    kind: 'invalid-value',
    argumentName: 'token',
    tokenIndex: 1,
  });
});

test('serializes parser failures as one JSON diagnostic', async () => {
  const cli = command('tool', {
    args: [option('port', parsers.integer)],
  });
  const result = await invoke(cli, ['--unknown'], { diagnostics: 'json' });
  const diagnostic = JSON.parse(result.stderr) as Record<string, unknown>;

  expect(result.exitCode).toBe(2);
  expect(diagnostic).toMatchObject({
    type: 'parse-error',
    kind: 'unknown-argument',
    exitCode: 2,
    commandPath: ['tool'],
  });
  expect(typeof diagnostic.message).toBe('string');

  const stderr: string[] = [];
  expect(
    await cli.run({
      argv: ['--unknown'],
      diagnostics: 'json',
      parseErrorExitCode: 17,
      stdout: () => {},
      stderr: (chunk) => stderr.push(chunk),
    }),
  ).toBe(17);
  expect(JSON.parse(stderr.join(''))).toMatchObject({ exitCode: 17 });
});

test('serializes warnings and expected command failures as JSON diagnostics', async () => {
  const cli = command('tool', {
    deprecated: 'Use another command.',
    args: [option('port', parsers.integer, { deprecated: 'Use --listen.' })],
    handler: () => {
      throw new CommandFailure('Cannot connect.', 9);
    },
  });
  const result = await invoke(cli, ['--port', '80'], { diagnostics: 'json' });
  const diagnostics = result.stderr.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

  expect(result.exitCode).toBe(9);
  expect(diagnostics).toHaveLength(3);
  expect(diagnostics[0]).toMatchObject({ type: 'warning', target: 'command', name: 'tool' });
  expect(diagnostics[1]).toMatchObject({ type: 'warning', target: 'argument', name: 'port' });
  expect(diagnostics[2]).toMatchObject({
    type: 'command-failure',
    message: 'Cannot connect.',
    exitCode: 9,
    commandPath: ['tool'],
  });
});

test('onWarning suppresses JSON warning output while retaining the callback', async () => {
  const warnings: string[] = [];
  const cli = command('tool', {
    deprecated: 'Use another command.',
    handler: () => 0,
  });
  expect(
    await cli.run({
      argv: [],
      diagnostics: 'json',
      stdout: () => {},
      onWarning: (warning) => warnings.push(warning.message),
    }),
  ).toBe(0);
  expect(warnings).toEqual(['Use another command.']);
});
