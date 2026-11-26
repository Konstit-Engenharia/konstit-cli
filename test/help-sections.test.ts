import {
  expect,
  test,
} from 'bun:test';
import {
  colorFlag,
  command,
  describeCommand,
  flag,
  getWarnings,
  option,
  parsers,
  positional,
  renderManPage,
  renderMarkdown,
} from '../src';

test('shows active option aliases and accepts deprecated aliases with a warning', () => {
  const cli = command('build', {
    args: [
      option('output', parsers.string, {
        short: 'o',
        valueName: 'FILE',
        aliases: ['out', 'old-output', 'destination'],
        deprecatedAliases: { 'old-output': 'Use --output.' },
      }),
      option('format', parsers.string, {
        aliases: ['old-format'],
        deprecatedAliases: { 'old-format': 'Use --format.' },
      }),
    ],
  });

  const help = cli.renderHelp();
  expect(help).toMatch(/-o, --output <FILE> +\[aliases: --out, --destination\]/);
  expect(help).not.toContain('--old-output');
  expect(help).not.toContain('--old-format');
  expect(help).not.toContain('[aliases: ]');

  const active = cli.parse(['--out', 'report.csv']);
  expect(active).toMatchObject({ type: 'value', value: { output: 'report.csv' } });
  expect(getWarnings(active)).toEqual([]);
  const deprecated = cli.parse(['--old-output', 'report.csv']);
  expect(deprecated).toMatchObject({ type: 'value', value: { output: 'report.csv' } });
  expect(getWarnings(deprecated)).toMatchObject([
    { kind: 'deprecated', target: 'alias', name: 'old-output', argumentName: 'output', message: 'Use --output.' },
  ]);
});

test('groups arguments under custom headings in help and documentation', () => {
  const cli = command('tool', {
    args: [
      positional('input', parsers.string, {
        required: true,
        helpHeading: 'Input files',
      }),
      option('output', parsers.string, {
        helpHeading: 'Output files',
      }),
      flag('verbose', {
        short: 'v',
        helpHeading: 'Logging',
      }),
    ],
  });

  expect(cli.renderHelp()).toContain(
    'Input files:\n  <input>\n\nOutput files:\n  --output <string>\n\nLogging:\n  -v, --verbose\n\nOptions:\n  -h, --help  Print help\n',
  );
  expect(renderMarkdown(cli)).toContain(
    '## Input files\n- `<input>` — syntax \\<string\\>; arity 1; parser string\n\n## Output files\n',
  );
  expect(renderManPage(cli)).toContain(
    '.SH "INPUT FILES"\n.TP\n.B <input>\nsyntax <string>; arity 1; parser string\n.SH "OUTPUT FILES"\n.TP\n.B \\-\\-output\n',
  );

  const metadata = describeCommand(cli);
  expect(metadata.arguments.map(({ helpHeading }) => helpHeading)).toEqual([
    'Input files',
    'Output files',
    'Logging',
  ]);
  expect(Object.isFrozen(metadata.arguments[0])).toBe(true);
});

test('renders one shared heading for positional and option arguments', () => {
  const cli = command('tool', {
    args: [
      positional('input', parsers.string, {
        required: true,
        helpHeading: 'Input "files"',
      }),
      option('output', parsers.string, {
        helpHeading: 'Input "files"',
      }),
    ],
  });

  expect(cli.renderHelp()).toContain(
    'Input "files":\n  <input>\n  --output <string>\n\nOptions:\n',
  );
  expect(cli.renderHelp().split('Input "files":')).toHaveLength(2);
  expect(renderMarkdown(cli).split('## Input "files"')).toHaveLength(2);
  expect(renderManPage(cli)).toContain('.SH "INPUT \\"FILES\\""\n');
  expect(renderManPage(cli).split('.SH "INPUT \\"FILES\\""')).toHaveLength(2);
});

test('keeps built-ins in a shared Options heading', () => {
  const cli = command('tool', {
    args: [
      positional('input', parsers.string, {
        required: true,
        helpHeading: 'Options',
      }),
    ],
  });

  const help = cli.renderHelp();
  expect(help).toContain('Options:\n  <input>\n  -h, --help  Print help\n');
  expect(help.split('Options:')).toHaveLength(2);
});

test('keeps the default options section for generated built-ins', () => {
  const cli = command('tool', {
    args: [option('output', parsers.string, { helpHeading: 'Output' })],
    version: '1.0.0',
  });

  expect(cli.renderHelp()).toContain(
    'Output:\n  --output <string>\n\nOptions:\n  -h, --help     Print help\n  -V, --version  Print version\n',
  );
});

test('accepts custom headings on inherited globals', () => {
  const verbose = flag('verbose', { global: true, helpHeading: 'Logging' });
  const cli = command('tool', {
    args: [verbose],
    subcommands: [command('run')],
  });

  expect(cli.renderHelp()).toContain('Logging:\n  --verbose\n');
  expect(cli.renderHelp()).toContain('Options:\n  -h, --help  Print help\n');
});

test('lists subcommand help in Commands when disableVersionFlag is off', () => {
  const options = {
    disableHelpSubcommand: true,
    subcommands: [command('run')],
  };
  const commands = 'Commands:\n  run\n  <command> --help  Print help text for command.\n';

  expect(command('tool', options).renderHelp()).toContain(commands);
  expect(command('tool', { ...options, disableVersionFlag: false }).renderHelp()).toContain(commands);
  expect(command('tool', { ...options, disableVersionFlag: true }).renderHelp()).not.toContain('<command> --help');
  expect(command('tool', { subcommands: [command('run', { disableHelpFlag: true })] }).renderHelp())
    .not.toContain('<command> --help');
});

test('can hide standard flags from descendant help while keeping them available', () => {
  const leaf = command('leaf', { version: '1.2.3', defaultToHelp: true });
  const cli = command('tool', {
    version: '3.0.0',
    args: [colorFlag('color')],
    subcommands: [
      command('branch', { version: '2.0.0', args: [flag('debug')], subcommands: [leaf] }),
    ],
    hideStandardFlagsInSubcommandHelp: true,
  });

  expect(cli.renderHelp()).toContain('--color, --no-color');
  expect(cli.renderHelp()).toContain('-h, --help');
  expect(cli.renderHelp()).toContain('-V, --version');
  expect(cli.renderHelp()).toContain('<command> --help');
  expect(leaf.renderHelp()).toContain('-h, --help');
  expect(cli.tryParse(['branch', '--help'])).toMatchObject({
    type: 'display',
    kind: 'help',
    output:
      'branch (2.0.0)\n\nUsage: tool branch [options] <command>\n\nCommands:\n  leaf\n  help  Print help for a subcommand\n\nOptions:\n  --debug\n',
  });
  for (
    const argv of [
      ['branch', 'leaf', '--help'],
      ['branch', 'leaf', '-h'],
      ['help', 'branch', 'leaf'],
      ['branch', 'help', 'leaf'],
      ['branch', 'leaf'],
    ]
  ) {
    expect(cli.tryParse(argv)).toMatchObject({
      type: 'display',
      kind: 'help',
      output: 'leaf (1.2.3)\n\nUsage: tool branch leaf\n',
    });
  }
  expect(cli.tryParse(['branch', 'leaf', '--version'])).toMatchObject({
    type: 'display',
    kind: 'version',
    output: 'leaf 1.2.3\n',
  });
  expect(cli.tryParse(['branch', '--no-color', '--debug'], { env: {} })).toMatchObject({
    type: 'value',
    value: { color: false, subcommand: { name: 'branch', args: { debug: true } } },
  });
});

test('rejects empty or multiline custom headings', () => {
  expect(() => option('output', parsers.string, { helpHeading: '' })).toThrow(
    'helpHeading\' cannot be empty',
  );
  expect(() => option('output', parsers.string, { helpHeading: 'Output\nfiles' })).toThrow(
    'helpHeading\' cannot contain line breaks',
  );
  expect(() => option('output', parsers.string, { helpHeading: 1 as never })).toThrow(
    'helpHeading\' must be a string',
  );
});
