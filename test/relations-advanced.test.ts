import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  describeCommand,
  ErrorKind,
  flag,
  option,
  parsers,
} from '../src';
import type { ParseOutcome } from '../src/result/error';

function parse<Value>(
  configured: { parse(argv: readonly string[]): ParseOutcome<Value>; },
  argv: readonly string[],
): Value {
  const outcome = configured.parse(argv);
  if (outcome.type !== 'value') {
    throw new Error(`Expected a value, got ${outcome.kind}`);
  }
  return outcome.value;
}

describe('advanced argument relations', () => {
  test('requires the final parsed target value consistently across entry points', async () => {
    const archive = command('read', {
      args: [
        option('entry'),
        option('compression', parsers.enum([{ value: 'zip', aliases: ['ZIP'] }, 'gzip'])),
      ],
      argsOverrideSelf: true,
      requiresValue: [['entry', 'compression', 'zip']],
      handler: () => 0,
    });
    const cli = command('archive', { subcommands: [archive] });
    const entry = ['read', '--entry', 'rows.csv'];
    expect(cli.tryParse(['read', '--compression', 'gzip']).ok).toBe(true);
    expect(cli.tryParse([...entry, '--compression', 'gzip', '--compression', 'ZIP']).ok).toBe(true);
    for (const argv of [entry, [...entry, '--compression', 'zip', '--compression', 'gzip']]) {
      const result = cli.tryParse(argv);
      expect(result).toMatchObject({
        type: 'error',
        error: {
          kind: ErrorKind.MissingDependency,
          commandPath: ['archive', 'read'],
          argumentName: 'compression',
          relatedArguments: ['entry'],
          message: 'argument \'--entry\' requires \'--compression\' with value \'zip\'',
        },
      });
      if (result.type === 'error') {
        expect(() => cli.parse(argv)).toThrow(result.error.message);
        const errors: string[] = [];
        const options = { color: false, stderr: (chunk: string) => errors.push(chunk) };
        expect(await cli.run({ ...options, argv })).toBe(2);
        expect(await cli.runParsed(result, options)).toBe(2);
        expect(errors).toEqual([result.error.output, result.error.output]);
      }
    }
  });

  test('uses supplied arguments after overrides and matches any collected target value', () => {
    const cli = command('archive', {
      args: [
        flag('select'),
        option('formats', parsers.enum(['zip', 'gzip']), { repeatable: true, defaultValues: ['zip'] }),
        flag('reset'),
      ],
      requiresValue: [['select', 'formats', 'zip']],
      overrides: [['reset', 'formats']],
    });
    expect(cli.tryParse([]).ok).toBe(true);
    expect(cli.tryParse(['--select']).ok).toBe(false);
    expect(cli.tryParse(['--select', '--formats', 'gzip', '--formats', 'zip']).ok).toBe(true);
    expect(cli.tryParse(['--select', '--formats', 'zip', '--reset']).ok).toBe(false);
    expect(cli.tryParse([], { config: { values: { select: true, formats: ['gzip'] } } }).ok).toBe(false);
    expect(cli.tryParse(['--select'], { config: { values: { formats: ['zip'] } } }).ok).toBe(true);
  });

  const conditional = command('conditional', {
    args: [
      option('format', parsers.enum(['json', 'yaml'])),
      option('mode', parsers.enum(['strict', 'relaxed'])),
      option('schema'),
    ],
    requiredIfAny: [{
      conditions: [['format', 'json'], ['mode', 'strict']],
      target: 'schema',
    }],
  });

  test('requires a target when any value condition matches', () => {
    expect(conditional.tryParse(['--format', 'json'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(conditional.tryParse(['--mode', 'strict'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(parse(conditional, ['--format', 'yaml'])).toMatchObject({
      format: 'yaml',
      schema: undefined,
    });
    expect(
      parse(conditional, ['--format', 'json', '--schema', 'schema.json']),
    ).toMatchObject({ schema: 'schema.json' });
  });

  test('requires a target only when all value conditions match', () => {
    const cli = command('all', {
      args: [
        option('format', parsers.enum(['json', 'yaml'])),
        flag('strict'),
        option('schema'),
      ],
      requiredIfAll: [{
        conditions: [['format', 'json'], ['strict', true]],
        target: 'schema',
      }],
    });

    expect(parse(cli, ['--format', 'json'])).toMatchObject({
      format: 'json',
      schema: undefined,
    });
    expect(cli.tryParse(['--format', 'json', '--strict'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });

    const explicitFalse = command('explicit-false', {
      args: [flag('feature'), option('reason')],
      requiredIfAny: [{ conditions: [['feature', false]], target: 'reason' }],
    });
    expect(parse(explicitFalse, [])).toMatchObject({ reason: undefined });
  });

  test('supports either condition input policy while keeping each legacy default', () => {
    const args = [
      option('mode', parsers.enum(['text', 'json']), { default: 'json', env: 'FORMAT_MODE' }),
      option('schema'),
    ] as const;
    const conditions = [['mode', 'json']] as const;
    const rules = [
      { requiresIf: [['mode', 'json', 'schema']] },
      { requiredIfAny: [{ conditions, target: 'schema' }] },
      { requiredIfAll: [{ conditions, target: 'schema' }] },
    ] as const;
    const missing = { ok: false, error: { kind: ErrorKind.MissingDependency, argumentName: 'schema' } };
    for (const rule of rules) {
      const legacy = command('export', { args, ...rule });
      const supplied = command('export', { args, ...rule, requirementConditionInput: 'supplied' });
      const resolved = command('export', { args, ...rule, requirementConditionInput: 'resolved' });
      expect(legacy.tryParse([], { env: {} }).ok).toBe(!('requiresIf' in rule));
      expect(supplied.tryParse([], { env: {} }).ok).toBe(true);
      expect(supplied.tryParse(['--mode=json'])).toMatchObject(missing);
      expect(supplied.tryParse([], { env: { FORMAT_MODE: 'json' } })).toMatchObject(missing);
      expect(supplied.tryParse([], { env: {}, config: { values: { mode: 'json' } } })).toMatchObject(missing);
      expect(resolved.tryParse([], { env: {} })).toMatchObject(missing);
      expect(resolved.tryParse(['--schema=schema.json'], { env: {} }).ok).toBe(true);
      expect(describeCommand(resolved).requirementConditionInput).toBe('resolved');
    }
  });

  test('requires a target unless all alternatives are present', () => {
    const cli = command('unless-all', {
      args: [option('token'), option('profile'), flag('interactive')],
      requiredUnlessAll: [{
        alternatives: ['profile', 'interactive'],
        target: 'token',
      }],
    });

    expect(cli.tryParse([])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
    expect(cli.tryParse(['--profile', 'dev'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingRequiredArgument },
    });
    expect(parse(cli, ['--profile', 'dev', '--interactive'])).toMatchObject({
      profile: 'dev',
      interactive: true,
    });
    expect(parse(cli, ['--token', 'secret'])).toMatchObject({ token: 'secret' });
  });

  test('makes an argument exclusive with every other provided argument', () => {
    const cli = command('input', {
      args: [flag('stdin'), option('file', parsers.string, { default: 'stdin.txt' }), flag('force')],
      exclusive: ['stdin'],
      argsOverrideSelf: true,
    });

    expect(parse(cli, ['--stdin'])).toMatchObject({ stdin: true });
    expect(cli.tryParse(['--stdin', '--file', 'input.txt'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    expect(cli.tryParse(['--stdin', '--force'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    expect(cli.tryParse(['--stdin', '--force', '--file=input.txt'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict, relatedArguments: ['force', 'file'] },
    });
    expect(cli.tryParse(['--stdin', '--file=input.txt', '--force', '--file=other.txt'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict, relatedArguments: ['force', 'file'] },
    });
  });

  test('scopes exclusivity to arguments declared on the same command', () => {
    const cli = command('main', {
      args: [flag('offline'), flag('trace', { global: true })],
      exclusive: ['offline'],
      subcommands: [command('child', { args: [flag('standalone')], exclusive: ['standalone'] })],
    });
    expect(cli.tryParse(['--offline', 'child', '--standalone']).ok).toBe(true);
    expect(cli.tryParse(['child', '--trace', '--standalone']).ok).toBe(true);
    expect(cli.tryParse(['--offline', '--trace'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict, message: expect.stringContaining('on this command') },
    });
  });

  test('applies requirements and conflicts to argument groups', () => {
    const cli = command('auth', {
      args: [
        option('token'),
        option('user'),
        option('endpoint'),
        flag('anonymous'),
      ],
      groups: [{
        name: 'credentials',
        members: ['token', 'user'],
        multiple: true,
        requires: ['endpoint'],
        conflicts: ['anonymous'],
      }],
    });

    expect(cli.tryParse(['--token', 'secret'])).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.MissingDependency },
    });
    expect(
      cli.tryParse([
        '--token',
        'secret',
        '--endpoint',
        'api',
        '--anonymous',
      ]),
    ).toMatchObject({
      ok: false,
      error: { kind: ErrorKind.ArgumentConflict },
    });
    expect(parse(cli, ['--anonymous'])).toMatchObject({ anonymous: true });
    expect(
      parse(cli, ['--user', 'alice', '--endpoint', 'api']),
    ).toMatchObject({ user: 'alice', endpoint: 'api' });
  });

  test('requires a supplied member of a named group and describes the alternatives in help', () => {
    const cli = command('publish', {
      args: [flag('upload'), option('file', parsers.string, { default: 'default.txt' }), option('url'), flag('offline')],
      groups: [{ name: 'destination', members: ['file', 'url'] }],
      requiresGroup: [['upload', 'destination']],
      exclusive: ['offline'],
    });
    expect(cli.tryParse([]).ok).toBe(true);
    expect(cli.tryParse(['--upload'])).toMatchObject({
      ok: false,
      error: {
        kind: ErrorKind.MissingDependency,
        argumentName: 'upload',
        relatedArguments: ['file', 'url'],
        message: expect.stringContaining('--file, --url'),
      },
    });
    expect(cli.tryParse(['--upload', '--file=report.txt']).ok).toBe(true);
    expect(cli.tryParse(['--upload'], { config: { values: { url: 'https://example.com' } } }).ok).toBe(true);
    expect(cli.tryParse(['--help'])).toMatchObject({
      type: 'display',
      output: expect.stringContaining('Requires an argument from the destination group (--file or --url).'),
    });
    expect(describeCommand(cli).groupRequirements).toEqual([{ source: 'upload', group: 'destination' }]);
  });

  test('shows group cardinality and local exclusivity for visible arguments', () => {
    const cli = command('backup', {
      args: [flag('file'), flag('url'), flag('offline'), flag('internal', { hide: true })],
      groups: [
        { name: 'destination', members: ['file', 'url'], required: true },
        { name: 'all-destinations', members: ['file', 'url'], required: true, multiple: true },
        { name: 'optional-destinations', members: ['file', 'url'], multiple: true },
        { name: 'hidden-destination', members: ['file', 'internal'], required: true },
      ],
      exclusive: ['offline', 'internal'],
      requiresGroup: [['file', 'hidden-destination']],
    });
    const result = cli.tryParse(['--help']);
    expect(result).toMatchObject({ type: 'display' });
    if (result.ok && result.type === 'display') {
      expect(result.output).toContain('Choose exactly one of --file or --url.');
      expect(result.output).toContain('Choose at least one of --file or --url.');
      expect(result.output).toContain('Cannot be combined with other arguments declared on this command.');
      expect(result.output).not.toContain('optional-destinations');
      expect(result.output).not.toContain('internal');
      expect(result.output).not.toContain('hidden-destination');
    }
    expect(describeCommand(cli).groupRequirements).toBeUndefined();
    expect(describeCommand(cli, { includeHidden: true }).groupRequirements)
      .toEqual([{ source: 'file', group: 'hidden-destination' }]);
  });

  test('reports direct contradictions when strict relation checking is enabled', () => {
    const args = [flag('publish'), flag('file'), flag('url')] as const;
    const conflictRules = { args, requires: [['publish', 'file']], conflicts: [['file', 'publish']] } as const;
    expect(command('backup', conflictRules).tryParse(['--publish']).ok).toBe(false);
    expect(() => command('backup', { ...conflictRules, strictRelations: true }))
      .toThrow('\'requires\' from \'publish\' to \'file\' because of \'conflicts\'');
    expect(() =>
      command('backup', {
        args,
        exclusive: ['publish'],
        requiresValue: [['publish', 'file', true]],
        strictRelations: true,
      })
    ).toThrow('\'requiresValue\' from \'publish\' to \'file\' because of \'exclusive\'');
    expect(() =>
      command('backup', {
        args,
        groups: [{ name: 'destination', members: ['file', 'url'], requires: ['file'] }],
        strictRelations: true,
      })
    ).toThrow('argument \'url\' cannot satisfy group \'destination\' requirement \'file\' because of argument group \'destination\'');

    const groupRules = {
      args,
      groups: [{ name: 'destination', members: ['file', 'url'] }],
      requiresGroup: [['publish', 'destination']],
      strictRelations: true,
    } as const;
    expect(() => command('backup', { ...groupRules, conflicts: [['publish', 'file']] })).not.toThrow();
    expect(() => command('backup', { ...groupRules, exclusive: ['publish'] }))
      .toThrow('\'requiresGroup\' from \'publish\' to \'destination\' because of \'exclusive\'');
  });

  test('validates group references and the input policy for untyped callers', () => {
    const cliOptions = { args: [flag('publish')], groups: [{ name: 'destination', members: ['publish'] }] };
    expect(() => command('bad-group', { ...cliOptions, requiresGroup: [['publish', 1]] } as never))
      .toThrow('entries must contain an argument name and a group name');
    expect(() => command('bad-group', { ...cliOptions, requiresGroup: [['publish', 'missing']] } as never))
      .toThrow('references unknown argument group \'missing\'');
    expect(() => command('bad-policy', { ...cliOptions, requirementConditionInput: 'default' } as never))
      .toThrow('\'requirementConditionInput\' must be \'supplied\' or \'resolved\'');
  });
});

function _checkRelationTypes() {
  command('bad-value', {
    args: [
      option('mode', parsers.enum(['dev', 'prod'])),
      option('config'),
    ],
    // @ts-expect-error expected values must match the source argument type
    requiredIfAny: [{ conditions: [['mode', 'preview']], target: 'config' }],
  });
  command('bad-condition', {
    args: [flag('strict'), option('config')],
    // @ts-expect-error condition argument names must exist
    requiredIfAll: [{ conditions: [['missing', true]], target: 'config' }],
  });
  command('bad-alternative', {
    args: [option('config')],
    // @ts-expect-error the target cannot also be an alternative
    requiredUnlessAll: [{ alternatives: ['config'], target: 'config' }],
  });
  command('bad-exclusive', {
    args: [option('config')],
    // @ts-expect-error exclusive argument names must exist
    exclusive: ['missing'],
  });
  command('bad-group-member', {
    args: [option('config')],
    // @ts-expect-error group members must be declared arguments
    groups: [{ name: 'settings', members: ['missing'] }],
  });
  command('bad-required-group', {
    args: [flag('publish'), option('file')],
    groups: [{ name: 'destination', members: ['file'] }],
    // @ts-expect-error dependency targets must be declared groups
    requiresGroup: [['publish', 'missing']],
  });
  command('bad-group-conflict', {
    args: [option('mode')],
    groups: [{
      name: 'settings',
      members: ['mode'],
      // @ts-expect-error group relation targets must be declared arguments
      conflicts: ['missing'],
    }],
  });
}
