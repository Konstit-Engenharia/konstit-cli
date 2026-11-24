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
const testingExport: string = '@konstit/cli/testing';
const cli = await import(mainExport) as typeof import('../src');
const completion = await import(completionExport) as typeof import('../src/completion');
const testing = await import(testingExport) as typeof import('../src/testing');

assert.equal(typeof cli.command, 'function');
assert.equal(typeof cli.flag, 'function');
assert.equal('global' in cli, false);
assert.equal(typeof cli.parsers, 'object');
assert.equal(cli.parsers.regex(/^valid$/).parse('valid'), 'valid');
assert.equal(cli.parsers.path({ kind: 'directory', mustExist: true }).parse(root), root);
assert.equal(cli.parsers.duration.parse('500'), 500);
assert.equal(cli.parsers.duration.parse('1.5s'), 1_500);
assert.equal(cli.parsers.byteSize.parse('1KiB'), 1_024);
assert.equal(cli.parsers.byteSize.parse('512'), 512);
assert.deepEqual(cli.parsers.keyValue.parse('MODE=safe'), {
  key: 'MODE',
  value: 'safe',
});
assert.equal(cli.parsers.cron.parse('*/15 * * * *'), '*/15 * * * *');
assert.equal(cli.parsers.color.parse('oklch(65% 0.2 30)'), 'oklch(65% 0.2 30)');
assert.equal(cli.parsers.map(cli.parsers.integer, (value) => value * 2).parse('3'), 6);
assert.equal(cli.parsers.refine(cli.parsers.integer, (value) => value > 0).parse('3'), 3);
assert.equal(typeof completion.generateCompletion, 'function');
assert.equal(typeof completion.resolveDynamicCompletion, 'function');

const configured = cli.command('validate', {
  version: '1.0.0',
  about: 'Validate the built package',
  examples: [{ command: 'validate status', description: 'Report the current status.' }],
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
assert.deepEqual(cli.generateConfigSchema(configured).properties.values.properties.verbose, {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
});
assert.equal('arg' in configured, false);
assert.equal('required' in cli.option('value'), false);
const bash = completion.generateCompletion(configured, 'bash');

assert.match(bash, /# bash completion for validate/);
assert.match(configured.renderHelp(), /Validate the built package/);
assert.match(configured.renderHelp(), /--verbose/);
assert.match(configured.renderHelp(), /status/);
assert.ok(configured.renderHelp().includes('Examples:\n  Report the current status.\n  $ validate status'));
assert.equal(configured.tryParse([]).type, 'display');
assert.equal(configured.tryParse(['--version']).type, 'display');
assert.equal(await configured.run(['status']), 4);
const help = configured.renderHelp();
assert.deepEqual(await testing.invoke(configured, ['--help']), {
  exitCode: 0,
  stdout: help,
  stderr: '',
  writes: [{ stream: 'stdout', chunk: help }],
});
const failing = cli.command('fail', {
  handler: () => {
    throw new cli.CommandFailure('Package handler failed.', 4);
  },
});
assert.deepEqual(await testing.invoke(failing, []), {
  exitCode: 4,
  stdout: '',
  stderr: 'Package handler failed.\n',
  writes: [{ stream: 'stderr', chunk: 'Package handler failed.\n' }],
});
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

const documented = cli.command('documented', {
  args: [cli.option('port', cli.parsers.integer, {
    aliases: ['listen'],
    deprecatedAliases: { listen: 'Use --port.' },
    default: 3000,
    sensitive: true,
  })],
  validate: ({ port }) => port < 1 ? { argumentName: 'port', message: 'Port must be positive.' } : undefined,
  handler: () => 0,
});
const fromValidation = documented.tryParse(['--port', '0']);
assert.equal(fromValidation.type, 'error');
assert.equal(fromValidation.error.argumentName, 'port');
assert.equal(fromValidation.error.kind, cli.ErrorKind.InvalidValue);
const fromConfig = documented.parse([], { config: { values: { port: '8080' } } });
assert.equal(fromConfig.type, 'value');
if (fromConfig.type !== 'value') {
  throw new Error('Expected parsed config value');
}
assert.equal(fromConfig.value.port, 8080);
assert.equal(cli.getValueSource(fromConfig.value, 'port'), 'config');
assert.equal(cli.describeCommand(documented).arguments[0]?.name, 'port');
assert.equal(cli.describeCommand(documented).arguments[0]?.defaultValue, undefined);
assert.ok(!documented.renderHelp().includes('3000'));
assert.match(cli.renderMarkdown(documented), /documented/);
assert.match(cli.renderManPage(documented), /\.TH/);
assert.equal(cli.getWarnings(documented.parse(['--listen', '9000'])).length, 1);

const previousNoColor = Bun.env.NO_COLOR;
delete Bun.env.NO_COLOR;
try {
  const messages: string[] = [];
  const styled = cli.command('styled', {
    args: [cli.colorFlag('color')],
    handler: async (_args, { output, style, stdin, stdout, stderr }) => {
      assert.equal(Object.isFrozen(style), true);
      assert.equal(Object.isFrozen(output), true);
      assert.equal(await new Response(stdin).text(), 'package input');
      assert.equal(output.info('ready'), undefined);
      output.error('failure');
      assert.deepEqual(messages, ['ready\n', '\x1b[38;2;220;38;38mfailure\x1b[0m\n']);
      await stdout(style('done', { bold: true }));
      await stdout(style.link('https://example.com/docs', { label: 'Docs' }));
      assert.equal(style.file('report.csv', { label: 'report' }), '\x1b[32mreport\x1b[0m');
      await stderr(style.path(resolve(root, 'README.md'), { stream: 'stderr', label: 'README' }));
    },
  });
  assert.equal(
    await styled.runParsed(styled.parse(['--color']), {
      color: false,
      lsColors: '*.csv=32:*.md=34',
      stdin: new Blob(['package input']).stream(),
      output: {
        stdout: (chunk) => messages.push(chunk),
        stderr: (chunk) => messages.push(chunk),
      },
      stdout: async (chunk) => messages.push(chunk),
      stderr: async (chunk) => messages.push(chunk),
    }),
    0,
  );
  assert.deepEqual(messages, [
    'ready\n',
    '\x1b[38;2;220;38;38mfailure\x1b[0m\n',
    '\x1b[1mdone\x1b[0m',
    '\x1b]8;;https://example.com/docs\x1b\\Docs\x1b]8;;\x1b\\',
    '\x1b[34mREADME\x1b[0m',
  ]);
} finally {
  if (previousNoColor === undefined) {
    delete Bun.env.NO_COLOR;
  } else {
    Bun.env.NO_COLOR = previousNoColor;
  }
}

const defaults = cli.command('defaults', {
  args: [
    cli.option(
      'mode',
      cli.parsers.enum([
        { value: 'development', aliases: ['dev'] },
        { value: 'production', aliases: ['prod'], describe: 'Production mode' },
        { value: 'legacy', hide: true },
      ], { ignoreCase: true }),
      { default: 'development' },
    ),
    cli.option('port', cli.parsers.integer, { default: 3000 }),
    cli.option('tag', cli.parsers.string, { repeatable: true, defaultValues: ['local'] }),
  ],
  defaultIf: [{ source: 'mode', equals: 'production', target: 'port', value: 443 }],
  argsOverrideSelf: true,
});
const fromDefaults = defaults.parse(['--mode', 'dev', '--mode', 'PROD']);
assert.equal(fromDefaults.type, 'value');
if (fromDefaults.type !== 'value') {
  throw new Error('Expected parsed conditional defaults');
}
assert.deepEqual(fromDefaults.value, { mode: 'production', port: 443, tag: ['local'] });
assert.equal(cli.getValueSource(fromDefaults.value, 'port'), 'default');
assert.equal(cli.describeCommand(defaults).defaultIf[0]?.value, 443);
assert.match(defaults.renderHelp(), /Production mode/);
assert.doesNotMatch(defaults.renderHelp(), /legacy/);

const consumerDirectory = await mkdtemp(resolve(root, '.node-next-consumer-'));
try {
  const configFile = resolve(consumerDirectory, 'tool.json');
  const localConfig = resolve(consumerDirectory, 'tool.local.json');
  await writeFile(configFile, '{"values":{"verbose":2}}');
  await writeFile(localConfig, '{"values":{"verbose":3}}');
  assert.deepEqual(await cli.loadConfig(configFile), { values: { verbose: 2 } });
  const config = await cli.loadConfigs([configFile, localConfig]);
  assert.deepEqual(cli.validateConfig(configured, config), { valid: true, issues: [] });
  const layered = configured.parse(['status'], { config });
  assert.equal(layered.type, 'value');
  if (layered.type !== 'value') {
    throw new Error('Expected layered config to produce a parsed value');
  }
  assert.equal(layered.value.verbose, 3);
  assert.equal(cli.getConfigValueFile(layered.value, 'verbose'), localConfig);
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
