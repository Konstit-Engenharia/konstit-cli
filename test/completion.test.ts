import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  completionShells,
  flag,
  isCompletionShell,
  option,
  parsers,
  positional,
} from '../src';
import {
  dynamicCompletionEnvironment,
  generateCompletion,
  type CompletionShell,
} from '../src/completion';

const cli = command('demo', {
  version: '1.0.0',
  args: [
    option('mode', parsers.enum(['dev', 'prod']), { short: 'm' }),
    option('config', parsers.string, { valueHint: 'file' }),
    flag('verbose', { short: 'v' }),
    positional('output', parsers.string, { valueHint: 'directory' }),
    option('secret', parsers.string, { hide: true }),
  ],
  subcommands: [
    command('run', {
      about: 'Run the application',
      args: [option('target', parsers.enum(['web', 'server']))],
    }),
    command('internal', {
      hide: true,
      args: [flag('unsafe')],
    }),
  ],
});

const bash = Bun.which('bash');
const zsh = Bun.which('zsh');
const bashTest = test.skipIf(bash === null);
const zshTest = test.skipIf(zsh === null);

describe('completion generation', () => {
  test('supports the common shell set', () => {
    expect(completionShells).toEqual(['bash', 'zsh', 'fish', 'powershell']);
    expect(isCompletionShell('bash')).toBe(true);
    expect(isCompletionShell('nu')).toBe(false);

    for (const shell of completionShells) {
      const script = generateCompletion(cli, shell);
      expect(script.endsWith('\n')).toBe(true);
      expect(script).toContain('demo');
      expect(script).toContain('--mode');
      expect(script).toContain('dev');
      expect(script).toContain('run');
      expect(script).toContain('--target');
      expect(script).toContain('--secret');
      expect(script).not.toContain('internal');
    }
  });

  test('provides a standalone function and executable override', () => {
    const direct = generateCompletion(cli, 'bash', { executable: 'demo-cli' });
    expect(direct).toContain('complete -F _bun_clap_demo_cli \'demo-cli\'');
  });

  test('includes inherited globals and visible subcommand aliases', () => {
    const globalCli = command('tool', {
      args: [flag('verbose', { global: true })],
      subcommands: [
        command('serve', {
          visibleAliases: ['server'],
          aliases: ['s'],
        }),
      ],
    });
    const script = generateCompletion(globalCli, 'bash');
    expect(script).toContain('--verbose');
    expect(script).toContain('server');
    expect(script).not.toContain('\'s\'');
  });

  test('rejects invalid runtime shell and executable input', () => {
    expect(() => generateCompletion(cli, 'nu' as 'bash')).toThrow('Unsupported');
    expect(() => generateCompletion(cli, 'bash', { executable: '-bad' })).toThrow(
      'Invalid completion executable',
    );
  });

  test('keeps parser completion metadata immutable', () => {
    const parser = parsers.enum(['one', 'two']);
    expect(parser.completions).toEqual(['one', 'two']);
    expect(Object.isFrozen(parser.completions)).toBe(true);
    expect(parsers.boolean.completions).toEqual(['true', 'false']);
  });

  test('generates opt-in dynamic scripts for every supported shell', () => {
    for (const shell of completionShells) {
      const script = generateCompletion(cli, shell, { dynamic: true });
      expect(script).toContain(dynamicCompletionEnvironment);
      expect(script).not.toContain('--mode');
    }
  });

  bashTest('Bash dynamic output has valid syntax', () => {
    expect(
      checkSyntax('bash', generateCompletion(cli, 'bash', { dynamic: true })).exitCode,
    ).toBe(0);
  });

  zshTest('Zsh dynamic output has valid syntax', () => {
    expect(
      checkSyntax('zsh', generateCompletion(cli, 'zsh', { dynamic: true })).exitCode,
    ).toBe(0);
  });

  test('writes dynamic provider candidates through the shell protocol', async () => {
    const dynamicCli = command('packages', {
      args: [
        option('package', parsers.string, {
          complete: async () => ['react', 'redis', 'vue'],
        }),
      ],
    });
    let output = '';
    expect(
      await withDynamicCompletion(() =>
        dynamicCli.run({
          argv: ['--package', 're'],
          stdout: (text) => {
            output += text;
          },
        })
      ),
    ).toBe(0);
    expect(output).toBe('7265616374\t\n7265646973\t\n');
  });

  bashTest('Bash dynamic scripts forward the incomplete argv', () => {
    const script = `${generateCompletion(cli, 'bash', { dynamic: true })}
demo() {
  [[ "$KONSTIT_CLI_COMPLETE" == 1 ]] || return 1
  local value
  for value in "$@"; do printf '%s\\t%s\n' "$(printf '%s' "$value" | xxd -p)" ''; done
}
COMP_WORDS=(demo run --target we)
COMP_CWORD=3
__konstit_cli_demo_dynamic
printf 'DYNAMIC:%s\n' "\${COMPREPLY[*]}"
`;
    const result = runShell('bash', script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DYNAMIC:run --target we');
  });

  test('preserves dynamic descriptions in shell protocols', async () => {
    const described = command('packages', {
      args: [
        option('package', parsers.string, {
          complete: () => [
            { value: 'react', description: 'UI library' },
          ],
        }),
      ],
    });
    let output = '';
    await withDynamicCompletion(() =>
      described.run({
        argv: ['--package', ''],
        stdout: (text) => {
          output += text;
        },
      })
    );
    expect(output).toBe('7265616374\t5549206c696272617279\n');

    expect(generateCompletion(described, 'zsh', { dynamic: true }))
      .toContain('compadd -Q -d descriptions');
    expect(generateCompletion(described, 'fish', { dynamic: true }))
      .toContain('printf \'%s\\t%s\\n\'');
    expect(generateCompletion(described, 'powershell', { dynamic: true }))
      .toContain('\'ParameterValue\', $description');
  });
});

describe('generated shell scripts', () => {
  bashTest('Bash output has valid syntax', () => {
    const result = checkSyntax('bash', generateCompletion(cli, 'bash'));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  bashTest('Bash completes option values, inline values, and nested options', () => {
    const script = `${generateCompletion(cli, 'bash')}
COMP_WORDS=(demo --mode "")
COMP_CWORD=2
_bun_clap_demo
printf 'VALUES:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(demo --mode=d)
COMP_CWORD=1
_bun_clap_demo
printf 'INLINE:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(demo run --t)
COMP_CWORD=2
_bun_clap_demo
printf 'NESTED:%s\n' "\${COMPREPLY[*]}"
`;
    const result = runShell('bash', script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('VALUES:dev prod');
    expect(result.stdout).toContain('INLINE:--mode=dev');
    expect(result.stdout).toContain('NESTED:--target');
  });

  bashTest('Bash tracks multi-value options, require-equals, and positional indexes', () => {
    const arityCli = command('arity', {
      args: [
        option('pair', parsers.enum(['first', 'second']), { numArgs: 2 }),
        option('equal', parsers.enum(['dev', 'prod']), { requireEquals: true }),
        positional('source', parsers.enum(['alpha'])),
        positional('target', parsers.enum(['beta'])),
      ],
    });
    const script = `${generateCompletion(arityCli, 'bash')}
COMP_WORDS=(arity --pair first s)
COMP_CWORD=3
_bun_clap_arity
printf 'PAIR:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(arity --pair first second "")
COMP_CWORD=4
_bun_clap_arity
printf 'AFTER_PAIR:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(arity --equal "")
COMP_CWORD=2
_bun_clap_arity
printf 'REQUIRE_EQUALS:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(arity --equal=d)
COMP_CWORD=1
_bun_clap_arity
printf 'INLINE_EQUALS:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(arity alpha "")
COMP_CWORD=2
_bun_clap_arity
printf 'SECOND_POSITIONAL:%s\n' "\${COMPREPLY[*]}"
`;
    const result = runShell('bash', script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('PAIR:second');
    expect(result.stdout).toContain('AFTER_PAIR:alpha');
    expect(result.stdout).toContain('REQUIRE_EQUALS:alpha');
    expect(result.stdout).toContain('INLINE_EQUALS:--equal=dev');
    expect(result.stdout).toContain('SECOND_POSITIONAL:beta');
    expect(result.stdout).not.toContain('SECOND_POSITIONAL:alpha');
  });

  bashTest('Bash scans delimited, attached, ranged, and unbounded option values', () => {
    const scannerCli = command('scanner', {
      args: [
        flag('verbose', { short: 'v' }),
        option('pair', parsers.enum(['first', 'second']), {
          short: 'p',
          numArgs: 2,
          valueDelimiter: ',',
        }),
        option('range', parsers.enum(['first', 'second']), {
          numArgs: { min: 1, max: 2 },
        }),
        option('many', parsers.enum(['first', 'second']), {
          numArgs: { min: 1 },
        }),
        flag('force'),
        positional('target', parsers.enum(['alpha'])),
      ],
      subcommands: [
        command('run', { args: [flag('child-force')] }),
      ],
    });
    const script = `${generateCompletion(scannerCli, 'bash')}
COMP_WORDS=(scanner --pair=first,second "")
COMP_CWORD=2
_bun_clap_scanner
printf 'DELIMITED:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner -pfirst s)
COMP_CWORD=2
_bun_clap_scanner
printf 'SHORT_ATTACHED:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner -vpfirst s)
COMP_CWORD=2
_bun_clap_scanner
printf 'SHORT_CLUSTER:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner -vpse)
COMP_CWORD=1
_bun_clap_scanner
printf 'CURRENT_CLUSTER:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner --range first --h)
COMP_CWORD=3
_bun_clap_scanner
printf 'RANGE_OPTION_STOP:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner --range first run --c)
COMP_CWORD=4
_bun_clap_scanner
printf 'RANGE_SUBCOMMAND_STOP:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner --many first --f)
COMP_CWORD=3
_bun_clap_scanner
printf 'UNBOUNDED_OPTION_STOP:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(scanner --many first run --c)
COMP_CWORD=4
_bun_clap_scanner
printf 'UNBOUNDED_SUBCOMMAND_STOP:%s\n' "\${COMPREPLY[*]}"
`;
    const result = runShell('bash', script);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DELIMITED:alpha');
    expect(result.stdout).toContain('SHORT_ATTACHED:second');
    expect(result.stdout).toContain('SHORT_CLUSTER:second');
    expect(result.stdout).toContain('CURRENT_CLUSTER:-vpsecond');
    expect(result.stdout).toContain('RANGE_OPTION_STOP:--help');
    expect(result.stdout).toContain('RANGE_SUBCOMMAND_STOP:--child-force');
    expect(result.stdout).toContain('UNBOUNDED_OPTION_STOP:--force');
    expect(result.stdout).toContain('UNBOUNDED_SUBCOMMAND_STOP:--child-force');
  });

  bashTest('Bash matches positional token policy, logical arity, and inferred commands', () => {
    const positionalCli = command('positionals', {
      args: [
        positional('literal', parsers.enum(['--literal']), {
          allowHyphenValues: true,
        }),
        positional('target', parsers.enum(['beta'])),
        flag('known'),
      ],
    });
    const positionalScript = `${generateCompletion(positionalCli, 'bash')}
COMP_WORDS=(positionals --literal "")
COMP_CWORD=2
_bun_clap_positionals
printf 'HYPHEN_PRIOR:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(positionals --literal)
COMP_CWORD=1
_bun_clap_positionals
printf 'HYPHEN_CURRENT:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(positionals --known "")
COMP_CWORD=2
_bun_clap_positionals
printf 'DECLARED_OPTION:%s\n' "\${COMPREPLY[*]}"
`;
    const positionalResult = runShell('bash', positionalScript);
    expect(positionalResult.exitCode).toBe(0);
    expect(positionalResult.stdout).toContain('HYPHEN_PRIOR:beta');
    expect(positionalResult.stdout).toContain('HYPHEN_CURRENT:--literal');
    expect(positionalResult.stdout).toContain('DECLARED_OPTION:--literal');

    const logicalCli = command('logical', {
      args: [
        positional('pair', parsers.enum(['first', 'second']), {
          numArgs: 2,
          valueDelimiter: ',',
        }),
        positional('target', parsers.enum(['beta'])),
      ],
    });
    const logicalScript = `${generateCompletion(logicalCli, 'bash')}
COMP_WORDS=(logical first,second "")
COMP_CWORD=2
_bun_clap_logical
printf 'POSITIONAL_DELIMITER:%s\n' "\${COMPREPLY[*]}"
`;
    const logicalResult = runShell('bash', logicalScript);
    expect(logicalResult.exitCode).toBe(0);
    expect(logicalResult.stdout).toContain('POSITIONAL_DELIMITER:beta');

    const inferredCli = command('tool', {
      inferSubcommands: true,
      args: [
        option('values', parsers.string, { numArgs: { min: 1, max: 3 } }),
      ],
      subcommands: [
        command('status', { args: [flag('child')] }),
      ],
    });
    const inferredScript = `${generateCompletion(inferredCli, 'bash')}
COMP_WORDS=(tool --values one sta --c)
COMP_CWORD=4
_bun_clap_tool
printf 'INFERRED_STOP:%s\n' "\${COMPREPLY[*]}"
`;
    const inferredResult = runShell('bash', inferredScript);
    expect(inferredResult.exitCode).toBe(0);
    expect(inferredResult.stdout).toContain('INFERRED_STOP:--child');
  });

  bashTest('Bash matches exact inference, repeatable positionals, and terminators', () => {
    const inferredCli = command('exact', {
      inferSubcommands: true,
      args: [
        option('values', parsers.string, { numArgs: { min: 1, max: 3 } }),
      ],
      subcommands: [
        command('foo', { args: [flag('exact-child')] }),
        command('foobar', { args: [flag('long-child')] }),
      ],
    });
    const inferredScript = `${generateCompletion(inferredCli, 'bash')}
COMP_WORDS=(exact --values one foo --e)
COMP_CWORD=4
_bun_clap_exact
printf 'EXACT_INFERENCE:%s\n' "\${COMPREPLY[*]}"
`;
    const inferredResult = runShell('bash', inferredScript);
    expect(inferredResult.exitCode).toBe(0);
    expect(inferredResult.stdout).toContain('EXACT_INFERENCE:--exact-child');
    expect(inferredResult.stdout).not.toContain('--long-child');

    const repeatCli = command('repeat', {
      args: [
        positional('items', parsers.enum(['one', 'two']), {
          numArgs: 2,
          repeatable: true,
        }),
      ],
    });
    const repeatScript = `${generateCompletion(repeatCli, 'bash')}
COMP_WORDS=(repeat one two "")
COMP_CWORD=3
_bun_clap_repeat
printf 'REPEATABLE:%s\n' "\${COMPREPLY[*]}"
`;
    const repeatResult = runShell('bash', repeatScript);
    expect(repeatResult.exitCode).toBe(0);
    expect(repeatResult.stdout).toContain('REPEATABLE:one two');

    const terminatorCli = command('terminator', {
      args: [
        positional('items', parsers.string, {
          numArgs: { min: 1, max: 3 },
          valueTerminator: ';',
        }),
        positional('target', parsers.enum(['beta'])),
      ],
    });
    const terminatorScript = `${generateCompletion(terminatorCli, 'bash')}
COMP_WORDS=(terminator one ';' "")
COMP_CWORD=3
_bun_clap_terminator
printf 'TERMINATOR:%s\n' "\${COMPREPLY[*]}"
`;
    const terminatorResult = runShell('bash', terminatorScript);
    expect(terminatorResult.exitCode).toBe(0);
    expect(terminatorResult.stdout).toContain('TERMINATOR:beta');
  });

  bashTest('Bash parses hidden arguments and exact built-ins without displaying them', () => {
    const hiddenCli = command('hidden', {
      args: [
        option('secret', parsers.string, { numArgs: 2, hide: true }),
        positional('internal', parsers.string, { hide: true }),
        positional('target', parsers.enum(['beta'])),
      ],
    });
    const hiddenScript = `${generateCompletion(hiddenCli, 'bash')}
COMP_WORDS=(hidden --s)
COMP_CWORD=1
_bun_clap_hidden
printf 'HIDDEN_CANDIDATE:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(hidden --secret one two internal "")
COMP_CWORD=5
_bun_clap_hidden
printf 'HIDDEN_PARSE:%s\n' "\${COMPREPLY[*]}"
`;
    const hiddenResult = runShell('bash', hiddenScript);
    expect(hiddenResult.exitCode).toBe(0);
    expect(hiddenResult.stdout).toContain('HIDDEN_CANDIDATE:\n');
    expect(hiddenResult.stdout).toContain('HIDDEN_PARSE:beta');
    expect(generateCompletion(hiddenCli, 'zsh')).toContain('0:1');
    const hiddenFish = generateCompletion(hiddenCli, 'fish');
    expect(hiddenFish).toContain('\'0:1\'');
    expect(hiddenFish).not.toContain('-l \'secret\'');
    const hiddenPowerShell = generateCompletion(hiddenCli, 'powershell');
    expect(hiddenPowerShell).toContain('\'0:1\'');
    expect(hiddenPowerShell).not.toContain('Value = \'--secret\'');

    const builtinCli = command('builtin', {
      version: '1.0.0',
      args: [
        positional(
          'literal',
          parsers.enum(['--help=x', '--version=x', '-hx', '-Vx']),
          { allowHyphenValues: true },
        ),
        positional('target', parsers.enum(['beta'])),
      ],
    });
    const builtinScript = `${generateCompletion(builtinCli, 'bash')}
for token in --help=x --version=x -hx -Vx; do
  COMP_WORDS=(builtin "$token" "")
  COMP_CWORD=2
  _bun_clap_builtin
  printf 'SUFFIXED_BUILTIN:%s:%s\n' "$token" "\${COMPREPLY[*]}"
done
COMP_WORDS=(builtin --help "")
COMP_CWORD=2
_bun_clap_builtin
printf 'EXACT_BUILTIN:%s\n' "\${COMPREPLY[*]}"
COMP_WORDS=(builtin -- --h)
COMP_CWORD=2
_bun_clap_builtin
printf 'AFTER_TERMINATOR:%s\n' "\${COMPREPLY[*]}"
`;
    const builtinResult = runShell('bash', builtinScript);
    expect(builtinResult.exitCode).toBe(0);
    for (const token of ['--help=x', '--version=x', '-hx', '-Vx']) {
      expect(builtinResult.stdout).toContain(`SUFFIXED_BUILTIN:${token}:beta`);
    }
    expect(builtinResult.stdout).toContain('EXACT_BUILTIN:--help=x --version=x -hx -Vx');
    expect(builtinResult.stdout).toContain('AFTER_TERMINATOR:--help=x');
  });

  test('encodes control delimiters in static shell metadata', () => {
    const tab = command('tab', {
      args: [option('value', parsers.string, { valueDelimiter: '\t' })],
    });
    const newline = command('newline', {
      args: [option('value', parsers.string, { valueDelimiter: '\n' })],
    });
    const nul = command('nul', {
      args: [option('value', parsers.string, { valueDelimiter: '\0' })],
    });
    for (const shell of completionShells) {
      expect(generateCompletion(tab, shell)).not.toContain('\t1\t\t0');
      expect(generateCompletion(newline, shell)).not.toContain('\n1\n\n0');
      expect(generateCompletion(nul, shell)).not.toContain('\0');
    }
    expect(generateCompletion(tab, 'bash')).toContain('\t09\t');
    expect(generateCompletion(newline, 'bash')).toContain('\t0a\t');
    expect(generateCompletion(nul, 'bash')).toContain('\t00\t');
  });

  zshTest('Zsh output has valid syntax', () => {
    const result = checkSyntax('zsh', generateCompletion(cli, 'zsh'));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  const optionTerminatorCli = command('argv-state', {
    args: [
      option('values', parsers.enum(['one', 'two']), {
        short: 'v',
        numArgs: { min: 1 },
        valueTerminator: 'END',
      }),
      positional('target', parsers.enum(['next'])),
      positional('final', parsers.enum(['final'])),
    ],
  });
  const trailingPositionalCli = command('argv-state', {
    subcommands: [command('delegate', {
      args: [positional('rest', parsers.enum(['payload', 'run', 'tail']), { trailingVarArg: true })],
      subcommands: [command('run', {
        args: [positional('child', parsers.enum(['child']))],
      })],
    })],
  });
  const literalPositionalCli = command('argv-state', {
    args: [
      option('config', parsers.enum(['wrapper']), { short: 'c' }),
      positional('program'),
      positional('args', parsers.enum(['--config-delegate', 'payload']), { trailingVarArg: true, literal: true }),
    ],
  });
  const scalarPositionalCli = command('argv-state', {
    args: [positional('path', parsers.enum(['first', 'payload']), {
      trailingVarArg: true,
      literal: true,
      joinWith: ' ',
      output: 'scalar',
    })],
  });
  const staticStateCli = command('argv-state', {
    args: [
      option('check', parsers.string, {
        short: 'c',
        aliases: ['verify'],
        numArgs: 0,
      }),
      flag('verbose', { short: 'v' }),
      option('target', parsers.enum(['web', 'server']), {
        short: 't',
        numArgs: { min: 0, max: 1 },
      }),
      option('hidden', parsers.string, {
        short: 'x',
        aliases: ['concealed'],
        hide: true,
      }),
      positional('first', parsers.enum(['start'])),
      positional('second', parsers.enum(['next'])),
    ],
  });

  for (const shell of completionShells) {
    const executable = shell === 'powershell' ? 'pwsh' : shell;
    const shellTest = test.skipIf(Bun.which(executable) === null);
    shellTest(`${shell} consumes the option terminator and advances to the next positional`, () => {
      const script = generateCompletion(optionTerminatorCli, shell);
      for (const optionWords of [['--values', 'one'], ['--values=one'], ['-vone']]) {
        const result = completeStaticShell(shell, script, [...optionWords, 'END', 'next']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('final');
      }
    }, { timeout: 20_000 });

    shellTest(`${shell} treats subcommand names as values after a trailing positional starts`, () => {
      const script = generateCompletion(trailingPositionalCli, shell);
      const result = completeStaticShell(shell, script, ['delegate', 'payload', 'run']);
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().split(/\r?\n/).sort()).toEqual(['payload', 'run', 'tail']);
    });

    shellTest(`${shell} completes a literal trailing positional before recognizing the first flag`, () => {
      const script = generateCompletion(literalPositionalCli, shell);
      const first = completeStaticShell(shell, script, ['node'], '--con');
      expect(first.stderr).toBe('');
      expect(first.exitCode).toBe(0);
      const firstCandidates = first.stdout.trim().split(/\r?\n/);
      expect(firstCandidates).toContain('--config-delegate');
      expect(firstCandidates).not.toContain('--config');

      const remaining = completeStaticShell(shell, script, ['node', '--config']);
      expect(remaining.stderr).toBe('');
      expect(remaining.exitCode).toBe(0);
      expect(remaining.stdout.trim().split(/\r?\n/).sort()).toEqual(['--config-delegate', 'payload']);
    }, { timeout: 20_000 });

    shellTest(`${shell} keeps completing a scalar joined positional after the first token`, () => {
      const result = completeStaticShell(shell, generateCompletion(scalarPositionalCli, shell), ['first']);
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().split(/\r?\n/).sort()).toEqual(['first', 'payload']);
    });

    shellTest(`${shell} keeps zero-arity and hidden options out of value transitions`, () => {
      const script = generateCompletion(staticStateCli, shell);
      for (const optionWords of [['--check'], ['--check='], ['--target='], ['-t=']]) {
        const result = completeStaticShell(shell, script, [...optionWords, 'start']);
        expect(result.stderr).toBe('');
        expect(result.exitCode).toBe(0);
        expect(result.stdout.trim()).toBe('next');
      }
      const hiddenAlias = completeStaticShell(shell, script, ['--concealed', 'start']);
      expect(hiddenAlias.stderr).toBe('');
      expect(hiddenAlias.exitCode).toBe(0);
      expect(hiddenAlias.stdout.trim()).toBe('start');
    }, { timeout: 20_000 });

    shellTest(`${shell} stops a short cluster at an unknown member`, () => {
      const result = completeStaticShell(
        shell,
        generateCompletion(staticStateCli, shell),
        ['-zt', 'start'],
      );
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('next');
    }, { timeout: 20_000 });

    shellTest(`${shell} stops current short-cluster value lookup at an unknown member`, () => {
      const result = completeStaticShell(
        shell,
        generateCompletion(staticStateCli, shell),
        [],
        '-ztw',
      );
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('-ztweb');
      expect(result.stdout).not.toContain('-ztserver');
    }, { timeout: 20_000 });
  }

  test('Fish and PowerShell use their native registration interfaces', () => {
    const fish = generateCompletion(cli, 'fish');
    expect(fish).toContain('complete -c \'demo\'');
    expect(fish).toContain('__fish_complete_directories');

    const powerShell = generateCompletion(cli, 'powershell');
    expect(powerShell).toContain('Register-ArgumentCompleter -Native');
    expect(powerShell).toContain('System.Management.Automation.CompletionResult');
    expect(powerShell).toContain('[Convert]::ToByte');
    expect(powerShell).not.toContain('FromHexString');
    expect(powerShell).toContain('\'0:-m\' { return $true }');
    expect(powerShell).toContain('\'0:--mode\' { return $true }');
    expect(powerShell).toContain('\'0:-h\' { return $true }');
    expect(powerShell).toContain('\'0:--help\' { return $true }');
    expect(powerShell).toContain('\'0:-V\' { return $true }');
    expect(powerShell).toContain('\'0:--version\' { return $true }');
    expect(powerShell).not.toMatch(
      /^\s+'[^'\r\n]+',\s+'[^'\r\n]+'\s+\{ return \$true \}$/m,
    );

    expect(fish).toContain('else if test $positional_allow_negative -eq 1');
    expect(fish).toContain('test $positional_allow_hyphen -eq 1');

    const dynamicPowerShell = generateCompletion(cli, 'powershell', { dynamic: true });
    expect(dynamicPowerShell).toContain('[Convert]::ToByte');
    expect(dynamicPowerShell).not.toContain('FromHexString');
  });

  for (const shell of ['fish', 'pwsh'] as const) {
    const executable = Bun.which(shell);
    const required = shell === 'pwsh' && process.platform === 'win32';
    test.skipIf(executable === null && !required)(
      `${shell} output has valid syntax when installed`,
      () => {
        if (executable === null) {
          throw new Error(`${shell} is required on ${process.platform}`);
        }
        const completionShell = shell === 'pwsh' ? 'powershell' : 'fish';
        const result = checkSyntax(shell, generateCompletion(cli, completionShell));
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe('');
      },
      shell === 'pwsh' ? { timeout: 20_000 } : undefined,
    );
  }
});

function completeStaticShell(
  shell: CompletionShell,
  script: string,
  prefix: readonly string[],
  current = '',
) {
  const hasCurrentWord = current.length > 0;
  const words = ['argv-state', ...prefix, ...(hasCurrentWord ? [current] : [])];
  switch (shell) {
    case 'bash': {
      const compWords = hasCurrentWord ? 'COMP_WORDS=("$@")' : 'COMP_WORDS=("$@" "")';
      const compCword = hasCurrentWord ? 'COMP_CWORD=$(($# - 1))' : 'COMP_CWORD=$#';
      return runShell(
        ['bash', '--noprofile', '--norc', '-s', '--', ...words],
        [
          script,
          compWords,
          compCword,
          '_bun_clap_argv_state',
          `printf "%s\\n" "\${COMPREPLY[@]}"`,
        ].join('\n'),
      );
    }
    case 'zsh': {
      const zshWords = hasCurrentWord ? 'words=("$@")' : 'words=("$@" "")';
      const zshCurrent = hasCurrentWord ? 'CURRENT=$#' : 'CURRENT=$(($# + 1))';
      return runShell(
        ['zsh', '-f', '-s', '--', ...words],
        [
          'compdef() { :; }',
          'compadd() { while (( $# )) && [[ "$1" != -- ]]; do shift; done; shift; print -rl -- "$@"; }',
          script,
          zshWords,
          zshCurrent,
          '_bun_clap_argv_state',
        ].join('\n'),
      );
    }
    case 'fish': {
      const commandText = [
        script,
        `complete --do-complete (string join " " -- $argv)${hasCurrentWord ? '' : '" "'}`,
      ].join('\n');
      return runShell(['fish', '--no-config', '-c', commandText, '--', ...words], '');
    }
    case 'powershell': {
      const input = words.join(' ').replaceAll('\'', '\'\'');
      const line = hasCurrentWord ? input : `${input} `;
      const currentValue = current.replaceAll('\'', '\'\'');
      const completerCurrent = hasCurrentWord ? `'${currentValue}'` : '""';
      const commandText = [
        'function Register-ArgumentCompleter {',
        '  param([switch]$Native, [string]$CommandName, [scriptblock]$ScriptBlock)',
        '  $script:completer = $ScriptBlock',
        '}',
        script,
        `$line = '${line}'`,
        '$tokens = $null; $errors = $null',
        '$ast = [System.Management.Automation.Language.Parser]::ParseInput($line, [ref]$tokens, [ref]$errors)',
        `& $script:completer ${completerCurrent} $ast.EndBlock.Statements[0].PipelineElements[0] $line.Length | Select-Object -ExpandProperty CompletionText`,
      ].join('\n');
      return runShell(['pwsh', '-NoProfile', '-NonInteractive', '-Command', commandText], '');
    }
  }
}

function checkSyntax(shell: 'bash' | 'zsh' | 'fish' | 'pwsh', script: string) {
  const args = shell === 'fish'
    ? [shell, '--no-execute']
    : shell === 'pwsh'
    ? [shell, '-NoProfile', '-NonInteractive', '-Command', '-']
    : [shell, '-n'];
  return runShell(args, script);
}

function runShell(command: string | readonly string[], script: string) {
  const args = typeof command === 'string' ? [command] : [...command];
  const result = Bun.spawnSync(args, {
    stdin: Buffer.from(script),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

async function withDynamicCompletion<Result>(
  callback: () => Promise<Result>,
): Promise<Result> {
  const previous = Bun.env[dynamicCompletionEnvironment];
  Bun.env[dynamicCompletionEnvironment] = '1';
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete Bun.env[dynamicCompletionEnvironment];
    } else {
      Bun.env[dynamicCompletionEnvironment] = previous;
    }
  }
}
