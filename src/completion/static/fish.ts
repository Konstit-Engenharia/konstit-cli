import type { ArgumentDefinition } from '../../argument/types.js';
import {
  completionDefault,
  defaultOptions,
} from '../default-subcommand.js';
import {
  fishQuote,
  shellIdentifier,
} from '../quotes.js';
import { renderTemplate } from '../templates.js';
import {
  builtinOptionTokens,
  childEntries,
  childScanEntries,
  completionForArguments,
  declaredOptionTokens,
  defaultSubcommandEntries,
  hasVisiblePositionals,
  literalPositionalKeys,
  optionTokens,
  parsePositionals,
  visibleArguments,
  type CompletionNode,
} from './model.js';
import {
  encodeShellDelimiter,
  shellMaximum,
} from './spec.js';

export function generateFish(
  nodes: readonly CompletionNode[],
  executable: string,
): string {
  const name = `__bun_clap_${shellIdentifier(executable)}_context`;
  const commandPrefix = executable.includes('/')
    ? `complete -p ${fishQuote(executable)}`
    : `complete -c ${fishQuote(executable)}`;
  const registrations: string[] = [];
  const defaults = defaultSubcommandEntries(nodes);
  const routingNodes = defaults.length === 0 ? [] : nodes;

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
      if (argument.kind === 'option' && argument.maxValues !== 0) {
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
          ...(argument.kind === 'option' && argument.maxValues !== 0 ? ['-r'] : []),
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
    if (node.definition.enableJsonFlag) {
      registrations.push(
        `${commandPrefix} -n ${condition} -l json -d ${fishQuote('Print handler result as JSON')}`,
      );
    }
    const defaultCondition = fishQuote(`string match -q '${node.id}:*' (${name} default-options)`);
    for (const { value, argument, description } of defaultOptions(node.definition, node.arguments)) {
      const spelling = value.startsWith('--') ? `-l ${fishQuote(value.slice(2))}` : `-s ${fishQuote(value.slice(1))}`;
      const parts = [commandPrefix, `-n ${defaultCondition}`, spelling];
      if (argument?.kind === 'option' && argument.maxValues !== 0) {
        parts.push('-r');
      }
      if (description !== undefined) {
        parts.push(`-d ${fishQuote(description)}`);
      }
      registrations.push(...(argument === undefined ? [parts.join(' ')] : appendFishValueCompletion(parts, argument)));
    }
    const childList = childEntries(node, nodes);
    const defaultHasPositionals = completionDefault(node.definition)?.arguments.some(({ kind, hidden }) =>
      kind === 'positional' && !hidden
    );
    const disableFiles = !hasVisiblePositionals(node) && !defaultHasPositionals ? ' -f' : '';
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
      HAS_DEFAULT_SUBCOMMANDS: defaults.length === 0 ? '0' : '1',
      DEFAULT_SUBCOMMAND_CASES: defaults.map(([id, child,]) => `        case ${fishQuote(id)}; echo ${fishQuote(child)}`).join('\n'),
      SUBCOMMAND_TEST_CASES: routingNodes.flatMap((node) =>
        childScanEntries(node, nodes).map(([token,]) => `        case ${fishQuote(`${node.id}:${token}`)}; return 0`)
      ).join('\n'),
      OPTION_KIND_CASES: routingNodes.flatMap((node) => [
        ...builtinOptionTokens(node).map((token) => `        case ${fishQuote(`${node.id}:${token}`)}; echo builtin`),
        ...node.arguments.flatMap((argument) =>
          optionTokens(argument).map((token) =>
            `        case ${fishQuote(`${node.id}:${token}`)}; echo ${argument.kind === 'option' ? 'value' : 'switch'}`
          )
        ),
      ]).join('\n'),
      POSITIONAL_POLICY_CASES: routingNodes.flatMap((node) =>
        parsePositionals(node).map((argument, index) =>
          `        case ${fishQuote(`${node.id}:${index}`)}; echo ${argument.allowHyphenValues ? 1 : 0}${
            argument.allowNegativeNumbers ? 1 : 0
          }`
        )
      ).join('\n'),
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
      LITERAL_POSITIONAL_CASES: literalPositionalKeys(nodes).flatMap((key) => [
        `        case ${fishQuote(key)}`,
        '            return 0',
      ]).join('\n'),
      DECLARED_OPTION_CASES: nodes.flatMap((node) => {
        const tokens = declaredOptionTokens(node);
        return tokens.length === 0 ? [] : [
          `                case ${tokens.map((token) => fishQuote(`${node.id}:${token}`)).join(' ')}`,
          '                    set declared_option 1',
        ];
      }).join('\n'),
      KNOWN_OPTION_CASES: nodes.flatMap((node) => {
        const tokens = declaredOptionTokens(node);
        return tokens.length === 0 ? [] : [
          `                case ${tokens.map((token) => fishQuote(`${node.id}:${token}`)).join(' ')}`,
          '                    set known_cluster_option 1',
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
  if (argument.kind !== 'option' || argument.maxValues === 0) {
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
