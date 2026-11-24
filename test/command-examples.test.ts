import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  describeCommand,
  renderManPage,
  renderMarkdown,
} from '../src';
import { invoke } from '../src/testing';

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
    'Examples:\n\n  Run with defaults.\n    tool run\n\n  Preview the run.\n    tool run --dry\n\nReport issues online.\n',
  );
  const child = await invoke(cli, ['run', '--help']);
  expect(child.exitCode).toBe(0);
  expect(child.stdout).toEndWith('Examples:\n\n  Show detailed output.\n    tool run --verbose\n');
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
  expect(cli.renderHelp()).toContain('  Use *literal* <input>.\n    tool run \\\n      --value "`literal`"\n    \n    .br');
  expect(renderMarkdown(cli)).toContain(
    '## Examples\n\nUse \\*literal\\* \\<input\\>\\.\n\n    tool run \\\n      --value "`literal`"\n    \n    .br',
  );
  expect(renderManPage(cli)).toContain(
    '.SH EXAMPLES\n.PP\nUse *literal* <input>.\n.RS\n.nf\ntool run \\e\n  \\-\\-value "`literal`"\n\n\\&.br\n.fi\n.RE\n',
  );
});

test('validates example records and omits empty example sections', () => {
  expect(() => command('tool', { examples: {} as never })).toThrow('must be an array');
  expect(() => command('tool', { examples: [null as never] })).toThrow('must be an object');
  expect(() => command('tool', { examples: [{ command: 'tool' } as never] })).toThrow('must contain string command and description');

  const empty = command('tool', { examples: [] });
  expect(describeCommand(empty).examples).toBeUndefined();
  expect(empty.renderHelp()).not.toContain('Examples');
  expect(renderMarkdown(empty)).not.toContain('Examples');
  expect(renderManPage(empty)).not.toContain('EXAMPLES');
});
