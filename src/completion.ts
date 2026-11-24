import type { ArgumentDefinition } from './argument.js';
import {
  getCommandDefinition,
  type CommandDefinition,
  type CommandType,
} from './command.js';
import type { CompletionShell } from './completion-shell.js';
import bashTemplate from './completion-templates/bash.txt' with { type: 'text' };
import fishTemplate from './completion-templates/fish.txt' with { type: 'text' };
import powerShellTemplate from './completion-templates/powershell.txt' with { type: 'text' };
import zshTemplate from './completion-templates/zsh.txt' with { type: 'text' };
import type { CompletionValueHint } from './parser.js';

export { type CompletionShell, completionShells, isCompletionShell } from './completion-shell.js';
export {
  type DynamicCompletionCandidate,
  type DynamicCompletionCandidateInput,
  type DynamicCompletionContext,
  type DynamicCompletionIterable,
  type DynamicCompletionOptions,
  type DynamicCompletionProvider,
  type DynamicCompletionRawValues,
  type DynamicCompletionResult,
  type DynamicCompletionValues,
  resolveDynamicCompletion,
} from './dynamic-completion.js';

/** Settings for generating a shell completion script. */
export interface CompletionOptions {
  /** Command name or path users enter in the shell. Defaults to the configured command name. */
  readonly executable?: string;
  /** Invokes the CLI to resolve candidates at completion time. Defaults to false. */
  readonly dynamic?: boolean;
}

/** The environment variable set to `1` by generated dynamic completion scripts. */
export const dynamicCompletionEnvironment = 'KONSTIT_CLI_COMPLETE';

interface CompletionNode {
  readonly id: string;
  readonly definition: CommandDefinition;
  readonly arguments: readonly ArgumentDefinition[];
}

interface CompletionCandidate {
  readonly value: string;
  readonly description: string;
}

interface CompletionValue {
  readonly value: string;
  readonly description?: string;
}

interface ValueCompletion {
  readonly tokens: readonly string[];
  readonly values: readonly CompletionValue[];
  readonly hint?: CompletionValueHint;
  readonly ignoreCase?: boolean;
}

const completionTemplates: Readonly<Record<CompletionShell, string>> = Object.freeze({
  bash: bashTemplate,
  zsh: zshTemplate,
  fish: fishTemplate,
  powershell: powerShellTemplate,
});
const blockTemplatePlaceholder = /^\{\{([A-Z_]+)\}\}\n/gm;
const templatePlaceholder = /\{\{([A-Z_]+)\}\}/g;
const powerShellArgvWord =
  'if ($_ -is [System.Management.Automation.Language.CommandParameterAst]) { $_.Extent.Text } else { [string]$_.Value }';

/** Generates a standalone completion script from a configured command. */
export function generateCompletion(
  configuredCommand: CommandType,
  shell: CompletionShell,
  options: CompletionOptions = {},
): string {
  const definition = getCommandDefinition(configuredCommand);
  const executable = options.executable ?? definition.name;
  validateExecutable(executable);
  if (options.dynamic) {
    return generateDynamicCompletion(shell, executable);
  }
  const nodes = flattenCommands(definition);

  switch (shell) {
    case 'bash':
      return generateBash(nodes, executable);
    case 'zsh':
      return generateZsh(nodes, executable);
    case 'fish':
      return generateFish(nodes, executable);
    case 'powershell':
      return generatePowerShell(nodes, executable);
    default:
      throw new RangeError(`Unsupported completion shell: ${String(shell)}`);
  }
}

function completionTemplate(shell: CompletionShell): string {
  return completionTemplates[shell];
}

function renderTemplate(
  shell: CompletionShell,
  replacements: Readonly<Record<string, string>>,
): string {
  const replace = (placeholder: string, name: string): string => {
    return replacements[name] ?? placeholder;
  };
  const blocksRendered = completionTemplate(shell).replace(
    blockTemplatePlaceholder,
    (placeholder, name: string) => {
      const replacement = replace(placeholder, name);
      return replacement.length === 0 ? '' : `${replacement}\n`;
    },
  );
  return blocksRendered.replace(templatePlaceholder, replace);
}

function validateExecutable(executable: string): void {
  if (
    executable.length === 0
    || executable.startsWith('-')
    || executable.includes('\0')
    || executable.includes('\n')
    || executable.includes('\r')
  ) {
    throw new TypeError(`Invalid completion executable: ${JSON.stringify(executable)}`);
  }
}

function flattenCommands(root: CommandDefinition): readonly CompletionNode[] {
  const nodes: CompletionNode[] = [];
  const visit = (
    definition: CommandDefinition,
    id: string,
    inheritedGlobals: readonly ArgumentDefinition[],
  ): void => {
    nodes.push({
      id,
      definition,
      arguments: [...definition.arguments, ...inheritedGlobals],
    });
    const globalsForChildren = [
      ...inheritedGlobals,
      ...definition.arguments.filter(({ global }) => global),
    ];
    definition.subcommands
      .filter(({ hidden }) => !hidden)
      .forEach((child, index) => {
        visit(child, `${id}.${index}`, globalsForChildren);
      });
  };
  visit(root, '0', []);
  return nodes;
}

function visibleArguments(node: CompletionNode): readonly ArgumentDefinition[] {
  return node.arguments.filter(({ hidden }) => !hidden);
}

function childEntries(
  node: CompletionNode,
  nodes: readonly CompletionNode[],
): readonly (readonly [string, CommandDefinition, CompletionNode])[] {
  const children = node.definition.subcommands.filter(({ hidden }) => !hidden);
  return children.flatMap((child) => {
    const target = nodes.find(({ definition }) => definition === child) as CompletionNode;
    return [
      child.name,
      ...child.aliases.filter(({ visible }) => visible).map(({ name }) => name),
    ].map((token) => [token, child, target] as const);
  });
}

function childScanEntries(
  node: CompletionNode,
  nodes: readonly CompletionNode[],
): readonly (readonly [string, CompletionNode])[] {
  const entries = node.definition.subcommands.flatMap((child) => {
    const target = nodes.find(({ definition }) => definition === child);
    if (target === undefined) {
      return [];
    }
    return [child.name, ...child.aliases.map(({ name }) => name)].map(
      (token) => [token, target] as const,
    );
  });
  if (!node.definition.inferSubcommands) {
    return uniqueBy(entries, ([token,]) => token);
  }
  const prefixes = new Map<string, Set<CompletionNode>>();
  for (const [token, target,] of entries) {
    const characters = Array.from(token);
    for (let length = 1; length <= characters.length; length += 1) {
      const prefix = characters.slice(0, length).join('');
      const targets = prefixes.get(prefix) ?? new Set<CompletionNode>();
      targets.add(target);
      prefixes.set(prefix, targets);
    }
  }
  const resolved = new Map<string, CompletionNode>();
  for (const [prefix, targets,] of prefixes) {
    if (targets.size === 1) {
      resolved.set(prefix, [...targets][0] as CompletionNode);
    }
  }
  for (const [token, target,] of entries) {
    resolved.set(token, target);
  }
  return [...resolved];
}

function optionTokens(argument: ArgumentDefinition): readonly string[] {
  return [
    ...(argument.short === undefined ? [] : [`-${argument.short}`]),
    ...(argument.long === undefined ? [] : [`--${argument.long}`]),
    ...(argument.negativeLong === undefined ? [] : [`--${argument.negativeLong}`]),
    ...argument.aliases.map((alias) => `--${alias}`),
  ];
}

function completionForArguments(
  argumentsToCombine: readonly ArgumentDefinition[],
): Omit<ValueCompletion, 'tokens'> {
  const values = uniqueBy(
    argumentsToCombine.flatMap((argument) => parserCompletionValues(argument)),
    ({ value }) => value,
  );
  const hints = unique(
    argumentsToCombine.flatMap((argument) => {
      const hint = argument.completionHint ?? argument.parser?.completionHint;
      return hint === undefined ? [] : [hint];
    }),
  );
  return {
    values,
    ...(values.length === 0 && hints.length === 1 ? { hint: hints[0] } : {}),
    ...(argumentsToCombine.some(({ parser }) => parser?.ignoreCase === true)
      ? { ignoreCase: true }
      : {}),
  };
}

function parserCompletionValues(
  argument: ArgumentDefinition,
): readonly CompletionValue[] {
  const parser = argument.parser;
  const choices = parser?.choices ?? [];
  const normalize = (value: string): string =>
    parser?.ignoreCase === true
      ? value.toLowerCase()
      : value;
  const hiddenSpellings = new Set(
    choices
      .filter(({ hide }) => hide === true)
      .flatMap(({ value, aliases }) => [value, ...(aliases ?? [])])
      .map(normalize),
  );
  const aliases = new Set(
    choices.flatMap(({ aliases: choiceAliases }) => choiceAliases ?? []).map(normalize),
  );
  const descriptions = new Map(
    choices
      .filter(({ hide }) => hide !== true)
      .map(({ value, describe }) => [value, describe] as const),
  );
  const values = new Map<string, CompletionValue>();
  for (const value of parser?.completions ?? []) {
    const normalized = normalize(value);
    if (hiddenSpellings.has(normalized) || aliases.has(normalized)) {
      continue;
    }
    if (!values.has(value)) {
      const description = descriptions.get(value);
      values.set(value, {
        value,
        ...(description === undefined ? {} : { description }),
      });
    }
  }
  for (const choice of choices) {
    if (choice.hide === true || values.has(choice.value)) {
      continue;
    }
    values.set(choice.value, {
      value: choice.value,
      ...(choice.describe === undefined ? {} : { description: choice.describe }),
    });
  }
  return [...values.values()];
}

function valueCompletions(node: CompletionNode): readonly ValueCompletion[] {
  const definitions: ValueCompletion[] = [];
  for (const argument of visibleArguments(node)) {
    if (argument.kind !== 'option') {
      continue;
    }
    const tokens = optionTokens(argument);
    if (tokens.length === 0) {
      continue;
    }
    const completion = completionForArguments([argument]);
    if (completion.values.length > 0 || completion.hint !== undefined) {
      definitions.push({ tokens, ...completion });
    }
  }

  for (const [index, positional,] of parsePositionals(node).entries()) {
    if (positional.hidden) {
      continue;
    }
    const completion = completionForArguments([positional]);
    if (completion.values.length > 0 || completion.hint !== undefined) {
      definitions.push({ tokens: [`@positional:${index}`], ...completion });
    }
  }
  return definitions;
}

function parsePositionals(node: CompletionNode): readonly ArgumentDefinition[] {
  return node.arguments.filter(({ kind }) => kind === 'positional');
}

function valueOptionTokens(node: CompletionNode): readonly string[] {
  return visibleArguments(node)
    .filter(({ kind }) => kind === 'option')
    .flatMap(optionTokens);
}

function declaredOptionTokens(node: CompletionNode): readonly string[] {
  return node.arguments.filter(({ kind }) => kind !== 'positional').flatMap(optionTokens);
}

function builtinOptionTokens(node: CompletionNode): readonly string[] {
  return [
    ...(node.definition.disableHelpFlag ? [] : ['-h', '--help']),
    ...(node.definition.version === undefined || node.definition.disableVersionFlag ? [] : ['-V', '--version']),
  ];
}

function candidates(
  node: CompletionNode,
  nodes: readonly CompletionNode[],
): readonly CompletionCandidate[] {
  const result: CompletionCandidate[] = [];
  for (const argument of visibleArguments(node)) {
    if (argument.kind === 'positional') {
      continue;
    }
    for (const token of optionTokens(argument)) {
      result.push({ value: token, description: argument.help ?? '' });
    }
  }
  if (!node.definition.disableHelpFlag) {
    result.push({ value: '-h', description: 'Print help' });
    result.push({ value: '--help', description: 'Print help' });
  }
  if (
    node.definition.version !== undefined
    && !node.definition.disableVersionFlag
  ) {
    result.push({ value: '-V', description: 'Print version' });
    result.push({ value: '--version', description: 'Print version' });
  }
  for (const [token, child,] of childEntries(node, nodes)) {
    result.push({ value: token, description: child.about ?? '' });
  }
  return uniqueBy(result, ({ value }) => value);
}

function hasVisiblePositionals(node: CompletionNode): boolean {
  return visibleArguments(node).some(({ kind }) => kind === 'positional');
}

function shellMaximum(argument: ArgumentDefinition): number {
  return argument.maxValues ?? -1;
}

function shellOptionSpec(argument: ArgumentDefinition): string {
  return [
    argument.minValues,
    shellMaximum(argument),
    argument.requireEquals ? 1 : 0,
    encodeShellDelimiter(argument.valueDelimiter),
    argument.allowHyphenValues ? 1 : 0,
    argument.allowNegativeNumbers ? 1 : 0,
    argument.repeatable && argument.maxValues === 1 ? 1 : 0,
    encodeShellDelimiter(argument.valueTerminator),
  ].join('\t');
}

function shellPositionalSpec(argument: ArgumentDefinition): string {
  return [
    shellMaximum(argument),
    encodeShellDelimiter(argument.valueDelimiter),
    argument.allowHyphenValues ? 1 : 0,
    argument.allowNegativeNumbers ? 1 : 0,
    argument.repeatable ? 1 : 0,
    encodeShellDelimiter(argument.valueTerminator),
    argument.trailingVarArg ? 1 : 0,
  ].join('\t');
}

function encodeShellDelimiter(delimiter: string | undefined): string {
  return delimiter === undefined ? '-' : Buffer.from(delimiter).toString('hex');
}

function unique<Value>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)];
}

function uniqueBy<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): readonly Value[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function shellIdentifier(executable: string): string {
  const normalized = executable.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', `'"'"'`)}'`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`;
}

function generateDynamicCompletion(
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

function casePatterns(id: string, tokens: readonly string[]): string {
  return tokens.map((token) => shellQuote(`${id}:${token}`)).join('|');
}

function generateBash(
  nodes: readonly CompletionNode[],
  executable: string,
): string {
  const name = `_bun_clap_${shellIdentifier(executable)}`;
  const staticValueCases: string[] = [];
  const valueHintCases: string[] = [];

  for (const node of nodes) {
    for (const completion of valueCompletions(node)) {
      if (completion.values.length > 0) {
        staticValueCases.push(
          `    ${casePatterns(node.id, completion.tokens)}) candidates=(${
            completion.values.map(({ value }) => shellQuote(value)).join(' ')
          }); handled=0; ignore_case=${completion.ignoreCase === true ? 1 : 0} ;;`,
        );
      }
      if (completion.hint !== undefined) {
        const action = completion.hint === 'directory' ? '-d' : '-f';
        valueHintCases.push(
          `    ${
            casePatterns(node.id, completion.tokens)
          }) while IFS= read -r candidate; do COMPREPLY+=("$candidate"); done < <(compgen ${action} -- "$current"); return 0 ;;`,
        );
      }
    }
  }

  return renderTemplate('bash', {
    EXECUTABLE: executable,
    EXECUTABLE_QUOTED: shellQuote(executable),
    NAME: name,
    TAKES_VALUE_CASES: nodes.flatMap((node) => {
      const tokens = valueOptionTokens(node);
      return tokens.length === 0
        ? []
        : [`    ${casePatterns(node.id, tokens)}) return 0 ;;`];
    }).join('\n'),
    OPTION_SPEC_CASES: nodes.flatMap((node) =>
      node.arguments
        .filter(({ kind }) => kind === 'option')
        .flatMap((argument) => {
          const tokens = optionTokens(argument);
          return tokens.length === 0 ? [] : [
            `    ${casePatterns(node.id, tokens)}) printf '%s\\n' ${shellQuote(shellOptionSpec(argument))} ;;`,
          ];
        })
    ).join('\n'),
    POSITIONAL_SPEC_CASES: nodes.flatMap((node) =>
      parsePositionals(node).map((argument, index) =>
        `    ${shellQuote(`${node.id}:${index}`)}) printf '%s\\n' ${shellQuote(shellPositionalSpec(argument))} ;;`
      )
    ).join('\n'),
    DECLARED_OPTION_CASES: nodes.flatMap((node) => {
      const tokens = declaredOptionTokens(node);
      return tokens.length === 0 ? [] : [
        `    ${casePatterns(node.id, tokens)}) return 0 ;;`,
      ];
    }).join('\n'),
    BUILTIN_OPTION_CASES: nodes.flatMap((node) => {
      const tokens = builtinOptionTokens(node);
      return tokens.length === 0 ? [] : [
        `    ${casePatterns(node.id, tokens)}) return 0 ;;`,
      ];
    }).join('\n'),
    SUBCOMMAND_CASES: nodes.flatMap((node) =>
      childScanEntries(node, nodes).map(([token, target,]) =>
        `    ${shellQuote(`${node.id}:${token}`)}) printf '%s\\n' ${shellQuote(target.id)} ;;`
      )
    ).join('\n'),
    CANDIDATE_CASES: nodes.map((node) => {
      const values = candidates(node, nodes).map(({ value }) => shellQuote(value));
      return `    ${shellQuote(node.id)}) printf '%s\\n' ${values.join(' ')} ;;`;
    }).join('\n'),
    STATIC_VALUE_CASES: staticValueCases.join('\n'),
    VALUE_HINT_CASES: valueHintCases.join('\n'),
    ALLOWS_FILES_CASES: nodes.flatMap((node) =>
      parsePositionals(node).flatMap((argument, index) => {
        if (argument.hidden) {
          return [];
        }
        const completion = completionForArguments([argument]);
        return completion.values.length === 0 && completion.hint === undefined
          ? [`    ${shellQuote(`${node.id}:${index}`)}) return 0 ;;`]
          : [];
      })
    )
      .join('\n'),
  });
}

function generateZsh(
  nodes: readonly CompletionNode[],
  executable: string,
): string {
  const name = `_bun_clap_${shellIdentifier(executable)}`;
  const autoloadName = `_${executable.split('/').at(-1) ?? executable}`;
  const staticValueCases: string[] = [];
  const valueHintCases: string[] = [];

  for (const node of nodes) {
    for (const completion of valueCompletions(node)) {
      if (completion.values.length > 0) {
        const descriptions = completion.values.map(({ description }) => description ?? '');
        staticValueCases.push(
          `    ${casePatterns(node.id, completion.tokens)}) values=(${
            completion.values.map(({ value }) => shellQuote(value)).join(' ')
          }); descriptions=(${descriptions.map(shellQuote).join(' ')}); ignore_case=${completion.ignoreCase === true ? 1 : 0} ;;`,
        );
      }
      if (completion.hint !== undefined) {
        const action = completion.hint === 'directory' ? '_directories' : '_files';
        valueHintCases.push(
          `    ${casePatterns(node.id, completion.tokens)}) ${action} -P "$prefix"; return 0 ;;`,
        );
      }
    }
  }

  return renderTemplate('zsh', {
    EXECUTABLE: executable,
    EXECUTABLE_QUOTED: shellQuote(executable),
    NAME: name,
    NAME_QUOTED: shellQuote(name),
    AUTOLOAD_NAME_QUOTED: shellQuote(autoloadName),
    TAKES_VALUE_CASES: nodes.flatMap((node) => {
      const tokens = valueOptionTokens(node);
      return tokens.length === 0
        ? []
        : [`    ${casePatterns(node.id, tokens)}) return 0 ;;`];
    }).join('\n'),
    OPTION_SPEC_CASES: nodes.flatMap((node) =>
      node.arguments
        .filter(({ kind }) => kind === 'option')
        .flatMap((argument) => {
          const tokens = optionTokens(argument);
          return tokens.length === 0 ? [] : [
            `    ${casePatterns(node.id, tokens)}) print -r -- ${shellQuote(shellOptionSpec(argument))} ;;`,
          ];
        })
    ).join('\n'),
    POSITIONAL_SPEC_CASES: nodes.flatMap((node) =>
      parsePositionals(node).map((argument, index) =>
        `    ${shellQuote(`${node.id}:${index}`)}) print -r -- ${shellQuote(shellPositionalSpec(argument))} ;;`
      )
    ).join('\n'),
    DECLARED_OPTION_CASES: nodes.flatMap((node) => {
      const tokens = declaredOptionTokens(node);
      return tokens.length === 0 ? [] : [
        `    ${casePatterns(node.id, tokens)}) return 0 ;;`,
      ];
    }).join('\n'),
    BUILTIN_OPTION_CASES: nodes.flatMap((node) => {
      const tokens = builtinOptionTokens(node);
      return tokens.length === 0 ? [] : [
        `    ${casePatterns(node.id, tokens)}) return 0 ;;`,
      ];
    }).join('\n'),
    SUBCOMMAND_CASES: nodes.flatMap((node) =>
      childScanEntries(node, nodes).map(([token, target,]) =>
        `    ${shellQuote(`${node.id}:${token}`)}) print -r -- ${shellQuote(target.id)} ;;`
      )
    ).join('\n'),
    CANDIDATE_CASES: nodes.map((node) => {
      const values = candidates(node, nodes).map(({ value }) => shellQuote(value));
      return `    ${shellQuote(node.id)}) reply=(${values.join(' ')}) ;;`;
    }).join('\n'),
    STATIC_VALUE_CASES: staticValueCases.join('\n'),
    VALUE_HINT_CASES: valueHintCases.join('\n'),
    ALLOWS_FILES_CASES: nodes.flatMap((node) =>
      parsePositionals(node).flatMap((argument, index) => {
        if (argument.hidden) {
          return [];
        }
        const completion = completionForArguments([argument]);
        return completion.values.length === 0 && completion.hint === undefined
          ? [`    ${shellQuote(`${node.id}:${index}`)}) return 0 ;;`]
          : [];
      })
    )
      .join('\n'),
  });
}

function generateFish(
  nodes: readonly CompletionNode[],
  executable: string,
): string {
  const name = `__bun_clap_${shellIdentifier(executable)}_context`;
  const commandPrefix = executable.includes('/')
    ? `complete -p ${fishQuote(executable)}`
    : `complete -c ${fishQuote(executable)}`;
  const registrations: string[] = [];

  for (const node of nodes) {
    const condition = fishQuote(`string match -q '${node.id}:*' (${name} named)`);
    for (const argument of visibleArguments(node)) {
      if (argument.kind === 'positional') {
        continue;
      }
      const baseParts = [commandPrefix, `-n ${condition}`];
      if (argument.short !== undefined) {
        baseParts.push(`-s ${fishQuote(argument.short)}`);
      }
      if (argument.long !== undefined) {
        baseParts.push(`-l ${fishQuote(argument.long)}`);
      }
      if (argument.kind === 'option') {
        baseParts.push('-r');
      }
      if (argument.help !== undefined) {
        baseParts.push(`-d ${fishQuote(argument.help)}`);
      }
      registrations.push(...appendFishValueCompletion(baseParts, argument));
      for (
        const alias of [
          ...(argument.negativeLong === undefined ? [] : [argument.negativeLong]),
          ...argument.aliases,
        ]
      ) {
        const aliasParts = [
          commandPrefix,
          `-n ${condition}`,
          `-l ${fishQuote(alias)}`,
          ...(argument.kind === 'option' ? ['-r'] : []),
          ...(argument.help === undefined ? [] : [`-d ${fishQuote(argument.help)}`]),
        ];
        registrations.push(...appendFishValueCompletion(aliasParts, argument));
      }
    }
    if (!node.definition.disableHelpFlag) {
      registrations.push(
        `${commandPrefix} -n ${condition} -s h -l help -d ${fishQuote('Print help')}`,
      );
    }
    if (
      node.definition.version !== undefined
      && !node.definition.disableVersionFlag
    ) {
      registrations.push(
        `${commandPrefix} -n ${condition} -s V -l version -d ${fishQuote('Print version')}`,
      );
    }
    const childList = childEntries(node, nodes);
    const disableFiles = !hasVisiblePositionals(node) ? ' -f' : '';
    for (const [token, child,] of childList) {
      registrations.push(
        `${commandPrefix}${disableFiles} -n ${condition} -a ${fishQuote(token)}${
          child.about === undefined ? '' : ` -d ${fishQuote(child.about)}`
        }`,
      );
    }
    for (const [index, positional,] of parsePositionals(node).entries()) {
      if (positional.hidden) {
        continue;
      }
      const positionalCondition = fishQuote(`test (${name}) = '${node.id}:${index}'`);
      const completion = completionForArguments([positional]);
      if (completion.values.length > 0) {
        for (const value of completion.values) {
          registrations.push(
            `${commandPrefix} -f -n ${positionalCondition} -a ${fishQuote(fishQuote(value.value))}${
              value.description === undefined ? '' : ` -d ${fishQuote(value.description)}`
            }`,
          );
        }
      } else if (completion.hint === 'directory') {
        registrations.push(
          `${commandPrefix} -f -n ${positionalCondition} -a ${fishQuote('(__fish_complete_directories)')}`,
        );
      }
    }
    registrations.push('');
  }

  return `${
    renderTemplate('fish', {
      EXECUTABLE: executable,
      NAME: name,
      OPTION_SPEC_CASES: nodes.flatMap((node) => {
        return node.arguments
          .filter(({ kind }) => kind === 'option')
          .flatMap((argument) => {
            const tokens = optionTokens(argument);
            return tokens.length === 0 ? [] : [
              `                case ${tokens.map((token) => fishQuote(`${node.id}:${token}`)).join(' ')}`,
              '                    set new_option $option_word',
              `                    set pending_min ${argument.minValues}`,
              `                    set pending_max ${shellMaximum(argument)}`,
              `                    set pending_require_equals ${argument.requireEquals ? 1 : 0}`,
              `                    set pending_delimiter_hex ${fishQuote(encodeShellDelimiter(argument.valueDelimiter))}`,
              `                    set pending_allow_hyphen ${argument.allowHyphenValues ? 1 : 0}`,
              `                    set pending_allow_negative ${argument.allowNegativeNumbers ? 1 : 0}`,
              `                    set pending_single_raw ${argument.repeatable && argument.maxValues === 1 ? 1 : 0}`,
              `                    set pending_terminator_hex ${fishQuote(encodeShellDelimiter(argument.valueTerminator))}`,
            ];
          });
      }).join('\n'),
      PENDING_SUBCOMMAND_CASES: nodes.flatMap((node) =>
        childScanEntries(node, nodes).flatMap(([token, target,]) => [
          `                    case ${fishQuote(`${node.id}:${token}`)}`,
          `                        set context ${fishQuote(target.id)}`,
          '                        set positional_index 0',
          '                        set positional_remaining 0',
          '                        set scan_state command',
          '                        continue',
        ])
      ).join('\n'),
      SUBCOMMAND_CASES: nodes.flatMap((node) =>
        childScanEntries(node, nodes).flatMap(([token, target,]) => [
          `                case ${fishQuote(`${node.id}:${token}`)}`,
          `                    set context ${fishQuote(target.id)}`,
          '                    set positional_index 0',
          '                    set positional_remaining 0',
          '                    continue',
        ])
      ).join('\n'),
      POSITIONAL_SPEC_CASES: nodes.flatMap((node) =>
        parsePositionals(node).flatMap((argument, index) => [
          `                case ${fishQuote(`${node.id}:${index}`)}`,
          `                    set positional_remaining ${shellMaximum(argument)}`,
          `                    set positional_delimiter_hex ${fishQuote(encodeShellDelimiter(argument.valueDelimiter))}`,
          `                    set positional_allow_hyphen ${argument.allowHyphenValues ? 1 : 0}`,
          `                    set positional_allow_negative ${argument.allowNegativeNumbers ? 1 : 0}`,
          `                    set positional_repeatable ${argument.repeatable ? 1 : 0}`,
          `                    set positional_terminator_hex ${fishQuote(encodeShellDelimiter(argument.valueTerminator))}`,
          `                    set positional_trailing ${argument.trailingVarArg ? 1 : 0}`,
        ])
      ).join('\n'),
      DECLARED_OPTION_CASES: nodes.flatMap((node) => {
        const tokens = declaredOptionTokens(node);
        return tokens.length === 0 ? [] : [
          `                case ${tokens.map((token) => fishQuote(`${node.id}:${token}`)).join(' ')}`,
          '                    set declared_option 1',
        ];
      }).join('\n'),
      BUILTIN_OPTION_CASES: nodes.flatMap((node) => {
        const tokens = builtinOptionTokens(node);
        return tokens.length === 0 ? [] : [
          `                case ${tokens.map((token) => fishQuote(`${node.id}:${token}`)).join(' ')}`,
          '                    set declared_option 1',
        ];
      }).join('\n'),
      REGISTRATIONS: registrations.join('\n').trimEnd(),
    }).trimEnd()
  }\n`;
}

function appendFishValueCompletion(
  parts: string[],
  argument: ArgumentDefinition,
): readonly string[] {
  if (argument.kind !== 'option') {
    return [parts.join(' ')];
  }
  const completion = completionForArguments([argument]);
  if (completion.values.length > 0) {
    return completion.values.map(({ value, description }) =>
      [
        ...parts,
        '-f',
        `-a ${fishQuote(fishQuote(value))}`,
        ...(description === undefined ? [] : [`-d ${fishQuote(description)}`]),
      ].join(' ')
    );
  } else if (completion.hint === 'directory') {
    parts.push('-f', `-a ${fishQuote('(__fish_complete_directories)')}`);
  }
  return [parts.join(' ')];
}

function generatePowerShell(
  nodes: readonly CompletionNode[],
  executable: string,
): string {
  const takesValueCases: string[] = [];
  const optionSpecCases: string[] = [];
  const positionalSpecCases: string[] = [];
  const declaredOptionCases: string[] = [];
  const builtinOptionCases: string[] = [];
  const subcommandCases: string[] = [];
  const valueModeCases: string[] = [];
  const staticValueCases: string[] = [];
  const candidateCases: string[] = [];

  for (const node of nodes) {
    for (const token of valueOptionTokens(node)) {
      takesValueCases.push(
        `      ${powerShellQuote(`${node.id}:${token}`)} { return $true }`,
      );
    }
    for (const argument of node.arguments.filter(({ kind }) => kind === 'option')) {
      for (const token of optionTokens(argument)) {
        optionSpecCases.push(
          `      ${powerShellQuote(`${node.id}:${token}`)} { return [pscustomobject]@{ Minimum = ${argument.minValues}; Maximum = ${
            shellMaximum(argument)
          }; RequireEquals = $${argument.requireEquals}; DelimiterHex = ${
            powerShellQuote(encodeShellDelimiter(argument.valueDelimiter))
          }; AllowHyphen = $${argument.allowHyphenValues}; AllowNegative = $${argument.allowNegativeNumbers}; SingleRaw = $${
            argument.repeatable && argument.maxValues === 1
          }; TerminatorHex = ${powerShellQuote(encodeShellDelimiter(argument.valueTerminator))} } }`,
        );
      }
    }
    for (const [index, argument,] of parsePositionals(node).entries()) {
      positionalSpecCases.push(
        `      ${powerShellQuote(`${node.id}:${index}`)} { return [pscustomobject]@{ Maximum = ${shellMaximum(argument)}; DelimiterHex = ${
          powerShellQuote(encodeShellDelimiter(argument.valueDelimiter))
        }; AllowHyphen = $${argument.allowHyphenValues}; AllowNegative = $${argument.allowNegativeNumbers}; Repeatable = $${argument.repeatable}; TerminatorHex = ${
          powerShellQuote(encodeShellDelimiter(argument.valueTerminator))
        }; Trailing = $${argument.trailingVarArg} } }`,
      );
    }
    const declared = declaredOptionTokens(node);
    for (const token of declared) {
      declaredOptionCases.push(
        `      ${powerShellQuote(`${node.id}:${token}`)} { return $true }`,
      );
    }
    const builtins = builtinOptionTokens(node);
    for (const token of builtins) {
      builtinOptionCases.push(
        `      ${powerShellQuote(`${node.id}:${token}`)} { return $true }`,
      );
    }
    for (const [token, target,] of childScanEntries(node, nodes)) {
      subcommandCases.push(
        `      ${powerShellQuote(`${node.id}:${token}`)} { return ${powerShellQuote(target.id)} }`,
      );
    }
    for (const completion of valueCompletions(node)) {
      const mode = completion.values.length > 0 ? 'static' : completion.hint;
      if (mode !== undefined) {
        for (const token of completion.tokens) {
          valueModeCases.push(
            `      ${powerShellQuote(`${node.id}:${token}`)} { return ${powerShellQuote(mode)} }`,
          );
        }
      }
      if (completion.values.length > 0) {
        const values = completion.values.map(({ value, description }) =>
          `[pscustomobject]@{ Value = ${powerShellQuote(value)}; Description = ${powerShellQuote(description ?? '')} }`
        ).join(', ');
        for (const token of completion.tokens) {
          staticValueCases.push(
            `      ${powerShellQuote(`${node.id}:${token}`)} { return @(${values}) }`,
          );
        }
      }
    }
    candidateCases.push(`      ${powerShellQuote(node.id)} {`);
    for (const candidate of candidates(node, nodes)) {
      candidateCases.push(
        `        [pscustomobject]@{ Value = ${powerShellQuote(candidate.value)}; Description = ${powerShellQuote(candidate.description)} }`,
      );
    }
    candidateCases.push('      }');
  }

  return renderTemplate('powershell', {
    EXECUTABLE: executable,
    ARGV_WORD: powerShellArgvWord,
    EXECUTABLE_QUOTED: powerShellQuote(executable),
    TAKES_VALUE_CASES: takesValueCases.join('\n'),
    OPTION_SPEC_CASES: optionSpecCases.join('\n'),
    POSITIONAL_SPEC_CASES: positionalSpecCases.join('\n'),
    DECLARED_OPTION_CASES: declaredOptionCases.join('\n'),
    BUILTIN_OPTION_CASES: builtinOptionCases.join('\n'),
    SUBCOMMAND_CASES: subcommandCases.join('\n'),
    VALUE_MODE_CASES: valueModeCases.join('\n'),
    STATIC_VALUE_CASES: staticValueCases.join('\n'),
    CANDIDATE_CASES: candidateCases.join('\n'),
    ALLOWS_FILES_CASES: nodes.flatMap((node) =>
      parsePositionals(node).flatMap((argument, index) => {
        if (argument.hidden) {
          return [];
        }
        const completion = completionForArguments([argument]);
        return completion.values.length === 0 && completion.hint === undefined
          ? [`      ${powerShellQuote(`${node.id}:${index}`)} { return $true }`]
          : [];
      })
    )
      .join('\n'),
  });
}
