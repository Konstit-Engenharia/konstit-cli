import {
  fishQuote,
  powerShellQuote,
  shellIdentifier,
  shellQuote,
} from '../quotes.js';
import type { CompletionShell } from '../shell.js';
import { powerShellArgvWord } from '../templates.js';

/** The environment variable set to `1` by generated dynamic completion scripts. */
export const dynamicCompletionEnvironment = 'KONSTIT_CLI_COMPLETE';

/** Generates the shell-side bridge for dynamic completion requests. */
export function runDynamicCompletionScript(
  shell: CompletionShell,
  executable: string,
): string {
  const name = `__konstit_cli_${shellIdentifier(executable)}_dynamic`;
  const executableQuoted = shellQuote(executable);

  switch (shell) {
    case 'bash':
      return [
        `# dynamic bash completion for ${executable}`,
        `${name}_decode() {`,
        '  local hex="$1" byte result=""',
        '  while [[ -n "$hex" ]]; do',
        `    printf -v byte '%b' "\\x\${hex:0:2}"`,
        '    result+="$byte"',
        `    hex="\${hex:2}"`,
        '  done',
        '  REPLY="$result"',
        '}',
        `${name}() {`,
        '  local encoded description candidate',
        '  COMPREPLY=()',
        '  while IFS=$\'\\t\' read -r encoded description; do',
        `    ${name}_decode "$encoded"`,
        '    candidate="$REPLY"',
        '    [[ -n "$candidate" ]] && COMPREPLY+=("$candidate")',
        `  done < <(${dynamicCompletionEnvironment}=1 ${executableQuoted} "\${COMP_WORDS[@]:1:$((COMP_CWORD))}")`,
        '}',
        `complete -o default -F ${name} ${executableQuoted}`,
        '',
      ].join('\n');
    case 'zsh':
      return [
        `#compdef ${executable}`,
        `# dynamic zsh completion for ${executable}`,
        `${name}_decode() {`,
        '  local hex="$1" byte result=""',
        '  while [[ -n "$hex" ]]; do',
        `    printf -v byte '%b' "\\x\${hex[1,2]}"`,
        '    result+="$byte"',
        `    hex="\${hex[3,-1]}"`,
        '  done',
        '  REPLY="$result"',
        '}',
        `${name}() {`,
        '  local encoded description',
        '  local -a candidates descriptions',
        `  while IFS=$'\\t' read -r encoded description; do`,
        `    ${name}_decode "$encoded"`,
        '    candidates+=("$REPLY")',
        `    ${name}_decode "$description"`,
        '    descriptions+=("$REPLY")',
        `  done < <(${dynamicCompletionEnvironment}=1 ${executableQuoted} "\${words[@]:1}")`,
        `  if (( \${#candidates[@]} )); then`,
        `    compadd -Q -d descriptions -- "\${candidates[@]}"`,
        '  else',
        '    _files',
        '  fi',
        '}',
        `compdef ${name} ${executableQuoted}`,
        '',
      ].join('\n');
    case 'fish': {
      const commandPrefix = executable.includes('/')
        ? `complete -p ${fishQuote(executable)}`
        : `complete -c ${fishQuote(executable)}`;
      return [
        `# dynamic fish completion for ${executable}`,
        `function ${name}_decode --argument-names hex`,
        '    set -l result',
        '    while test (string length -- "$hex") -gt 0',
        '        set -l pair (string sub -s 1 -l 2 -- "$hex")',
        '        set -a result (printf "\\x$pair")',
        '        set hex (string sub -s 3 -- "$hex")',
        '    end',
        '    string join \'\' -- $result',
        'end',
        `function ${name}`,
        '    set -l tokens (commandline -opc)',
        '    set -l current (commandline -ct)',
        `    env ${dynamicCompletionEnvironment}=1 command ${fishQuote(executable)} $tokens[2..-1] "$current" | while read -l line`,
        '        set -l fields (string split -m 1 \\t -- "$line")',
        `        set -l value (${name}_decode "$fields[1]")`,
        `        set -l description (${name}_decode "$fields[2]")`,
        '        printf \'%s\\t%s\\n\' "$value" "$description"',
        '    end',
        'end',
        `${commandPrefix} -a '(${name})'`,
        '',
      ].join('\n');
    }
    case 'powershell': {
      const environmentQuoted = powerShellQuote(dynamicCompletionEnvironment);
      const powerExecutable = powerShellQuote(executable);
      return [
        `# dynamic PowerShell completion for ${executable}`,
        `Register-ArgumentCompleter -Native -CommandName ${powerExecutable} -ScriptBlock {`,
        '  param($wordToComplete, $commandAst, $cursorPosition)',
        '  $decodeHex = {',
        '    param([string]$hex)',
        '    $bytes = New-Object byte[] ($hex.Length / 2)',
        '    for ($byteIndex = 0; $byteIndex -lt $bytes.Length; $byteIndex++) {',
        '      $bytes[$byteIndex] = [Convert]::ToByte($hex.Substring($byteIndex * 2, 2), 16)',
        '    }',
        '    return [Text.Encoding]::UTF8.GetString($bytes)',
        '  }',
        `  $arguments = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { ${powerShellArgvWord} })`,
        '  if ([string]::IsNullOrEmpty($wordToComplete)) { $arguments += \'\' }',
        `  $previous = [Environment]::GetEnvironmentVariable(${environmentQuoted}, 'Process')`,
        '  try {',
        `    [Environment]::SetEnvironmentVariable(${environmentQuoted}, '1', 'Process')`,
        `    $values = @(& ${powerExecutable} @arguments 2>$null)`,
        '  } finally {',
        `    [Environment]::SetEnvironmentVariable(${environmentQuoted}, $previous, 'Process')`,
        '  }',
        '  foreach ($value in $values) {',
        '    $fields = $value -split "`t", 2',
        '    if ($fields.Count -ne 2) { continue }',
        '    $completion = & $decodeHex $fields[0]',
        '    $description = & $decodeHex $fields[1]',
        '    if ([string]::IsNullOrEmpty($description)) { $description = $completion }',
        '    [System.Management.Automation.CompletionResult]::new($completion, $completion, \'ParameterValue\', $description)',
        '  }',
        '}',
        '',
      ].join('\n');
    }
    default:
      throw new RangeError(`Unsupported completion shell: ${String(shell)}`);
  }
}
