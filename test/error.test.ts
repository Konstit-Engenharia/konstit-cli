import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  flag,
  option,
  parsers,
  positional,
} from '../src/index.js';
import {
  CliError,
  CommandFailure,
  ErrorKind,
} from '../src/result/error.js';

test('CommandFailure accepts a message and a nonzero exit code', () => {
  const failure = new CommandFailure('expected failure');
  expect(failure).toBeInstanceOf(Error);
  expect(failure.name).toBe('CommandFailure');
  expect(failure.message).toBe('expected failure');
  expect(failure.exitCode).toBe(1);
  expect(new CommandFailure('expected failure', 255).exitCode).toBe(255);
  for (const exitCode of [0, -1, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => new CommandFailure('expected failure', exitCode)).toThrow(RangeError);
  }
});

describe('structured CLI errors', () => {
  test('rejects exit codes outside the supported integer range', () => {
    for (const exitCode of [0, -1, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new CliError(ErrorKind.InvalidValue, 'invalid', 'error: invalid\n', exitCode))
        .toThrow(RangeError);
    }
    for (const exitCode of [1, 255]) {
      expect(new CliError(ErrorKind.InvalidValue, 'invalid', 'error: invalid\n', exitCode).exitCode)
        .toBe(exitCode);
    }
  });

  test('reports unknown help subcommands with suggestions and original indices', () => {
    const result = command('tool', { subcommands: [command('run')] })
      .tryParse(['help', 'rn']);
    expect(result).toMatchObject({
      type: 'error',
      error: { kind: ErrorKind.InvalidSubcommand, commandPath: ['tool'], tokenIndex: 1, suggestions: ['run'] },
    });
  });

  test('keeps the legacy constructor and supplies immutable defaults', () => {
    const error = new CliError(ErrorKind.InvalidValue, 'invalid', 'error: invalid\n');

    expect(error.commandPath).toEqual([]);
    expect(error.suggestions).toEqual([]);
    expect(error.relatedArguments).toEqual([]);
    expect(Object.isFrozen(error.commandPath)).toBe(true);
    expect(Object.isFrozen(error.suggestions)).toBe(true);
    expect(Object.isFrozen(error.relatedArguments)).toBe(true);
    expect(error.argumentName).toBeUndefined();
    expect(error.tokenIndex).toBeUndefined();
  });

  test('copies and freezes structured details', () => {
    const commandPath = ['tool', 'run'];
    const suggestions = ['--output'];
    const relatedArguments = ['input'];
    const error = new CliError(
      ErrorKind.UnknownArgument,
      'unknown',
      'error: unknown\n',
      2,
      {
        argumentName: 'output',
        commandPath,
        tokenIndex: 3,
        suggestions,
        relatedArguments,
      },
    );

    commandPath.push('later');
    suggestions.push('--other');
    relatedArguments.push('another');

    expect(error.argumentName).toBe('output');
    expect(error.commandPath).toEqual(['tool', 'run']);
    expect(error.tokenIndex).toBe(3);
    expect(error.suggestions).toEqual(['--output']);
    expect(error.relatedArguments).toEqual(['input']);
    expect(Object.isFrozen(error.commandPath)).toBe(true);
    expect(Object.isFrozen(error.suggestions)).toBe(true);
    expect(Object.isFrozen(error.relatedArguments)).toBe(true);
  });

  test('annotates relation failures with argument names and command paths', () => {
    const cli = command('tool', {
      args: [flag('source'), option('target')],
      requires: [['source', 'target']],
    });
    const result = cli.tryParse(['--source']);

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.argumentName).toBe('target');
      expect(result.error.relatedArguments).toEqual(['source']);
      expect(result.error.commandPath).toEqual(['tool']);
      expect(Object.isFrozen(result.error.relatedArguments)).toBe(true);
    }
  });

  test('reports original indices for nested, inline, clustered, and positional failures', () => {
    const nested = command('tool', {
      args: [flag('verbose')],
      subcommands: [command('run', {
        args: [option('port', parsers.integer)],
      })],
    });

    const separate = nested.tryParse(['--verbose', 'run', '--port', 'invalid']);
    expect(separate.type).toBe('error');
    if (separate.type === 'error') {
      expect(separate.error.kind).toBe(ErrorKind.InvalidValue);
      expect(separate.error.argumentName).toBe('port');
      expect(separate.error.commandPath).toEqual(['tool', 'run']);
      expect(separate.error.tokenIndex).toBe(3);
    }

    const inline = nested.tryParse(['--verbose', 'run', '--port=invalid']);
    expect(inline.type).toBe('error');
    if (inline.type === 'error') {
      expect(inline.error.argumentName).toBe('port');
      expect(inline.error.commandPath).toEqual(['tool', 'run']);
      expect(inline.error.tokenIndex).toBe(2);
    }

    const clustered = command('tool', {
      args: [flag('verbose', { short: 'v' }), flag('quiet', { short: 'q' })],
    }).tryParse(['-v', '-qq']);
    expect(clustered.type).toBe('error');
    if (clustered.type === 'error') {
      expect(clustered.error.kind).toBe(ErrorKind.ArgumentConflict);
      expect(clustered.error.argumentName).toBe('quiet');
      expect(clustered.error.tokenIndex).toBe(1);
    }

    const positionalFailure = command('tool', {
      args: [flag('verbose'), positional('input', parsers.integer)],
    }).tryParse(['--verbose', 'invalid']);
    expect(positionalFailure.type).toBe('error');
    if (positionalFailure.type === 'error') {
      expect(positionalFailure.error.argumentName).toBe('input');
      expect(positionalFailure.error.tokenIndex).toBe(1);
    }
  });

  test('suggests unknown tokens and keeps their original indices', () => {
    const cli = command('tool', {
      subcommands: [command('run', {
        args: [option('port', parsers.integer, { short: 'p' })],
      })],
    });

    const unknownLong = cli.tryParse(['run', '--por']);
    expect(unknownLong.type).toBe('error');
    if (unknownLong.type === 'error') {
      expect(unknownLong.error.kind).toBe(ErrorKind.UnknownArgument);
      expect(unknownLong.error.commandPath).toEqual(['tool', 'run']);
      expect(unknownLong.error.tokenIndex).toBe(1);
      expect(unknownLong.error.suggestions).toEqual(['--port']);
    }

    const unknownShort = cli.tryParse(['run', '-x']);
    expect(unknownShort.type).toBe('error');
    if (unknownShort.type === 'error') {
      expect(unknownShort.error.kind).toBe(ErrorKind.UnknownArgument);
      expect(unknownShort.error.commandPath).toEqual(['tool', 'run']);
      expect(unknownShort.error.tokenIndex).toBe(1);
      expect(unknownShort.error.suggestions).toEqual(['-p']);
    }
  });

  test('omits token indices for environment and config failures', () => {
    const environmentName = 'KONSTIT_ERROR_DIAGNOSTIC_PORT';
    const previous = Bun.env[environmentName];
    const cli = command('tool', {
      args: [option('port', parsers.integer, { env: environmentName })],
    });

    Bun.env[environmentName] = 'invalid';
    try {
      const fromEnvironment = cli.tryParse([]);
      expect(fromEnvironment.type).toBe('error');
      if (fromEnvironment.type === 'error') {
        expect(fromEnvironment.error.kind).toBe(ErrorKind.InvalidValue);
        expect(fromEnvironment.error.argumentName).toBe('port');
        expect(fromEnvironment.error.tokenIndex).toBeUndefined();
      }
    } finally {
      if (previous === undefined) {
        delete Bun.env[environmentName];
      } else {
        Bun.env[environmentName] = previous;
      }
    }

    const fromConfig = cli.tryParse([], {
      config: { values: { port: 'invalid' } },
    });
    expect(fromConfig.type).toBe('error');
    if (fromConfig.type === 'error') {
      expect(fromConfig.error.kind).toBe(ErrorKind.InvalidValue);
      expect(fromConfig.error.argumentName).toBe('port');
      expect(fromConfig.error.tokenIndex).toBeUndefined();
    }
  });

  test('reports unknown nested config keys with inherited globals', () => {
    const profile = option('profile', parsers.string, { global: true });
    const cli = command('tool', {
      args: [profile],
      subcommands: [command('run')],
    });

    const unknownArgument = cli.tryParse(['run'], {
      config: {
        subcommands: { run: { values: { missing: 'value' } } },
      },
    });
    expect(unknownArgument.type).toBe('error');
    if (unknownArgument.type === 'error') {
      expect(unknownArgument.error.kind).toBe(ErrorKind.UnknownArgument);
      expect(unknownArgument.error.commandPath).toEqual(['tool', 'run']);
      expect(unknownArgument.error.message).toContain('unknown config argument \'missing\'');
      expect(unknownArgument.error.tokenIndex).toBeUndefined();
    }

    const unknownSubcommand = cli.tryParse(['run'], {
      config: {
        subcommands: { run: { subcommands: { missing: {} } } },
      },
    });
    expect(unknownSubcommand.type).toBe('error');
    if (unknownSubcommand.type === 'error') {
      expect(unknownSubcommand.error.kind).toBe(ErrorKind.InvalidSubcommand);
      expect(unknownSubcommand.error.commandPath).toEqual(['tool', 'run']);
      expect(unknownSubcommand.error.message).toContain('unknown config subcommand \'missing\'');
      expect(unknownSubcommand.error.tokenIndex).toBeUndefined();
    }
  });

  test('reports all missing required arguments as related metadata', () => {
    const cli = command('tool', {
      args: [
        option('source', parsers.string, { required: true }),
        option('target', parsers.string, { required: true }),
        positional('input', parsers.string, { required: true }),
      ],
    });
    const result = cli.tryParse([]);

    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.error.kind).toBe(ErrorKind.MissingRequiredArgument);
      expect(result.error.argumentName).toBe('source');
      expect(result.error.relatedArguments).toEqual(['target', 'input']);
      expect(result.error.commandPath).toEqual(['tool']);
      expect(result.error.tokenIndex).toBeUndefined();
    }
  });

  test('locates ambiguous subcommands in normal, help, and option-value parsing', () => {
    const cli = command('tool', {
      subcommands: [command('run', {
        inferSubcommands: true,
        args: [option('tag', parsers.string, { numArgs: { min: 0 } })],
        subcommands: [command('start'), command('status')],
      })],
    });
    for (const argv of [['run', 'sta'], ['help', 'run', 'sta'], ['run', '--tag', 'x', 'sta']]) {
      const result = cli.tryParse(argv);
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.error.kind).toBe(ErrorKind.InvalidSubcommand);
        expect(result.error.commandPath).toEqual(['tool', 'run']);
        expect(result.error.tokenIndex).toBe(argv.length - 1);
        expect(result.error.suggestions).toEqual(['start', 'status']);
      }
    }
    const conflicting = command('tool', {
      argsConflictWithSubcommands: true,
      args: [flag('local')],
      subcommands: [command('run')],
    }).tryParse(['--local', 'run']);
    expect(conflicting).toMatchObject({
      type: 'error',
      error: { argumentName: 'local', tokenIndex: 0 },
    });
  });

  test('renders sanitized deprecation annotations in help', () => {
    const cli = command('tool', {
      deprecated: 'Use tool-new.\n',
      args: [option('old', parsers.string, { deprecated: 'Use --current.' })],
      subcommands: [command('legacy', {
        about: 'Legacy mode',
        deprecated: 'Use run instead.',
      })],
    });
    const help = cli.renderHelp();

    expect(help).toContain('[deprecated: Use tool-new.\\n]');
    expect(help).toContain('[deprecated: Use --current.]');
    expect(help).toContain('Legacy mode [deprecated: Use run instead.]');
  });
});
