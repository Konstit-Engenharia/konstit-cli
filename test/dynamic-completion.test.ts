import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  flag,
  option,
  parsers,
  positional,
} from '../src';
import {
  resolveDynamicCompletion,
  type DynamicCompletionContext,
} from '../src/dynamic-completion';

describe('dynamic completion', () => {
  test('resolves static values, aliases, inline options, and global options', async () => {
    const cli = command('tool')
      .arg(flag('verbose').global())
      .subcommand(
        command('deploy')
          .visibleAlias('push')
          .arg(option('target', parsers.enum(['preview', 'production']))),
      );

    const value = await resolveDynamicCompletion(cli, ['push', '--target', 'pr']);
    expect(value.commandPath).toEqual(['tool', 'deploy']);
    expect(value.argument?.name).toBe('target');
    expect(value.candidates.map(({ value }) => value)).toEqual([
      'preview',
      'production',
    ]);

    const inline = await resolveDynamicCompletion(cli, ['deploy', '--target=pre']);
    expect(inline.candidates.map(({ value }) => value)).toEqual([
      '--target=preview',
    ]);

    const global = await resolveDynamicCompletion(cli, ['deploy', '--v']);
    expect(global.candidates.map(({ value }) => value)).toContain('--verbose');
  });

  test('awaits a provider and supplies parsed command context', async () => {
    let received: DynamicCompletionContext | undefined;
    const cli = command('tool')
      .arg(option('workspace').global())
      .subcommand(
        command('deploy')
          .arg(option('region'))
          .arg(
            option('package').complete(async (context) => {
              await Promise.resolve();
              received = context;
              return [
                { value: 'react', description: 'UI library' },
                'redis',
                'vue',
              ];
            }),
          ),
      );

    const result = await resolveDynamicCompletion(cli, [
      '--workspace',
      'web',
      'deploy',
      '--region',
      'us-east',
      '--package',
      're',
    ]);

    expect(result.candidates).toEqual([
      { value: 'react', description: 'UI library' },
      { value: 'redis' },
    ]);
    expect(received?.current).toBe('re');
    expect(received?.commandPath).toEqual(['tool', 'deploy']);
    expect(received?.values).toMatchObject({ workspace: 'web', region: 'us-east' });
    expect(received?.rawValues).toMatchObject({
      workspace: ['web'],
      region: ['us-east'],
    });
    expect(Object.isFrozen(received?.values)).toBe(true);
    expect(Object.isFrozen(result.candidates)).toBe(true);
  });

  test('supports async iterables and delimiter-aware output', async () => {
    const cli = command('tool').arg(
      option('label')
        .repeatable()
        .valueDelimiter(',')
        .complete(async function*() {
          yield 'bug';
          await Promise.resolve();
          yield 'build';
          yield 'docs';
        }),
    );

    const result = await resolveDynamicCompletion(cli, ['--label=docs,bu']);
    expect(result.current).toBe('bu');
    expect(result.candidates.map(({ value }) => value)).toEqual([
      '--label=docs,bug',
      '--label=docs,build',
    ]);
  });

  test('tracks option arity before selecting the next completion target', async () => {
    const cli = command('tool').arg(
      option('pair').numArgs(2).complete(() => ['first', 'second']),
    );

    const second = await resolveDynamicCompletion(cli, ['--pair', 'first', 's']);
    expect(second.argument?.name).toBe('pair');
    expect(second.candidates.map(({ value }) => value)).toEqual(['second']);

    const complete = await resolveDynamicCompletion(
      cli,
      ['--pair', 'first', 'second', ''],
    );
    expect(complete.argument).toBeUndefined();
  });

  test('completes positional values and lets a provider replace static values', async () => {
    const cli = command('search')
      .arg(option('scope'))
      .arg(
        positional('query', parsers.enum(['static']))
          .complete(({ values }) => {
            return values.scope === 'docs' ? ['open', 'other'] : ['closed'];
          }),
      );

    const result = await resolveDynamicCompletion(cli, ['--scope', 'docs', 'op']);
    expect(result.argument?.name).toBe('query');
    expect(result.candidates.map(({ value }) => value)).toEqual(['open']);
  });

  test('supports cursor-at-end and rejects invalid candidate values', async () => {
    const cli = command('tool').arg(flag('verbose'));
    const result = await resolveDynamicCompletion(cli, [], { cursor: 0 });
    expect(result.current).toBe('');
    expect(result.candidates.map(({ value }) => value)).toContain('--verbose');

    const invalid = command('bad').arg(
      option('value').complete(() => ['bad\nvalue']),
    );
    await expect(
      resolveDynamicCompletion(invalid, ['--value', '']),
    ).rejects.toThrow('single-line');
  });
});
