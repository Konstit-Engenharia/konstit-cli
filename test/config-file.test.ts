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
  validateConfig,
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
    port: {
      description: 'Listening port',
      anyOf: [
        { type: 'string' },
        { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1 },
      ],
    },
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

test('includes enum spellings and faithful fixed array bounds in the config schema', () => {
  const cli = command('tool', {
    args: [
      option(
        'mode',
        parsers.enum(
          [
            { value: 'fast', aliases: ['f'] },
            { value: 'safe' },
          ] as const,
        ),
      ),
      option('range', parsers.integer, { numArgs: { min: 2, max: 4 } }),
      option('secret', parsers.enum(['one', 'two'] as const), { sensitive: true }),
      option('split', parsers.enum(['one', 'two'] as const), { numArgs: 2, valueDelimiter: ',' }),
      option(
        'hiddenChoice',
        parsers.enum(
          [
            { value: 'visible' },
            { value: 'hidden', hide: true },
          ] as const,
        ),
      ),
      option('repeatable', parsers.integer, { repeatable: true, numArgs: { min: 2, max: 3 } }),
    ],
  });
  const values = generateConfigSchema(cli).properties.values.properties;
  expect(values.mode).toEqual({
    anyOf: [
      { type: 'string', enum: ['fast', 'f', 'safe'] },
      {
        type: 'array',
        items: { type: 'string', enum: ['fast', 'f', 'safe'] },
        minItems: 1,
        maxItems: 1,
      },
    ],
  });
  expect(values.range).toEqual({
    anyOf: [
      { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    ],
  });
  expect(values.secret).toEqual({
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1 },
    ],
  });
  expect(values.split).toEqual({
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
  });
  expect(values.hiddenChoice).toEqual({
    anyOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 1 },
    ],
  });
  expect(values.repeatable).toEqual({
    anyOf: [
      { type: 'array', items: { type: 'string' }, minItems: 2 },
    ],
  });
});

test('validates every configured branch and redacts sensitive parser failures', () => {
  const cli = command('tool', {
    args: [option('token', parsers.integer, { sensitive: true, global: true })],
    subcommands: [command('serve', {
      args: [option('port', parsers.integer, { numArgs: 2 })],
    })],
  });
  const result = validateConfig(cli, {
    values: { token: 'hunter2', missing: 'value' },
    subcommands: {
      serve: { values: { port: ['80', '81', '82'] } },
      absent: { values: { port: '80' } },
    },
  });
  expect(result.valid).toBe(false);
  expect(result.issues.map(({ kind }) => kind)).toEqual([
    'invalid-value',
    'unknown-argument',
    'too-many-values',
    'unknown-subcommand',
  ]);
  expect(result.issues[0]).toMatchObject({
    argumentName: 'token',
    path: ['config', 'values', 'token'],
  });
  expect(result.issues[0]?.message).not.toContain('hunter2');
  expect(result.issues[2]).toMatchObject({
    argumentName: 'port',
    path: ['config', 'subcommands', 'serve', 'values', 'port'],
    commandPath: ['tool', 'serve'],
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.issues)).toBe(true);
  expect(Object.isFrozen(result.issues[0])).toBe(true);
});

test('accepts a partial config with inherited globals and parser aliases', () => {
  const cli = command('tool', {
    args: [option(
      'mode',
      parsers.enum(
        [
          { value: 'fast', aliases: ['f'] },
        ] as const,
      ),
      { global: true },
    )],
    subcommands: [command('serve', {
      args: [option('port', parsers.integer, { required: true })],
    })],
  });
  expect(validateConfig(cli, {
    values: { mode: 'f' },
    subcommands: { serve: { values: { port: '8080' } } },
  })).toMatchObject({ valid: true, issues: [] });
  expect(validateConfig(cli, undefined)).toEqual({ valid: true, issues: [] });
});

test('reports every config coercion and arity failure without stopping at the first issue', () => {
  const undefinedParser = parsers.custom('UNDEFINED', () => undefined);
  const cli = command('tool', {
    args: [
      flag('enabled'),
      count('verbose'),
      option('pair', parsers.integer, { numArgs: { min: 2, max: 3 }, repeatable: true }),
      option('requiredPair', parsers.integer, { numArgs: 2 }),
      option('text', parsers.string),
      option('number', parsers.integer),
      option('undefinedValue', undefinedParser),
    ],
  });
  const result = validateConfig(cli, {
    values: {
      enabled: 'yes',
      verbose: 'two',
      pair: ['1'],
      requiredPair: [],
      text: true,
      number: 'bad',
      undefinedValue: 'value',
    },
  });
  expect(result.issues.map(({ kind }) => kind)).toEqual([
    'invalid-value',
    'invalid-value',
    'too-few-values',
    'too-few-values',
    'invalid-value',
    'invalid-value',
    'invalid-value',
  ]);
  expect(result.issues.map(({ argumentName }) => argumentName)).toEqual([
    'enabled',
    'verbose',
    'pair',
    'requiredPair',
    'text',
    'number',
    'undefinedValue',
  ]);
});

test('accepts valid switch values during config validation', () => {
  const cli = command('tool', { args: [flag('enabled'), count('verbose')] });
  expect(validateConfig(cli, { values: { enabled: true, verbose: 2 } })).toEqual({
    valid: true,
    issues: [],
  });
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
