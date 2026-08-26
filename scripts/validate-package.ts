import assert from 'node:assert/strict';

const mainExport: string = '@konstit/cli';
const completionExport: string = '@konstit/cli/completion';
const cli = await import(mainExport) as typeof import('../src');
const completion = await import(completionExport) as typeof import('../src/completion');

assert.equal(typeof cli.command, 'function');
assert.equal(typeof cli.flag, 'function');
assert.equal(typeof cli.parsers, 'object');
assert.equal(typeof completion.generateCompletion, 'function');
assert.equal(typeof completion.resolveDynamicCompletion, 'function');

const configured = cli.command('validate').arg(cli.flag('verbose'));
const bash = completion.generateCompletion(configured, 'bash');

assert.match(bash, /# bash completion for validate/);
assert.deepEqual(cli.completionShells, completion.completionShells);

console.log('Validated package exports and built chunks.');
