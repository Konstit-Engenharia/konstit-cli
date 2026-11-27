import { powerShellQuote } from '../quotes.js';
import {
  powerShellArgvWord,
  renderTemplate,
} from '../templates.js';
import {
  builtinOptionTokens,
  candidates,
  childScanEntries,
  completionForArguments,
  declaredOptionTokens,
  defaultSubcommandEntries,
  literalPositionalKeys,
  optionTokens,
  parsePositionals,
  valueCompletions,
  valueOptionTokens,
  type CompletionNode,
} from './model.js';
import {
  encodeShellDelimiter,
  shellMaximum,
} from './spec.js';

export function generatePowerShell(
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
  const defaults = defaultSubcommandEntries(nodes);

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
    HAS_DEFAULT_SUBCOMMANDS: defaults.length === 0 ? '$false' : '$true',
    DEFAULT_SUBCOMMAND_CASES: defaults.map(([id, child,]) => `      ${powerShellQuote(id)} { return ${powerShellQuote(child)} }`).join(
      '\n',
    ),
    TAKES_VALUE_CASES: takesValueCases.join('\n'),
    OPTION_SPEC_CASES: optionSpecCases.join('\n'),
    POSITIONAL_SPEC_CASES: positionalSpecCases.join('\n'),
    LITERAL_POSITIONAL_CASES: literalPositionalKeys(nodes).map((key) => `      ${powerShellQuote(key)} { return $true }`).join('\n'),
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
