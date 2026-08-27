import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const mainExport: string = '@konstit/cli';
const completionExport: string = '@konstit/cli/completion';
const cli = await import(mainExport) as typeof import('../src');
const completion = await import(completionExport) as typeof import('../src/completion');

assert.equal(typeof cli.command, 'function');
assert.equal(typeof cli.flag, 'function');
assert.equal('global' in cli, false);
assert.equal(typeof cli.parsers, 'object');
assert.equal(cli.parsers.regex(/^valid$/).parse('valid'), 'valid');
assert.equal(cli.parsers.duration.parse('1.5s'), 1_500);
assert.equal(cli.parsers.byteSize.parse('1KiB'), 1_024);
assert.deepEqual(cli.parsers.keyValue.parse('MODE=safe'), {
  key: 'MODE',
  value: 'safe',
});
assert.equal(cli.parsers.cron.parse('*/15 * * * *'), '*/15 * * * *');
assert.equal(cli.parsers.color.parse('oklch(65% 0.2 30)'), 'oklch(65% 0.2 30)');
assert.equal(typeof completion.generateCompletion, 'function');
assert.equal(typeof completion.resolveDynamicCompletion, 'function');

const configured = cli.command('validate', {
  version: '1.0.0',
  about: 'Validate the built package',
  args: [
    cli.count('verbose', { global: true, short: 'v' }),
    cli.option(
      'color',
      cli.parsers.enum(['auto', 'always', 'never']),
      { global: true, default: 'auto' },
    ),
    cli.option('tag', cli.parsers.string, { repeatable: true }),
  ],
  subcommands: [cli.command('status', { handler: () => 4 })],
  defaultToHelp: true,
});
assert.equal(Object.isFrozen(configured), true);
assert.equal('arg' in configured, false);
assert.equal('required' in cli.option('value'), false);
const bash = completion.generateCompletion(configured, 'bash');

assert.match(bash, /# bash completion for validate/);
assert.match(configured.renderHelp(), /Validate the built package/);
assert.match(configured.renderHelp(), /--verbose/);
assert.match(configured.renderHelp(), /status/);
assert.equal(configured.tryParse([]).type, 'display');
assert.equal(configured.tryParse(['--version']).type, 'display');
assert.equal(await configured.run(['status']), 4);
const parsed = configured.parse(['-vv']);
assert.equal(parsed.type, 'value');
if (parsed.type !== 'value') {
  throw new Error('Expected parsed package arguments');
}
assert.deepEqual(parsed.value, {
  verbose: 2,
  color: 'auto',
  tag: [],
  subcommand: undefined,
});
assert.deepEqual(cli.completionShells, completion.completionShells);

const consumerDirectory = await mkdtemp(resolve(root, '.node-next-consumer-'));
try {
  await writeFile(
    resolve(consumerDirectory, 'consumer.ts'),
    [
      'import { command, option, parsers } from \'@konstit/cli\';',
      'import { resolveDynamicCompletion } from \'@konstit/cli/completion\';',
      '',
      'const consumer = command(\'consumer\', {',
      '  args: [option(\'port\', parsers.integer, { required: true })],',
      '});',
      'void resolveDynamicCompletion(consumer, [\'--port\', \'\']);',
      '',
    ].join('\n'),
  );
  await writeFile(
    resolve(consumerDirectory, 'tsconfig.json'),
    `${
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ESNext',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            exactOptionalPropertyTypes: true,
            skipLibCheck: false,
            noEmit: true,
          },
          files: ['consumer.ts'],
        },
        null,
        2,
      )
    }\n`,
  );
  const typecheck = Bun.spawnSync(
    [
      process.execPath,
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '--project',
      resolve(consumerDirectory, 'tsconfig.json'),
    ],
    { cwd: consumerDirectory, stdout: 'pipe', stderr: 'pipe' },
  );
  assert.equal(
    typecheck.exitCode,
    0,
    `NodeNext consumer typecheck failed:\n${typecheck.stdout.toString()}${typecheck.stderr.toString()}`,
  );
} finally {
  await rm(consumerDirectory, { recursive: true, force: true });
}

console.log('Validated package exports, built chunks, and NodeNext declarations.');
