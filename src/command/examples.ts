import {
  ArgumentAction,
  type ArgumentDefinition,
} from '../argument/index.js';
import { shellQuote } from '../completion/quotes.js';
import {
  isAuthoritativeEnumParser,
  parsers,
  type ValueParser,
} from '../parser/index.js';
import { getValueSource } from '../result/value-source.js';
import { tryParseConfigured } from './parse.js';
import {
  matchSubcommand,
  splitArgumentValue,
} from './parsing/recognition.js';
import type {
  CommandDefinition,
  CommandExampleDefinition,
  CommandExampleInput,
} from './schema.js';

interface ExampleValue {
  readonly token: string;
  readonly value: string | number | bigint | boolean;
}

const contextFreeParsers = new Set<ValueParser<unknown>>([
  parsers.string,
  parsers.integer,
  parsers.float,
  parsers.bigint,
  parsers.boolean,
  parsers.url,
  parsers.date,
  parsers.duration,
  parsers.byteSize,
]);

function exampleError(definition: CommandDefinition, message: string): TypeError {
  return new TypeError(`Invalid example for '${definition.name}': ${message}`);
}

function exampleValues(definition: CommandDefinition, argument: ArgumentDefinition, input: unknown): ExampleValue[] {
  const isArray = Array.isArray(input);
  const collectsValues = argument.repeatable || argument.trailingVarArg || argument.maxValues !== 1;
  if (collectsValues !== isArray && !(isArray && input.length === 0 && argument.minValues === 0)) {
    throw exampleError(definition, `'${argument.name}' requires ${collectsValues ? 'an array' : 'one value'}`);
  }
  const values: readonly unknown[] = isArray ? Array.from(input) : [input];
  return values.flatMap((value) => {
    if (
      typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'bigint'
      && (typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw exampleError(definition, `'${argument.name}' requires printable scalar values`);
    }
    const raw = String(value);
    if (/[\p{Cc}\p{Cf}]/u.test(raw)) {
      throw exampleError(definition, `'${argument.name}' requires printable scalar values`);
    }
    return splitArgumentValue(argument, raw).map((token) => ({ token, value: token === raw ? value : token }));
  });
}

function namedExampleTokens(
  definition: CommandDefinition,
  argument: ArgumentDefinition,
  input: unknown,
  values: readonly ExampleValue[],
): string[] {
  const option = argument.long === undefined ? `-${argument.short}` : `--${argument.long}`;
  if (argument.kind === 'flag') {
    if (typeof input !== 'boolean') {
      throw exampleError(definition, `'${argument.name}' requires a boolean`);
    }
    if (argument.negativeLong !== undefined) {
      return [input ? option : `--${argument.negativeLong}`];
    }
    return input === (argument.action !== ArgumentAction.SetFalse) ? [option] : [];
  }
  if (argument.kind === 'count') {
    if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
      throw exampleError(definition, `'${argument.name}' requires a nonnegative integer`);
    }
    return Array.from({ length: input }, () => option);
  }

  const rawValues = values.map(({ token }) => token);
  const maximum = argument.maxValues ?? rawValues.length;
  const occurrences = argument.repeatable && maximum > 0 ? Math.max(1, Math.ceil(rawValues.length / maximum)) : 1;
  if (rawValues.length < occurrences * argument.minValues && !argument.hasDefaultMissingValue) {
    throw exampleError(definition, `'${argument.name}' requires at least ${argument.minValues} values per occurrence`);
  }
  const tokens: string[] = [];
  let offset = 0;
  for (let remaining = occurrences - 1; remaining >= 0; remaining -= 1) {
    const size = remaining === 0
      ? rawValues.length - offset
      : Math.min(maximum, rawValues.length - offset - remaining * argument.minValues);
    const valuesInOccurrence = rawValues.slice(offset, offset + size);
    const group = argument.valueDelimiter !== undefined && size > 0
      ? [valuesInOccurrence.join(argument.valueDelimiter)]
      : valuesInOccurrence;
    offset += size;
    const first = group[0];
    if (
      first !== undefined
      && (argument.requireEquals || first.startsWith('-') || first === argument.valueTerminator
        || matchSubcommand(definition, first).kind !== 'none')
    ) {
      tokens.push(`${option}=${first}`, ...group.slice(1));
    } else {
      tokens.push(option, ...group);
    }
    if (
      argument.valueTerminator !== undefined && (argument.maxValues === null || size < argument.maxValues)
      && !(first === undefined && argument.requireEquals && argument.hasDefaultMissingValue)
    ) {
      tokens.push(argument.valueTerminator);
    }
  }
  return tokens;
}

function compileExampleArgs(definition: CommandDefinition, args: Readonly<Record<string, unknown>>): string {
  for (const name of Object.keys(args)) {
    if (!definition.arguments.some((argument) => argument.name === name)) {
      throw exampleError(definition, `unknown argument '${name}'`);
    }
  }
  const options: string[] = [];
  const positionals: string[] = [];
  const trailing: string[] = [];
  const supplied = new Set<string>();
  const valueChecks: Array<() => boolean> = [];
  const lastPositional = definition.arguments.findLastIndex(({ kind, name }) =>
    kind === 'positional' && Object.hasOwn(args, name)
    && args[name] !== undefined && !(Array.isArray(args[name]) && args[name].length === 0)
  );
  let literalPositionals = false;
  const argumentsForValidation = definition.arguments.map((argument, index) => {
    const input = Object.hasOwn(args, argument.name) ? args[argument.name] : undefined;
    const parser = argument.parser;
    const values = input !== undefined && parser !== undefined ? exampleValues(definition, argument, input) : [];
    if (argument.kind === 'positional') {
      const tokens = values.map(({ token }) => token);
      const destination = argument.trailingVarArg ? trailing : positionals;
      if (tokens.length > 0) {
        supplied.add(argument.name);
        literalPositionals ||= tokens.some((token) =>
          token.startsWith('-') || token === 'help' || matchSubcommand(definition, token).kind !== 'none'
        );
        destination.push(...tokens);
      }
      if (
        index < lastPositional && argument.valueTerminator !== undefined
        && (argument.maxValues === null || tokens.length < argument.maxValues)
      ) {
        destination.push(argument.valueTerminator);
      }
    } else if (input !== undefined) {
      const tokens = namedExampleTokens(definition, argument, input, values);
      if (tokens.length > 0) {
        supplied.add(argument.name);
        options.push(...tokens);
      }
    }

    if (parser === undefined) {
      return argument;
    }
    let nextValue = 0;
    valueChecks.push(() => nextValue === values.length);
    return {
      ...argument,
      parser: {
        label: parser.label,
        parse(token: string) {
          const expected = values[nextValue++];
          if (expected === undefined || expected.token !== token) {
            throw new TypeError('value cannot be assigned to this argument');
          }
          return contextFreeParsers.has(parser) || isAuthoritativeEnumParser(parser) ? parser.parse(token) : expected.value;
        },
      },
    };
  });

  const argv = literalPositionals
    ? [...options, '--', ...positionals, ...trailing]
    : [...positionals, ...options, ...(trailing.length === 0 ? [] : ['--', ...trailing])];
  const subcommands = definition.subcommands.map(({ validate: _validate, ...child }) => ({ ...child, arguments: [], subcommands: [] }));
  const result = tryParseConfigured<Record<string, unknown>>(
    { ...definition, arguments: argumentsForValidation, subcommands },
    argv,
    false,
    { env: {} },
  );
  if (result.type === 'error') {
    throw exampleError(definition, result.error.message);
  }
  const assigned = result.type === 'display'
    ? argv.length === 0
    : (subcommands.length === 0 || result.value.subcommand === undefined)
      && [...supplied].every((name) => getValueSource(result.value, name) === 'cli')
      && valueChecks.every((check) => check());
  if (!assigned) {
    throw exampleError(definition, 'the provided arguments cannot be represented in this command line');
  }
  return argv.map((token) => /^[a-zA-Z0-9_./:@%+=,-]+$/.test(token) ? token : shellQuote(token)).join(' ');
}

/** Snapshots example input as shell text after checking the generated argument vector. */
export function prepareCommandExamples(
  definition: CommandDefinition,
  examples: readonly CommandExampleInput[],
): readonly CommandExampleDefinition[] {
  return Object.freeze(
    examples.map(({ command, args, description = '' }) =>
      Object.freeze(command === undefined ? { args: compileExampleArgs(definition, args), description } : { command, description })
    ),
  );
}
