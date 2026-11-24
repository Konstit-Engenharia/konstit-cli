import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  flag,
  option,
} from '../src';

test('styles generated example rows without styling Options-like long help prose', async () => {
  const previousNoColor = Bun.env.NO_COLOR;
  delete Bun.env.NO_COLOR;
  const cli = command('tool', {
    about: 'Manage tools.',
    args: [
      flag('verbose', { describe: 'Show details\n  Extended explanation.' }),
      option('config'),
    ],
    author: 'Tool authors\n  Maintainer information.',
    longAbout: 'Options:\n  This is prose, not an option row.',
    examples: [
      { command: 'tool --verbose \\\n  --config "local file"', description: 'Run with details.' },
      { command: 'tool --config default', description: '' },
      { command: 'tool --verbose', description: '' },
    ],
  });
  const output: string[] = [];

  try {
    await cli.run({
      argv: ['--help'],
      color: true,
      stdout: (text) => output.push(text),
    });
  } finally {
    if (previousNoColor === undefined) {
      delete Bun.env.NO_COLOR;
    } else {
      Bun.env.NO_COLOR = previousNoColor;
    }
  }

  const accent = Bun.color('#0891b2', 'ansi-16m') ?? '';
  const commandColor = Bun.color('#22c55e', 'ansi-16m') ?? '';
  const valueColor = Bun.color('#2563eb', 'ansi-16m') ?? '';
  expect(accent).not.toBe('');
  const rendered = output[0] ?? '';
  expect(rendered).toStartWith(`\x1b[1m${accent}tool\x1b[0m Manage tools.\n\n`);
  expect(rendered).toContain(`\x1b[1m${accent}Options:\x1b[0m`);
  expect(rendered).toContain('Show details\n  Extended explanation.');
  expect(rendered).toContain('Tool authors\n  Maintainer information.');
  expect(Bun.stripANSI(rendered)).toBe(cli.renderHelp());
  expect(rendered).toContain('Options:\n  This is prose, not an option row.');
  expect(rendered).not.toContain(`Options:\n  ${accent}This is prose`);
  expect(rendered).toContain(`\x1b[1m${accent}Examples:\x1b[0m`);
  expect(rendered).toContain('  \x1b[2mRun with details.\x1b[0m');
  expect(rendered).toContain(`  \x1b[2m$\x1b[0m \x1b[1m${commandColor}tool\x1b[0m ${accent}--verbose\x1b[0m \\\n`);
  expect(rendered).toContain(`      ${accent}--config\x1b[0m ${valueColor}"local file"\x1b[0m`);
  expect(Bun.stripANSI(rendered)).toEndWith('  $ tool --config default\n  $ tool --verbose\n');
});
