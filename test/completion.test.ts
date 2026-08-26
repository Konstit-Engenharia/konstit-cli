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
} from '../src/completion';

const cli = command('demo')
  .version('1.0.0')
  .arg(option('mode', parsers.enum(['dev', 'prod'])).short('m'))
  .arg(option('config').valueHint('file'))
  .arg(flag('verbose').short('v'))
  .arg(positional('output').valueHint('directory'))
  .arg(option('secret').hide())
  .subcommand(
    command('run')
      .about('Run the application')
      .arg(option('target', parsers.enum(['web', 'server']))),
  )
  .subcommand(command('internal').hide().arg(flag('unsafe')));

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
    const globalCli = command('tool')
      .arg(flag('verbose').global())
      .subcommand(command('serve').visibleAlias('server').alias('s'));
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
    expect(
      checkSyntax('bash', generateCompletion(cli, 'bash', { dynamic: true })).exitCode,
    ).toBe(0);
    expect(
      checkSyntax('zsh', generateCompletion(cli, 'zsh', { dynamic: true })).exitCode,
    ).toBe(0);
  });

  test('writes dynamic provider candidates through the shell protocol', async () => {
    const dynamicCli = command('packages').arg(
      option('package').complete(async () => ['react', 'redis', 'vue']),
    );
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

  test('Bash dynamic scripts forward the incomplete argv', () => {
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
    const described = command('packages').arg(
      option('package').complete(() => [
        { value: 'react', description: 'UI library' },
      ]),
    );
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
  test('Bash output has valid syntax', () => {
    const result = checkSyntax('bash', generateCompletion(cli, 'bash'));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('Bash completes option values, inline values, and nested options', () => {
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

  test('Bash tracks multi-value options, require-equals, and positional indexes', () => {
    const arityCli = command('arity')
      .arg(option('pair', parsers.enum(['first', 'second'])).numArgs(2))
      .arg(option('equal', parsers.enum(['dev', 'prod'])).requireEquals())
      .arg(positional('source', parsers.enum(['alpha'])))
      .arg(positional('target', parsers.enum(['beta'])));
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

  test('Bash scans delimited, attached, ranged, and unbounded option values', () => {
    const scannerCli = command('scanner')
      .arg(flag('verbose').short('v'))
      .arg(
        option('pair', parsers.enum(['first', 'second']))
          .short('p')
          .numArgs(2)
          .valueDelimiter(','),
      )
      .arg(
        option('range', parsers.enum(['first', 'second']))
          .numArgs({ min: 1, max: 2 }),
      )
      .arg(
        option('many', parsers.enum(['first', 'second']))
          .numArgs({ min: 1 }),
      )
      .arg(flag('force'))
      .arg(positional('target', parsers.enum(['alpha'])))
      .subcommand(command('run').arg(flag('child-force')));
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

  test('Bash matches positional token policy, logical arity, and inferred commands', () => {
    const positionalCli = command('positionals')
      .arg(
        positional('literal', parsers.enum(['--literal']))
          .allowHyphenValues(),
      )
      .arg(positional('target', parsers.enum(['beta'])))
      .arg(flag('known'));
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

    const logicalCli = command('logical')
      .arg(
        positional('pair', parsers.enum(['first', 'second']))
          .numArgs(2)
          .valueDelimiter(','),
      )
      .arg(positional('target', parsers.enum(['beta'])));
    const logicalScript = `${generateCompletion(logicalCli, 'bash')}
COMP_WORDS=(logical first,second "")
COMP_CWORD=2
_bun_clap_logical
printf 'POSITIONAL_DELIMITER:%s\n' "\${COMPREPLY[*]}"
`;
    const logicalResult = runShell('bash', logicalScript);
    expect(logicalResult.exitCode).toBe(0);
    expect(logicalResult.stdout).toContain('POSITIONAL_DELIMITER:beta');

    const inferredCli = command('tool')
      .inferSubcommands()
      .arg(option('values').numArgs({ min: 1, max: 3 }))
      .subcommand(command('status').arg(flag('child')));
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

  test('Bash matches exact inference, repeatable positionals, and terminators', () => {
    const inferredCli = command('exact')
      .inferSubcommands()
      .arg(option('values').numArgs({ min: 1, max: 3 }))
      .subcommand(command('foo').arg(flag('exact-child')))
      .subcommand(command('foobar').arg(flag('long-child')));
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

    const repeatCli = command('repeat').arg(
      positional('items', parsers.enum(['one', 'two'])).numArgs(2).repeatable(),
    );
    const repeatScript = `${generateCompletion(repeatCli, 'bash')}
COMP_WORDS=(repeat one two "")
COMP_CWORD=3
_bun_clap_repeat
printf 'REPEATABLE:%s\n' "\${COMPREPLY[*]}"
`;
    const repeatResult = runShell('bash', repeatScript);
    expect(repeatResult.exitCode).toBe(0);
    expect(repeatResult.stdout).toContain('REPEATABLE:one two');

    const terminatorCli = command('terminator')
      .arg(positional('items').numArgs({ min: 1, max: 3 }).valueTerminator(';'))
      .arg(positional('target', parsers.enum(['beta'])));
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

  test('Bash parses hidden arguments and exact built-ins without displaying them', () => {
    const hiddenCli = command('hidden')
      .arg(option('secret').numArgs(2).hide())
      .arg(positional('internal').hide())
      .arg(positional('target', parsers.enum(['beta'])));
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

    const builtinCli = command('builtin')
      .version('1.0.0')
      .arg(
        positional(
          'literal',
          parsers.enum(['--help=x', '--version=x', '-hx', '-Vx']),
        ).allowHyphenValues(),
      )
      .arg(positional('target', parsers.enum(['beta'])));
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
    const tab = command('tab').arg(option('value').valueDelimiter('\t'));
    const newline = command('newline').arg(option('value').valueDelimiter('\n'));
    const nul = command('nul').arg(option('value').valueDelimiter('\0'));
    for (const shell of completionShells) {
      expect(generateCompletion(tab, shell)).not.toContain('\t1\t\t0');
      expect(generateCompletion(newline, shell)).not.toContain('\n1\n\n0');
      expect(generateCompletion(nul, shell)).not.toContain('\0');
    }
    expect(generateCompletion(tab, 'bash')).toContain('\t09\t');
    expect(generateCompletion(newline, 'bash')).toContain('\t0a\t');
    expect(generateCompletion(nul, 'bash')).toContain('\t00\t');
  });

  test('Zsh output has valid syntax', () => {
    const result = checkSyntax('zsh', generateCompletion(cli, 'zsh'));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

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
    test.skipIf(executable === null)(`${shell} output has valid syntax when installed`, () => {
      if (executable === null) {
        return;
      }
      const completionShell = shell === 'pwsh' ? 'powershell' : 'fish';
      const result = checkSyntax(shell, generateCompletion(cli, completionShell));
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    });
  }
});

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
