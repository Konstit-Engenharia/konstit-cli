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

export function generateBash(
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
