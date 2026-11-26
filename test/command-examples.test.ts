import {
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  count,
  describeCommand,
  flag,
  option,
  parsers,
  positional,
  renderManPage,
  renderMarkdown,
} from '../src';
import { invoke } from '../src/testing';

void (() => {
  const args = [
    positional('input', parsers.string, { required: true }),
    option('mode', parsers.enum(['fast', 'safe'])),
    option('port', parsers.integer),
    flag('dryRun'),
  ] as const;
  command('tool', { args, examples: [{ args: { input: '.', mode: 'fast', port: 80, dryRun: true }, description: '' }] });
  // @ts-expect-error examples must supply required arguments
  command('tool', { args, examples: [{ args: {}, description: '' }] });
  // @ts-expect-error the key must be declared by the command
  command('tool', { args, examples: [{ args: { input: '.', path: './sample' }, description: '' }] });
  // @ts-expect-error enum values are inferred from the declared parser
  command('tool', { args, examples: [{ args: { input: '.', mode: 'other' }, description: '' }] });
  // @ts-expect-error the parsed port type is a number
  command('tool', { args, examples: [{ args: { input: '.', port: '80' }, description: '' }] });
  // @ts-expect-error flags take booleans
  command('tool', { args, examples: [{ args: { input: '.', dryRun: 1 }, description: '' }] });
  // @ts-expect-error a command without arguments has no accepted keys
  command('tool', { examples: [{ args: { input: '.' }, description: '' }] });
});

test('renders command examples in order and keeps them local to the selected help command', async () => {
  const first = { command: 'tool run', description: 'Run with defaults.' };
  const examples = [first, { command: 'tool run --dry', description: 'Preview the run.' }];
  const cli = command('tool', {
    examples,
    afterHelp: 'Report issues online.',
    subcommands: [command('run', {
      examples: [{ command: 'tool run --verbose', description: 'Show detailed output.' }],
    })],
  });
  first.description = 'Changed';
  examples.push({ command: 'tool other', description: 'Other.' });

  const metadata = describeCommand(cli);
  expect(metadata.examples).toEqual([
    { command: 'tool run', description: 'Run with defaults.' },
    { command: 'tool run --dry', description: 'Preview the run.' },
  ]);
  expect(Object.isFrozen(metadata.examples)).toBe(true);
  expect(Object.isFrozen(metadata.examples?.[0])).toBe(true);

  const root = await invoke(cli, ['--help']);
  expect(root.exitCode).toBe(0);
  expect(root.stdout).toEndWith(
    'Examples:\n  Run with defaults.\n  $ tool run\n  Preview the run.\n  $ tool run --dry\n\nReport issues online.\n',
  );
  const child = await invoke(cli, ['run', '--help']);
  expect(child.exitCode).toBe(0);
  expect(child.stdout).toEndWith('Examples:\n  Show detailed output.\n  $ tool run --verbose\n');
  expect(child.stdout).not.toContain('Run with defaults.');

  expect(renderMarkdown(cli)).toContain('### Examples\n\nShow detailed output\\.\n\n    tool run --verbose');
  expect(renderManPage(cli)).toContain('.SH EXAMPLES\n.PP\nShow detailed output.\n.RS\n.nf\ntool run \\-\\-verbose\n.fi\n.RE\n');
});

test('preserves multiline command layout and escapes documentation syntax', () => {
  const cli = command('tool', {
    examples: [{
      command: 'tool run \\\r\n  --value "`literal`"\r\n\r\n.br',
      description: 'Use *literal* <input>.',
    }],
  });
  expect(cli.renderHelp()).toContain('  Use *literal* <input>.\n  $ tool run \\\n      --value "`literal`"\n\n    .br');
  expect(renderMarkdown(cli)).toContain(
    '## Examples\n\nUse \\*literal\\* \\<input\\>\\.\n\n    tool run \\\n      --value "`literal`"\n    \n    .br',
  );
  expect(renderManPage(cli)).toContain(
    '.SH EXAMPLES\n.PP\nUse *literal* <input>.\n.RS\n.nf\ntool run \\e\n  \\-\\-value "`literal`"\n\n\\&.br\n.fi\n.RE\n',
  );
});

test('expands arguments against the canonical path of the example command', async () => {
  const example = { args: { tag: 'release candidate' }, description: 'Set the release tag.' };
  const publish = command('publish', {
    aliases: ['pub'],
    args: [option('tag')],
    examples: [example],
  });
  const cli = command('tool', {
    defaultToHelp: true,
    examples: [{ args: {}, description: '' }],
    subcommands: [command('repo', { subcommands: [publish] })],
  });
  example.args.tag = 'changed';

  expect(cli.renderHelp()).toEndWith('Examples:\n  $ tool\n');
  const nested = await invoke(cli, ['repo', 'pub', '--help']);
  expect(nested.exitCode).toBe(0);
  expect(nested.stdout).toEndWith('Examples:\n  Set the release tag.\n  $ tool repo publish --tag \'release candidate\'\n');
  expect(publish.renderHelp()).toEndWith('  $ publish --tag \'release candidate\'\n');

  const examples = describeCommand(cli).subcommands[0]?.subcommands[0]?.examples;
  expect(examples).toEqual([
    { command: 'tool repo publish --tag \'release candidate\'', description: 'Set the release tag.' },
  ]);
  expect(Object.isFrozen(examples?.[0])).toBe(true);
  expect(renderMarkdown(cli)).toContain('    tool repo publish --tag \'release candidate\'');
  expect(renderManPage(cli)).toContain('tool repo publish \\-\\-tag \'release candidate\'');
});

test('renders structured values with CLI spellings, arity, and shell quoting', () => {
  const cli = command('tool', {
    args: [
      positional('source', parsers.string, { required: true }),
      flag('cache', { negated: true }),
      count('verbose'),
      colorFlag('color'),
      option('label', parsers.string, { long: 'set-label', requireEquals: true }),
      option('mode', parsers.enum(['fast', 'safe'])),
      option('ranges', parsers.integer, { repeatable: true, numArgs: { min: 2, max: 3 } }),
      option('keys', parsers.string, { numArgs: 2, valueDelimiter: ',' }),
      option('inspect', parsers.string, { numArgs: 0 }),
      positional('tail', parsers.string, { trailingVarArg: true }),
    ],
    examples: [{
      args: {
        source: '-input',
        cache: false,
        verbose: 2,
        color: false,
        label: 'two words',
        mode: 'safe',
        ranges: [1, 2, 3, 4, 5],
        keys: ['x', '-y'],
        inspect: [],
        tail: ['--quiet', '$HOME'],
      },
      description: '',
    }],
  });
  expect(cli.renderHelp()).toEndWith(
    '  $ tool --cache --verbose --verbose --no-color \'--set-label=two words\' --mode safe --ranges 1 2 3 --ranges 4 5 --keys x,-y --inspect -- -input --quiet \'$HOME\'\n',
  );
});

test('allows documentation values without running custom parsers or validators', () => {
  const cli = command('tool', {
    args: [
      option(
        'input',
        parsers.custom('FILE', (): string => {
          throw new Error('Custom parser ran while generating documentation');
        }),
        { required: true },
      ),
      positional('first', parsers.string, { valueTerminator: ';' }),
      positional('second'),
      positional('tail', parsers.string, { trailingVarArg: true }),
    ],
    examples: [
      { args: { input: 'example.txt', second: 'sample', tail: ['one'] }, description: '' },
    ],
    validate() {
      throw new Error('Application validator ran while generating documentation');
    },
  });
  expect(cli.renderHelp()).toEndWith('  $ tool \';\' sample --input example.txt -- one\n');
});

test('renders structured examples with wrapper flags before a literal trailing positional', () => {
  const cli = command('wrap', {
    args: [
      flag('verbose'),
      positional('program', parsers.string, { required: true }),
      positional('args', parsers.string, { trailingVarArg: true, literal: true }),
    ],
    examples: [{ args: { verbose: true, program: 'node', args: ['--', '--verbose', '--help'] }, description: '' }],
  });
  expect(cli.renderHelp()).toEndWith('  $ wrap --verbose node -- --verbose --help\n');
  expect(describeCommand(cli).arguments.at(-1)?.literal).toBe(true);
});

test('renders a joined trailing value as one quoted argument in structured examples', () => {
  const args = [positional('path', parsers.path({ kind: 'file' }), {
    trailingVarArg: true,
    literal: true,
    joinWith: ' ',
    valueDelimiter: ',',
  })] as const;
  const cli = command('wrap', {
    args,
    examples: [{ args: { path: ['My Documents/a,b.txt'] }, description: '' }],
  });
  expect(cli.renderHelp()).toEndWith('  $ wrap \'My Documents/a,b.txt\'\n');
  expect(describeCommand(cli).arguments[0]?.joinWith).toBe(' ');
  expect(() => command('wrap', { args, examples: [{ args: { path: ['one', 'two'] }, description: '' }] })).toThrow(
    'accepts at most one joined value',
  );
});

test('uses an option terminator before the next structured flag', () => {
  const cli = command('tool', {
    args: [
      option('values', parsers.string, { numArgs: { min: 1 }, valueTerminator: ';', allowHyphenValues: true }),
      flag('debug'),
    ],
    examples: [
      { args: { values: ['one'], debug: true }, description: '' },
    ],
  });
  expect(cli.renderHelp()).toEndWith('  $ tool --values one \';\' --debug\n');
});

test('rejects structured examples with values that would be assigned to other arguments or commands', () => {
  expect(() =>
    command('tool', {
      args: [positional('first'), positional('second')],
      examples: [{ args: { second: 'value' }, description: '' }],
    })
  ).toThrow('value cannot be assigned to this argument');

  expect(() =>
    command('tool', {
      args: [option('items', parsers.string, { numArgs: { min: 1 } })],
      subcommands: [command('child', {
        validate() {
          throw new Error('Subcommand validator ran while generating documentation');
        },
      })],
      examples: [{ args: { items: ['first', 'child'] }, description: '' }],
    })
  ).toThrow('cannot be represented in this command line');
});

test.each([
  [{ extra: 'value' }, 'unknown argument \'extra\''],
  [{ mode: true }, 'expected one of'],
  [{ mode: 'skip' }, 'expected one of'],
  [{ mode: ['fast'] }, '\'mode\' requires one value'],
  [{ mode: { nested: true } }, '\'mode\' requires printable scalar values'],
  [{ mode: 'fast\nslow' }, '\'mode\' requires printable scalar values'],
  [{ color: 'yes' }, '\'color\' requires a boolean'],
  [{ verbose: -1 }, '\'verbose\' requires a nonnegative integer'],
  [{ ranges: [1] }, '\'ranges\' requires at least 2 values'],
  [{ input: '.', ranges: [1.5, 2] }, 'expected an integer'],
  [{ mode: 'fast' }, 'required arguments were not provided'],
])('rejects malformed structured example %j', (args, error) => {
  expect(() =>
    command('tool', {
      args: [
        option('mode', parsers.enum(['fast', 'safe'])),
        colorFlag('color'),
        count('verbose'),
        option('ranges', parsers.integer, { repeatable: true, numArgs: 2 }),
        positional('input', parsers.string, { required: true }),
      ],
      examples: [{ args, description: '' } as never],
    })
  ).toThrow(error);
});

test('renders examples without descriptions', () => {
  const cli = command('tool', {
    args: [flag('debug')],
    examples: [{ args: { debug: true } }, { command: 'tool' }],
  });
  expect(cli.renderHelp()).toEndWith('Examples:\n  $ tool --debug\n  $ tool\n');
  expect(describeCommand(cli).examples).toEqual([
    { command: 'tool --debug', description: '' },
    { command: 'tool', description: '' },
  ]);
  expect(renderMarkdown(cli)).toContain('## Examples\n\n    tool --debug\n\n    tool\n');
  expect(renderManPage(cli)).toContain('.SH EXAMPLES\n.PP\n.RS\n.nf\ntool \\-\\-debug\n.fi\n.RE\n.PP\n.RS\n.nf\ntool\n');
});

test('validates example records and omits empty example sections', () => {
  expect(() => command('tool', { examples: {} as never })).toThrow('must be an array');
  expect(() => command('tool', { examples: [null as never] })).toThrow('must be an object');
  expect(() => command('tool', { examples: [{ command: 'tool', description: 1 } as never] })).toThrow('description must be a string');
  expect(() => command('tool', { examples: [{ description: '' } as never] })).toThrow('exactly one of command');
  expect(() => command('tool', { examples: [{ command: 'tool', args: {}, description: '' } as never] }))
    .toThrow('exactly one of command');

  const empty = command('tool', { examples: [] });
  expect(describeCommand(empty).examples).toBeUndefined();
  expect(empty.renderHelp()).not.toContain('Examples');
  expect(renderMarkdown(empty)).not.toContain('Examples');
  expect(renderManPage(empty)).not.toContain('EXAMPLES');
});
