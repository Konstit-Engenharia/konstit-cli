import type { ArgumentDefinition } from '../../argument/types.js';
import type { CommandDefinition } from '../../command/schema.js';
import type { CompletionValueHint } from '../../parser/index.js';

export interface CompletionNode {
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

export function flattenCommands(root: CommandDefinition): readonly CompletionNode[] {
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

export function visibleArguments(node: CompletionNode): readonly ArgumentDefinition[] {
  return node.arguments.filter(({ hidden }) => !hidden);
}

export function childEntries(
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

export function childScanEntries(
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

export function optionTokens(argument: ArgumentDefinition): readonly string[] {
  return [
    ...(argument.short === undefined ? [] : [`-${argument.short}`]),
    ...(argument.long === undefined ? [] : [`--${argument.long}`]),
    ...(argument.negativeLong === undefined ? [] : [`--${argument.negativeLong}`]),
    ...argument.aliases.map((alias) => `--${alias}`),
  ];
}

export function completionForArguments(
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

export function valueCompletions(node: CompletionNode): readonly ValueCompletion[] {
  const definitions: ValueCompletion[] = [];
  for (const argument of visibleArguments(node)) {
    if (argument.kind !== 'option' || argument.maxValues === 0) {
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

export function parsePositionals(node: CompletionNode): readonly ArgumentDefinition[] {
  return node.arguments.filter(({ kind }) => kind === 'positional');
}

export function valueOptionTokens(node: CompletionNode): readonly string[] {
  return visibleArguments(node)
    .filter(({ kind, maxValues }) => kind === 'option' && maxValues !== 0)
    .flatMap(optionTokens);
}

export function declaredOptionTokens(node: CompletionNode): readonly string[] {
  return node.arguments.filter(({ kind }) => kind !== 'positional').flatMap(optionTokens);
}

export function builtinOptionTokens(node: CompletionNode): readonly string[] {
  return [
    ...(node.definition.disableHelpFlag ? [] : ['-h', '--help']),
    ...(node.definition.version === undefined || node.definition.disableVersionFlag ? [] : ['-V', '--version']),
  ];
}

export function candidates(
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

export function hasVisiblePositionals(node: CompletionNode): boolean {
  return visibleArguments(node).some(({ kind }) => kind === 'positional');
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
