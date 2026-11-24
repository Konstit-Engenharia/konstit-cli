import {
  expect,
  test,
} from 'bun:test';
import {
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  command,
  count,
  flag,
  generateConfigSchema,
  loadConfig,
  option,
  parsers,
  positional,
} from '../src';

test('generates a closed schema with canonical names, raw values, and inherited globals', () => {
  const cli = command('tool', {
    about: 'Control the service',
    args: [count('verbose', { global: true, describe: 'Verbosity level' }), flag('quiet')],
    subcommands: [command('serve', {
      aliases: ['server'],
      args: [
        option('port', parsers.integer, { required: true, describe: 'Listening port', aliases: ['listen'] }),
        flag('watch', { global: true }),
      ],
      subcommands: [command('check', {
        hide: true,
        args: [positional('path', parsers.string, { hide: true })],
      })],
    })],
  });
  const schema = generateConfigSchema(cli);
  const verbose = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: 'Verbosity level' } as const;
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema).toMatchObject({ type: 'object', additionalProperties: false, description: 'Control the service' });
  expect(schema.properties.$schema).toEqual({ type: 'string' });
  expect(schema).not.toHaveProperty('required');
  expect(schema.properties.values).toEqual({
    type: 'object',
    additionalProperties: false,
    properties: {
      verbose,
      quiet: { type: 'boolean' },
    },
  });
  const subcommands = schema.properties.subcommands;
  expect(subcommands.additionalProperties).toBe(false);
  expect(Object.keys(subcommands.properties)).toEqual(['serve']);
  const serve = subcommands.properties.serve;
  expect(serve?.additionalProperties).toBe(false);
  expect(serve?.properties).not.toHaveProperty('$schema');
  expect(serve?.properties.values.properties).toEqual({
    verbose,
    port: { description: 'Listening port', anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
    watch: { type: 'boolean' },
  });
  expect(Object.keys(serve?.properties.subcommands.properties.check?.properties.values.properties ?? {})).toEqual([
    'verbose',
    'watch',
    'path',
  ]);
  expect(serve?.properties.values).not.toHaveProperty('required');
  expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
});

test('loads JSON config from a file URL and applies it to a nested command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-config-'));
  try {
    const cli = command('tool', {
      args: [count('verbose', { global: true })],
      subcommands: [command('serve', { args: [option('port', parsers.integer, { required: true })] })],
    });
    const file = join(directory, 'tool.json');
    await writeFile(
      file,
      '\uFEFF{"$schema":"./tool.schema.json","values":{"verbose":2},"subcommands":{"serve":{"values":{"port":"8080"}}}}',
    );
    const config = await loadConfig(pathToFileURL(file));
    expect(config.$schema).toBe('./tool.schema.json');
    expect(cli.parse(['serve'], { config })).toMatchObject({
      type: 'value',
      value: { verbose: 2, subcommand: { name: 'serve', args: { port: 8080 } } },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('identifies read, JSON syntax, and config structure errors by file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-config-'));
  try {
    const file = join(directory, 'tool.json');
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(loadConfig(file)).rejects.toMatchObject({
      message: expect.stringContaining(`Could not read config file ${JSON.stringify(file)}`),
      cause: { code: 'ENOENT' },
    });
    await writeFile(file, '{"values":}');
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(loadConfig(file)).rejects.toMatchObject({
      name: 'SyntaxError',
      message: expect.stringContaining(`Invalid JSON in config file ${JSON.stringify(file)}`),
      cause: expect.any(SyntaxError),
    });
    for (
      const [source, detail,] of [
        ['{"subcommands":{"serve":{"values":{"port":null}}}}', 'config.subcommands.serve.values.port'],
        ['{"$schema":42}', 'Config field \'config.$schema\' must be a string'],
        ['{"subcommands":{"serve":{"$schema":"./tool.schema.json"}}}', 'Unknown config field \'config.subcommands.serve.$schema\''],
      ] as const
    ) {
      await writeFile(file, source);
      // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
      await expect(loadConfig(file)).rejects.toMatchObject({
        name: 'TypeError',
        message: expect.stringContaining(`Invalid config file ${JSON.stringify(file)}`),
        cause: { message: expect.stringContaining(detail) },
      });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
