import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  count,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import { getCommandDefinition } from '../src/command';
import type { CommandDefinition } from '../src/command/schema';
import { setCommandDefinition } from '../src/command/store';
import {
  describeCommand,
  renderManPage,
  renderMarkdown,
} from '../src/metadata';

describe('command metadata', () => {
  test('exports immutable callback-free metadata and filters hidden entries', () => {
    const dynamic = () => ['one'];
    const hidden = flag('secret', { hide: true });
    const cli = command('tool', {
      about: 'A tool',
      version: '1.2.3',
      aliases: ['t'],
      visibleAliases: ['utility'],
      args: [
        option('mode', parsers.enum(['fast', 'safe']), {
          short: 'm',
          aliases: ['profile'],
          deprecatedAliases: { profile: 'use --mode' },
          default: 'safe',
          env: 'TOOL_MODE',
          valueName: 'MODE',
          valueHint: 'file',
          complete: dynamic,
          describe: 'Execution mode',
        }),
        positional('input', parsers.string, { required: true }),
        count('verbose', { short: 'v' }),
        hidden,
      ],
      subcommands: [
        command('run', { about: 'Run it' }),
        command('internal', { hide: true }),
      ],
    });
    const metadata = describeCommand(cli);
    expect(metadata).toMatchObject({
      name: 'tool',
      path: ['tool'],
      aliases: [{ name: 'utility', visible: true }],
      arguments: [
        {
          name: 'mode',
          parser: { label: 'fast|safe', completions: ['fast', 'safe'] },
          completionHint: 'file',
          hasDynamicCompletion: true,
          defaultValue: 'safe',
          arity: { min: 1, max: 1 },
          env: 'TOOL_MODE',
          deprecatedAliases: { profile: 'use --mode' },
        },
        { name: 'input', presence: 'required' },
        { name: 'verbose', action: 'count' },
      ],
      subcommands: [{ name: 'run', path: ['tool', 'run'] }],
    });
    expect(metadata.arguments.some(({ name }) => name === 'secret')).toBe(false);
    expect(metadata.subcommands.some(({ name }) => name === 'internal')).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.arguments)).toBe(true);
    expect(Object.isFrozen(metadata.arguments[0])).toBe(true);
    expect(Object.isFrozen(metadata.arguments[0]?.parser)).toBe(true);
    expect(Object.isFrozen(metadata.subcommands[0])).toBe(true);
    expect('parse' in (metadata.arguments[0]?.parser ?? {})).toBe(false);
    expect('completion' in (metadata.arguments[0] ?? {})).toBe(false);
    expect(() => (metadata.arguments as unknown as unknown[]).push({})).toThrow();

    const all = describeCommand(cli, { includeHidden: true });
    expect(all.arguments.map(({ name }) => name)).toEqual(['mode', 'input', 'verbose', 'secret']);
    expect(all.subcommands.map(({ name }) => name)).toEqual(['run', 'internal']);
    expect(all.aliases.map(({ name }) => name)).toEqual(['utility', 't']);
  });

  test('copies safe defaults and omits callback or unsupported values', () => {
    const cyclic: Record<string, unknown> = { name: 'value' };
    cyclic.self = cyclic;
    class UnsupportedDefault {
      readonly name = 'class';
    }
    const sparseArray: unknown[] = [];
    sparseArray.length = 1;
    const arrayGetter: unknown[] = [];
    Object.defineProperty(arrayGetter, '0', {
      enumerable: true,
      get: () => 'dynamic',
    });
    const objectGetter: Record<string, unknown> = {};
    Object.defineProperty(objectGetter, 'value', {
      enumerable: true,
      get: () => 'dynamic',
    });
    const cli = command('values', {
      args: [
        option('big', parsers.bigint, { default: 9007199254740993n }),
        option('date', parsers.date, { default: new Date('2026-01-02T03:04:05.000Z') }),
        option('url', parsers.string, { default: new URL('https://example.com/path') as never }),
        option('regexp', parsers.string, { default: /safe/gi as never }),
        option('invalid-date', parsers.string, { default: new Date('invalid') as never }),
        option('nan', parsers.string, { default: Number.NaN as never }),
        option('bad', parsers.string, { default: (() => 'secret') as never }),
        option('cyclic', parsers.string, { default: cyclic as never }),
        option('array', parsers.string, { default: ['safe', () => 'hidden', 1] as never }),
        option('class', parsers.string, { default: new UnsupportedDefault() as never }),
        option('missing', parsers.string, { defaultMissing: 'fallback' }),
        option('safe-object', parsers.string, { default: { nested: ['safe', 1] } as never }),
        option('sparse-array', parsers.string, { default: sparseArray as never }),
        option('array-getter', parsers.string, { default: arrayGetter as never }),
        option('object-getter', parsers.string, { default: objectGetter as never }),
      ],
    });
    const metadata = describeCommand(cli, { includeHidden: true });
    expect(metadata.arguments[0]).toMatchObject({
      hasDefaultValue: true,
      defaultValue: '9007199254740993n',
    });
    expect(metadata.arguments[1]).toMatchObject({
      hasDefaultValue: true,
      defaultValue: '2026-01-02T03:04:05.000Z',
    });
    expect(metadata.arguments[2]?.defaultValue).toBe('https://example.com/path');
    expect(metadata.arguments[3]?.defaultValue).toBe('/safe/gi');
    for (const index of [4, 5, 6, 7, 8, 9]) {
      expect(metadata.arguments[index]?.hasDefaultValue).toBe(true);
      expect('defaultValue' in (metadata.arguments[index] ?? {})).toBe(false);
    }
    expect(metadata.arguments[10]).toMatchObject({
      hasDefaultMissingValue: true,
      defaultMissingValue: 'fallback',
    });
    expect(metadata.arguments[11]?.defaultValue).toEqual({ nested: ['safe', 1] });
    expect(Object.isFrozen(metadata.arguments[11]?.defaultValue)).toBe(true);
    expect(metadata.arguments[12]?.hasDefaultValue).toBe(true);
    expect(metadata.arguments[12]).not.toHaveProperty('defaultValue');
    expect(metadata.arguments[13]?.hasDefaultValue).toBe(true);
    expect(metadata.arguments[13]).not.toHaveProperty('defaultValue');
    expect(metadata.arguments[14]?.hasDefaultValue).toBe(true);
    expect(metadata.arguments[14]).not.toHaveProperty('defaultValue');
  });

  test('exports relations and group metadata with hidden filtering', () => {
    const cli = command('relations', {
      args: [
        option('source', parsers.string),
        option('target', parsers.string),
        option('hidden', parsers.string, { hide: true }),
        option('hidden-two', parsers.string, { hide: true }),
      ],
      requires: [['source', 'target']],
      requiresIf: [['source', 'ready', 'target']],
      requiresValue: [['source', 'target', 'enabled'], ['hidden', 'target', 'all']],
      requiredIfAny: [{ conditions: [['source', 'yes'], ['hidden', 'yes']], target: 'target' }],
      requiredIfAll: [{ conditions: [['source', 'yes']], target: 'target' }],
      requiredUnlessPresent: [{ alternatives: ['source'], target: 'target' }],
      requiredUnlessAll: [{ alternatives: ['source'], target: 'target' }],
      overrides: [['source', 'target']],
      conflicts: [['source', 'target']],
      exclusive: ['source', 'target'],
      groups: [{
        name: 'inputs',
        members: ['source', 'hidden'],
        required: true,
        multiple: true,
        requires: ['target'],
        conflicts: ['target'],
      }],
    });
    const metadata = describeCommand(cli);
    expect(metadata.requirements).toEqual([{ source: 'source', target: 'target' }]);
    expect(metadata.conditionalRequirements).toEqual([
      { source: 'source', target: 'target', expected: 'ready' },
    ]);
    expect(metadata.conditionalSetRequirements).toHaveLength(1);
    expect(metadata.requiresValue).toEqual([{ source: 'source', target: 'target', expected: 'enabled' }]);
    expect(Object.isFrozen(metadata.requiresValue)).toBe(true);
    expect(describeCommand(cli, { includeHidden: true }).requiresValue).toHaveLength(2);
    expect(metadata.requiredUnless).toEqual([{ target: 'target', alternatives: ['source'] }]);
    expect(metadata.requiredUnlessAll).toEqual([{ target: 'target', alternatives: ['source'] }]);
    expect(metadata.overrides).toEqual([{ source: 'source', target: 'target' }]);
    expect(metadata.conflicts).toEqual([['source', 'target']]);
    expect(metadata.exclusiveArguments).toEqual(['source', 'target']);
    expect(metadata.groups).toEqual([]);
    expect(Object.isFrozen(metadata.requirements)).toBe(true);
    expect(Object.isFrozen(metadata.groups[0])).toBe(true);
    expect(Object.isFrozen(metadata.groups[0]?.members)).toBe(true);
    expect(describeCommand(cli, { includeHidden: true }).groups[0]?.members)
      .toEqual(['source', 'hidden']);

    const hiddenRelations = command('hidden-relations', {
      args: [
        option('target', parsers.string),
        option('hidden-one', parsers.string, { hide: true }),
        option('hidden-two', parsers.string, { hide: true }),
      ],
      requiredIfAny: [{ conditions: [['hidden-one', 'yes']], target: 'target' }],
      groups: [{ name: 'hidden-group', members: ['hidden-one', 'hidden-two'] }],
      requiredUnlessPresent: [{ alternatives: ['hidden-one'], target: 'target' }],
      conflicts: [['hidden-one', 'hidden-two']],
    });
    const hiddenMetadata = describeCommand(hiddenRelations);
    expect(hiddenMetadata.conditionalSetRequirements).toEqual([]);
    expect(hiddenMetadata.groups).toEqual([]);
    expect(hiddenMetadata.requiredUnless).toEqual([]);
    expect(hiddenMetadata.conflicts).toEqual([]);

    const relationMarkdown = renderMarkdown(cli, { includeHidden: true, title: 'Relations `manual`' });
    const relationMan = renderManPage(cli, { includeHidden: true });
    expect(relationMarkdown).toContain('`source` requires `target` = `enabled`');
    expect(relationMan).toContain('.SH RELATIONS');
  });

  test('preserves deprecation metadata while hiding deprecated aliases by default', () => {
    const child = command('child', { about: 'Child' });
    const childDefinition = getCommandDefinition(child);
    const root = command('legacy');
    const rootDefinition = getCommandDefinition(root);
    const definition: CommandDefinition = Object.freeze({
      ...rootDefinition,
      deprecated: 'use modern',
      deprecatedAliases: {
        old: 'use modern',
        hiddenOld: 'internal alias',
      },
      aliases: Object.freeze([
        { name: 'old', visible: true },
        { name: 'hiddenOld', visible: false },
      ]),
      subcommands: Object.freeze([
        Object.freeze({ ...childDefinition, deprecated: 'use run' }),
      ]),
    });
    const opaque = {};
    setCommandDefinition(opaque, definition);
    const metadata = describeCommand(opaque as never);
    expect(metadata).toMatchObject({
      deprecated: 'use modern',
      deprecatedAliases: { old: 'use modern' },
      subcommands: [{ deprecated: 'use run' }],
    });
    expect(Object.keys(metadata.deprecatedAliases ?? {})).toEqual(['old']);
    const all = describeCommand(opaque as never, { includeHidden: true });
    expect(all.deprecatedAliases).toEqual({ old: 'use modern', hiddenOld: 'internal alias' });
    expect(renderMarkdown(opaque as never)).toContain('Deprecated');
    expect(renderManPage(opaque as never)).toContain('Deprecated');
  });

  test('exposes inherited globals once for nested metadata and documentation', () => {
    const cli = command('global', {
      args: [flag('color', { global: true })],
      subcommands: [
        command('run', { args: [flag('local')] }),
      ],
    });
    const metadata = describeCommand(cli);
    const child = metadata.subcommands[0];
    expect(metadata.inheritedArguments).toEqual([]);
    expect(child?.arguments.map(({ name }) => name)).toEqual(['local']);
    expect(child?.inheritedArguments.map(({ name }) => name)).toEqual(['color']);
    const markdown = renderMarkdown(cli);
    const childDocs = markdown.slice(markdown.indexOf('## Command `global run`'));
    expect(childDocs.split('\n').filter((line) => line.includes('--color'))).toHaveLength(1);
    expect(renderManPage(cli)).toContain('.B \\-\\-color');
  });
});

describe('documentation renderers', () => {
  const cli = command('docs', {
    about: 'Build *docs* safely',
    longAbout: 'Long <description>\n.second line',
    author: 'A [Team]',
    version: '2.0',
    beforeHelp: 'Before',
    afterHelp: 'After\n"quoted\npath\\x',
    overrideUsage: 'docs --custom',
    overrideHelp: 'Use `docs`.',
    args: [
      option('mode', parsers.enum(['one', 'two']), {
        short: 'm',
        describe: 'Mode *description* ~ maybe = eq',
        env: 'DOCS_MODE',
        default: 'one',
        deprecated: 'use --kind',
        valueHint: 'file',
        complete: () => ['one'],
      }),
      option(
        'fallback',
        parsers.custom('CHOICE', (value) => value, {
          completions: ['one'],
          completionHint: 'directory',
        }),
        {
          defaultMissing: 'one',
          aliases: ['fallback-mode'],
          deprecatedAliases: { 'fallback-mode': 'use --mode' },
        },
      ),
      option('pair', parsers.string, { numArgs: 2 }),
      option('tags', parsers.string, { numArgs: { min: 1 }, repeatable: true }),
      flag('verbose', { short: 'v' }),
      count('count', { short: 'c' }),
      colorFlag('color'),
      positional('path', parsers.string, { valueName: 'PATH' }),
    ],
    subcommands: [
      command('run', { about: 'Run `docs`', visibleAliases: ['r'] }),
      command('secret', { hide: true }),
    ],
    requires: [['mode', 'path']],
  });

  test('renders Markdown with paths, metadata, relations, and hidden filtering', () => {
    const tags = describeCommand(cli).arguments.find(({ name }) => name === 'tags');
    expect(tags?.hasDefaultValue).toBe(false);
    const markdown = renderMarkdown(cli);
    expect(markdown).toContain('# `docs`');
    expect(markdown).toContain('`docs --custom`');
    expect(markdown).toContain('`docs run`');
    expect(markdown).toContain('## Options');
    expect(markdown).toContain('DOCS\\_MODE');
    expect(markdown).toContain('\\~ maybe \\= eq');
    expect(markdown).toContain('## Relations');
    expect(markdown).not.toContain('secret');
    expect(markdown).toContain('Long \\<description\\>');
    expect(markdown.endsWith('\n')).toBe(true);
    expect(renderMarkdown(cli, { includeHidden: true, title: 'Docs *manual*' }))
      .toContain('secret');
  });

  test('renders safe roff with configurable header metadata and nested paths', () => {
    const man = renderManPage(cli, {
      includeHidden: true,
      title: 'docs-tool',
      section: '5',
      date: '2026-10-18',
      source: 'KONSTIT',
      manual: 'CLI Manual',
    });
    expect(man).toContain('.TH "DOCS\\-TOOL" "5" "2026\\-10\\-18" "KONSTIT" "CLI Manual"');
    expect(man).toContain('.SH SYNOPSIS');
    expect(man).toContain('.SH OPTIONS');
    expect(man).toContain('.SH COMMAND');
    expect(man).toContain('docs run');
    expect(man).toContain('docs secret');
    expect(man).toContain('Long <description>');
    expect(man).toContain('\\&.second line');
    expect(man.endsWith('\n')).toBe(true);
  });

  test('generates usage for required and optional arguments', () => {
    const syntax = command('syntax', {
      args: [
        option('required', parsers.string, { required: true }),
        flag('verbose'),
        count('count'),
        colorFlag('color'),
        positional('required-path', parsers.string, { required: true }),
        positional('optional-path'),
      ],
    });
    const markdown = renderMarkdown(syntax);
    const man = renderManPage(syntax);
    expect(markdown).toContain('syntax [OPTIONS] --required <STRING> <STRING> [STRING]');
    expect(markdown).toContain('--no-color');
    expect(man).toContain('.SH ARGUMENTS');
    expect(man).toContain('.SH OPTIONS');
  });

  test('renders complete argument arity in documentation usage', () => {
    const cli = command('arity', {
      args: [
        option('pair', parsers.string, { numArgs: 2 }),
        option('repeat', parsers.string, { numArgs: { min: 1, max: 2 }, repeatable: true }),
        option('exact', parsers.string, { defaultMissing: 'auto' }),
        positional('values', parsers.string, { numArgs: { min: 2, max: 3 }, repeatable: true }),
      ],
    });

    const markdown = renderMarkdown(cli);
    expect(markdown).toContain(
      '`arity [OPTIONS] [STRING] [STRING] [STRING]...`',
    );
    expect(markdown).toContain('syntax --pair \\<STRING\\> \\<STRING\\>');
    expect(markdown).toContain('syntax --repeat \\<STRING\\> \\[\\<STRING\\>\\]\\.\\.\\.');
    expect(markdown).toContain('syntax --exact\\[\\=\\<STRING\\>\\]');
    const man = renderManPage(cli);
    expect(man).toContain(
      '.B arity [OPTIONS] [STRING] [STRING] [STRING]...',
    );
    expect(man).toContain('syntax \\-\\-pair <STRING> <STRING>');
    expect(man).toContain('syntax \\-\\-repeat <STRING> [<STRING>]...');
    expect(man).toContain('syntax \\-\\-exact[=<STRING>]');
  });

  test('renders compact and unbounded documentation arity forms', () => {
    const options = command('option-arity', {
      args: [
        option('many', parsers.string, { numArgs: 9 }),
        option('range', parsers.string, { numArgs: { min: 9, max: 10 } }),
        option('unbounded', parsers.string, { numArgs: { min: 0 } }),
        option('unbounded-many', parsers.string, {
          numArgs: { min: 9 },
          repeatable: true,
        }),
      ],
    });
    const optionMarkdown = renderMarkdown(options);
    expect(optionMarkdown).toContain('syntax --many \\<STRING\\>\\{9\\}');
    expect(optionMarkdown).toContain('syntax --range \\<STRING\\>\\{9\\.\\.10\\}');
    expect(optionMarkdown).toContain('syntax --unbounded \\[\\<STRING\\>\\.\\.\\.\\]');
    expect(optionMarkdown).toContain('syntax --unbounded-many \\<STRING\\>\\{9\\.\\.\\}\\.\\.\\.');

    const optionalMany = renderMarkdown(command('optional-many', {
      args: [positional('values', parsers.string, { numArgs: 9 })],
    }));
    expect(optionalMany).toContain('syntax \\[STRING\\]\\{9\\}');

    const optionalTrailing = renderMarkdown(command('optional-trailing', {
      args: [positional('values', parsers.string, { trailingVarArg: true })],
    }));
    expect(optionalTrailing).toContain('syntax \\[STRING\\]\\.\\.\\.');

    const optionalUnbounded = renderMarkdown(command('optional-unbounded', {
      args: [positional('values', parsers.string, { numArgs: { min: 2 } })],
    }));
    expect(optionalUnbounded).toContain('syntax \\[\\<STRING\\> \\<STRING\\>\\.\\.\\.\\]');

    const requiredUnbounded = renderMarkdown(command('required-unbounded', {
      args: [positional('values', parsers.string, { numArgs: { min: 2 }, required: true })],
    }));
    expect(requiredUnbounded).toContain('syntax \\<STRING\\> \\<STRING\\>\\.\\.\\.');
  });
});
