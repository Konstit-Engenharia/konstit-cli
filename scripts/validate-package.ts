import assert from 'node:assert/strict';

const mainExport: string = '@konstit/cli';
const completionExport: string = '@konstit/cli/completion';
const cli = await import(mainExport) as typeof import('../src');
const completion = await import(completionExport) as typeof import('../src/completion');

assert.equal(typeof cli.command, 'function');
assert.equal(typeof cli.flag, 'function');
assert.equal('global' in cli, false);
assert.equal(typeof cli.parsers, 'object');
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

console.log('Validated package exports and built chunks.');
