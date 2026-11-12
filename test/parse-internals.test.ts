import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  DisplayKind,
  flag,
  option,
  parsers,
} from '../src';
import {
  ArgumentAction,
  getArgumentDefinition,
  type ArgumentDefinition,
} from '../src/argument';
import { getCommandDefinition } from '../src/command';
import { parseConfigured } from '../src/command/parse';
import type { CommandDefinition } from '../src/command/schema';
import { setCommandDefinition } from '../src/command/store';
import { validateCommandRelations } from '../src/command/validation';
import { generateCompletion } from '../src/completion';
import { resolveDynamicCompletion } from '../src/dynamic-completion';
import { renderMarkdown } from '../src/metadata';

function definitionWithArguments(...args: ArgumentDefinition[]): CommandDefinition {
  return { ...getCommandDefinition(command('tool')), arguments: args };
}

describe('internal parser invariants', () => {
  test('stops parsing and completion scanning at an undefined runtime token', async () => {
    const cli = command('tool', { args: [flag('verbose', { short: 'v' })] });
    const argv = [undefined, '--unknown'] as unknown as string[];
    expect(cli.parse(argv)).toMatchObject({ type: 'value', value: { verbose: false } });
    const result = await resolveDynamicCompletion(cli, [...argv, '']);
    expect(result.candidates).toContainEqual({ value: '--verbose' });
  });

  test('ignores an override whose target is absent from an internal definition', () => {
    const definition = {
      ...definitionWithArguments(getArgumentDefinition(flag('clear'))),
      overrides: [{ source: 'clear', target: 'missing' }],
    };
    expect(parseConfigured(definition, ['--clear'], false))
      .toMatchObject({ type: 'value', value: { clear: true } });
  });

  test('renders internal help actions and validates version actions', () => {
    const argument = getArgumentDefinition(flag('display'));
    for (const action of [ArgumentAction.Help, ArgumentAction.HelpShort, ArgumentAction.HelpLong]) {
      expect(parseConfigured(definitionWithArguments({ ...argument, action }), ['--display'], false))
        .toMatchObject({ type: 'display', kind: DisplayKind.Help, output: expect.stringContaining('Usage:') });
    }
    const version = definitionWithArguments({ ...argument, action: ArgumentAction.Version });
    expect(() => parseConfigured(version, ['--display'], false))
      .toThrow('Command \'tool\' must define a version for \'--display\'');
    expect(parseConfigured({ ...version, version: '1.2.3' }, ['--display'], false))
      .toEqual({ ok: true, type: 'display', kind: DisplayKind.Version, output: 'tool 1.2.3\n' });
  });

  test('rejects non-switch actions and missing value parsers', () => {
    const invalidSwitch = { ...getArgumentDefinition(flag('value')), action: ArgumentAction.Set };
    expect(() => parseConfigured(definitionWithArguments(invalidSwitch), ['--value'], false))
      .toThrow('Action \'set\' is not a switch action');
    const missingParser = { ...getArgumentDefinition(option('value')), parser: undefined };
    expect(() => parseConfigured(definitionWithArguments(missingParser), ['--value', 'text'], false))
      .toThrow('Argument \'value\' has no value parser');
  });

  test('detects a collection shape changed while parsing an occurrence', () => {
    const argument = {
      ...getArgumentDefinition(option('value')),
      parser: parsers.custom('VALUE', (raw) => {
        if (raw === 'second') {
          argument.repeatable = true;
        }
        return raw;
      }),
    };
    expect(() => parseConfigured(definitionWithArguments(argument), ['--value', 'first', '--value', 'second'], false))
      .toThrow('Internal parser state for \'value\' is not an array');
  });

  test('skips a conditional default target that disappears during validation', () => {
    const definition = definitionWithArguments(getArgumentDefinition(flag('source')), getArgumentDefinition(flag('target')));
    let reads = 0;
    const rule = {
      source: 'source',
      get target() {
        reads += 1;
        return reads <= 2 ? 'target' : 'missing';
      },
      value: true,
    };
    expect(() => validateCommandRelations({ defaultIf: [rule] }, definition)).not.toThrow();
    expect(reads).toBeGreaterThan(2);
  });

  test('honors NO_COLOR when config evaluation changes the environment', () => {
    const previous = Bun.env.NO_COLOR;
    delete Bun.env.NO_COLOR;
    const argument = { ...getArgumentDefinition(colorFlag('color')) };
    delete argument.env;
    let reads = 0;
    const values = {
      get color() {
        reads += 1;
        if (reads === 2) {
          Bun.env.NO_COLOR = '';
        }
        return true;
      },
    };
    try {
      expect(parseConfigured(definitionWithArguments(argument), [], false, { config: { values } }))
        .toMatchObject({ type: 'value', value: { color: false } });
    } finally {
      if (previous === undefined) {
        delete Bun.env.NO_COLOR;
      } else {
        Bun.env.NO_COLOR = previous;
      }
    }
  });
});

test('documents unnamed internal options and omits their completion values', () => {
  const cli = command('tool');
  const argument = { ...getArgumentDefinition(option('value', parsers.enum(['first-choice', 'second-choice']))) };
  delete argument.long;
  setCommandDefinition(cli, definitionWithArguments(argument));
  expect(renderMarkdown(cli)).toContain('syntax value');
  expect(generateCompletion(cli, 'zsh')).not.toContain('first-choice');
});
