import {
  shellIdentifier,
  shellQuote,
} from '../quotes.js';
import { renderTemplate } from '../templates.js';
import {
  builtinOptionTokens,
  candidates,
  childScanEntries,
  completionForArguments,
  declaredOptionTokens,
  literalPositionalKeys,
  optionTokens,
  parsePositionals,
  valueCompletions,
  valueOptionTokens,
  type CompletionNode,
} from './model.js';
import {
  casePatterns,
  shellOptionSpec,
  shellPositionalSpec,
} from './spec.js';

export function generateZsh(
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
    LITERAL_POSITIONAL_CASES: literalPositionalKeys(nodes).map((key) => `    ${shellQuote(key)}) return 0 ;;`).join('\n'),
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
