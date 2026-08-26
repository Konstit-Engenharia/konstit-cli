import type { ArgumentDefinition } from './argument';
import {
  getCommandDefinition,
  type CommandDefinition,
  type CommandType,
} from './command';
import type { CompletionShell } from './completion-shell';
import bashTemplate from './completion-templates/bash.txt' with { type: 'text' };
import fishTemplate from './completion-templates/fish.txt' with { type: 'text' };
import powerShellTemplate from './completion-templates/powershell.txt' with { type: 'text' };
import zshTemplate from './completion-templates/zsh.txt' with { type: 'text' };
import type { CompletionValueHint } from './parser';

export { type CompletionShell, completionShells, isCompletionShell } from './completion-shell';
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
} from './dynamic-completion';

export interface CompletionOptions {
  /** Command name or path users enter in the shell. Defaults to Command.name. */
  readonly executable?: string;
  /** Generates a script that asks the running CLI for async candidates. */
  readonly dynamic?: boolean;
}

/** Environment marker set by generated dynamic completion scripts. */
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

interface ValueCompletion {
  readonly tokens: readonly string[];
  readonly values: readonly string[];
  readonly hint?: CompletionValueHint;
}

const completionTemplates: Readonly<Record<CompletionShell, string>> = Object.freeze({
  bash: bashTemplate,
  zsh: zshTemplate,
  fish: fishTemplate,
  powershell: powerShellTemplate,
});
const blockTemplatePlaceholder = /^\{\{([A-Z_]+)\}\}\n/gm;
const templatePlaceholder = /\{\{([A-Z_]+)\}\}/g;

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
    const target = nodes.find(({ definition }) => definition === child);
    if (target === undefined) {
      throw new Error(`Missing completion node for subcommand '${child.name}'`);
    }
    return [
      child.name,
      ...child.aliases.filter(({ visible }) => visible).map(({ name }) => name),
    ].map((token) => [token, child, target] as const);
  });
}

function optionTokens(argument: ArgumentDefinition): readonly string[] {
  return [
    ...(argument.short === undefined ? [] : [`-${argument.short}`]),
    ...(argument.long === undefined ? [] : [`--${argument.long}`]),
    ...argument.aliases.map((alias) => `--${alias}`),
  ];
}

function completionForArguments(
  argumentsToCombine: readonly ArgumentDefinition[],
): Omit<ValueCompletion, 'tokens'> {
  const values = unique(
    argumentsToCombine.flatMap((argument) => argument.parser?.completions ?? []),
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
  };
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

  const positionals = visibleArguments(node).filter(
    ({ kind }) => kind === 'positional',
  );
  if (positionals.length > 0) {
    const completion = completionForArguments(positionals);
    if (completion.values.length > 0 || completion.hint !== undefined) {
      definitions.push({ tokens: ['@positional'], ...completion });
    }
  }
  return definitions;
}

function valueOptionTokens(node: CompletionNode): readonly string[] {
  return visibleArguments(node)
    .filter(({ kind }) => kind === 'option')
    .flatMap(optionTokens);
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

function hasFallbackFilePositionals(node: CompletionNode): boolean {
  if (!hasVisiblePositionals(node)) {
    return false;
  }
  return !valueCompletions(node).some(({ tokens }) => tokens.includes('@positional'));
}

function unique<Value>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)];
}

function uniqueBy<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): readonly Value[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const current = key(value);
    if (seen.has(current)) {
      return false;
    }
    seen.add(current);
    return true;
  });
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
        `${name}() {`,
        '  local candidate',
        '  COMPREPLY=()',
        '  while IFS= read -r candidate; do',
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
        `${name}() {`,
        '  local -a candidates',
        `  candidates=("\${(@f)$(${dynamicCompletionEnvironment}=1 ${executableQuoted} "\${words[@]:1}")}")`,
        `  if (( \${#candidates[@]} )); then`,
        `    compadd -Q -- "\${candidates[@]}"`,
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
        `function ${name}`,
        '    set -l tokens (commandline -opc)',
        '    set -l current (commandline -ct)',
        `    env ${dynamicCompletionEnvironment}=1 command ${fishQuote(executable)} $tokens[2..-1] "$current"`,
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
        '  $arguments = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { [string]$_.Value })',
        '  if ([string]::IsNullOrEmpty($wordToComplete)) { $arguments += \'\' }',
        `  $previous = [Environment]::GetEnvironmentVariable(${environmentQuoted}, 'Process')`,
        '  try {',
        `    [Environment]::SetEnvironmentVariable(${environmentQuoted}, '1', 'Process')`,
        `    $values = @(& ${powerExecutable} @arguments 2>$null)`,
        '  } finally {',
        `    [Environment]::SetEnvironmentVariable(${environmentQuoted}, $previous, 'Process')`,
        '  }',
        '  foreach ($value in $values) {',
        '    [System.Management.Automation.CompletionResult]::new($value, $value, \'ParameterValue\', $value)',
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
          `    ${casePatterns(node.id, completion.tokens)}) candidates=(${completion.values.map(shellQuote).join(' ')}); handled=0 ;;`,
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
    SUBCOMMAND_CASES: nodes.flatMap((node) =>
      childEntries(node, nodes).map(([token, _child, target,]) =>
        `    ${shellQuote(`${node.id}:${token}`)}) printf '%s\\n' ${shellQuote(target.id)} ;;`
      )
    ).join('\n'),
    CANDIDATE_CASES: nodes.map((node) => {
      const values = candidates(node, nodes).map(({ value }) => shellQuote(value));
      return `    ${shellQuote(node.id)}) printf '%s\\n' ${values.join(' ')} ;;`;
    }).join('\n'),
    STATIC_VALUE_CASES: staticValueCases.join('\n'),
    VALUE_HINT_CASES: valueHintCases.join('\n'),
    ALLOWS_FILES_CASES: nodes.filter(hasFallbackFilePositionals)
      .map((node) => `    ${shellQuote(node.id)}) return 0 ;;`)
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
        staticValueCases.push(
          `    ${casePatterns(node.id, completion.tokens)}) values=(${completion.values.map(shellQuote).join(' ')}) ;;`,
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
    SUBCOMMAND_CASES: nodes.flatMap((node) =>
      childEntries(node, nodes).map(([token, _child, target,]) =>
        `    ${shellQuote(`${node.id}:${token}`)}) print -r -- ${shellQuote(target.id)} ;;`
      )
    ).join('\n'),
    CANDIDATE_CASES: nodes.map((node) => {
      const values = candidates(node, nodes).map(({ value }) => shellQuote(value));
      return `    ${shellQuote(node.id)}) reply=(${values.join(' ')}) ;;`;
    }).join('\n'),
    STATIC_VALUE_CASES: staticValueCases.join('\n'),
    VALUE_HINT_CASES: valueHintCases.join('\n'),
    ALLOWS_FILES_CASES: nodes.filter(hasFallbackFilePositionals)
      .map((node) => `    ${shellQuote(node.id)}) return 0 ;;`)
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
    const condition = fishQuote(`test (${name}) = ${node.id}`);
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
      appendFishValueCompletion(baseParts, argument);
      registrations.push(baseParts.join(' '));
      for (const alias of argument.aliases) {
        const aliasParts = [
          commandPrefix,
          `-n ${condition}`,
          `-l ${fishQuote(alias)}`,
          ...(argument.kind === 'option' ? ['-r'] : []),
          ...(argument.help === undefined ? [] : [`-d ${fishQuote(argument.help)}`]),
        ];
        appendFishValueCompletion(aliasParts, argument);
        registrations.push(aliasParts.join(' '));
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
    const positionals = visibleArguments(node).filter(
      ({ kind }) => kind === 'positional',
    );
    if (positionals.length > 0) {
      const completion = completionForArguments(positionals);
      if (completion.values.length > 0) {
        registrations.push(
          `${commandPrefix} -f -n ${condition} -a ${fishWordList(completion.values)}`,
        );
      } else if (completion.hint === 'directory') {
        registrations.push(
          `${commandPrefix} -f -n ${condition} -a ${fishQuote('(__fish_complete_directories)')}`,
        );
      }
    }
    registrations.push('');
  }

  return `${
    renderTemplate('fish', {
      EXECUTABLE: executable,
      NAME: name,
      TAKES_VALUE_CASES: nodes.flatMap((node) => {
        const tokens = valueOptionTokens(node);
        return tokens.length === 0
          ? []
          : [
            `            case ${tokens.map((token) => fishQuote(`${node.id}:${token}`)).join(' ')}`,
            '                set expect_value 1',
            '                continue',
          ];
      }).join('\n'),
      SUBCOMMAND_CASES: nodes.flatMap((node) =>
        childEntries(node, nodes).flatMap(([token, _child, target,]) => [
          `            case ${fishQuote(`${node.id}:${token}`)}`,
          `                set context ${fishQuote(target.id)}`,
        ])
      ).join('\n'),
      REGISTRATIONS: registrations.join('\n').trimEnd(),
    }).trimEnd()
  }\n`;
}

function appendFishValueCompletion(
  parts: string[],
  argument: ArgumentDefinition,
): void {
  if (argument.kind !== 'option') {
    return;
  }
  const completion = completionForArguments([argument]);
  if (completion.values.length > 0) {
    parts.push('-f', `-a ${fishWordList(completion.values)}`);
  } else if (completion.hint === 'directory') {
    parts.push('-f', `-a ${fishQuote('(__fish_complete_directories)')}`);
  }
}

function fishWordList(values: readonly string[]): string {
  const expression = values.map(fishQuote).join(' ');
  return fishQuote(expression);
}

function generatePowerShell(
  nodes: readonly CompletionNode[],
  executable: string,
): string {
  const takesValueCases: string[] = [];
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
    for (const [token, _child, target,] of childEntries(node, nodes)) {
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
        const values = completion.values.map(powerShellQuote).join(', ');
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
    EXECUTABLE_QUOTED: powerShellQuote(executable),
    TAKES_VALUE_CASES: takesValueCases.join('\n'),
    SUBCOMMAND_CASES: subcommandCases.join('\n'),
    VALUE_MODE_CASES: valueModeCases.join('\n'),
    STATIC_VALUE_CASES: staticValueCases.join('\n'),
    CANDIDATE_CASES: candidateCases.join('\n'),
    ALLOWS_FILES_CASES: nodes.filter(hasFallbackFilePositionals)
      .map((node) => `      ${powerShellQuote(node.id)} { return $true }`)
      .join('\n'),
  });
}
