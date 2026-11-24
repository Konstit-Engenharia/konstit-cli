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
  getConfigValueFile,
  getValueSource,
  loadConfig,
  loadConfigs,
  option,
  parsers,
} from '../src';

test('loads ordered config layers and tracks winning files across command scopes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-layers-'));
  try {
    const user = join(directory, 'user.json');
    const project = pathToFileURL(join(directory, 'project.json'));
    const local = join(directory, 'local.json');
    await Promise.all([
      writeFile(
        user,
        JSON.stringify({
          $schema: './user.schema.json',
          values: { account: 'user', token: 'secret', tags: ['old', 'values'] },
          subcommands: { deploy: { values: { region: 'east' } } },
        }),
      ),
      writeFile(
        project,
        JSON.stringify({
          $schema: './project.schema.json',
          values: { tags: ['project'] },
          subcommands: { deploy: { values: { account: 'project' }, subcommands: { preview: {} } } },
        }),
      ),
      writeFile(local, JSON.stringify({ values: { account: 'local' } })),
    ]);

    const account = option('account', parsers.string, { global: true, env: 'DEPLOY_ACCOUNT' });
    const cli = command('tool', {
      args: [
        account,
        option('token', parsers.string, { sensitive: true }),
        option('tags', parsers.string, { repeatable: true }),
      ],
      subcommands: [command('deploy', {
        aliases: ['ship'],
        args: [option('region', parsers.string)],
        subcommands: [command('preview')],
      })],
    });
    const config = await loadConfigs([user, project, local]);
    expect(config.$schema).toBe('./project.schema.json');
    const result = cli.parse(['ship', 'preview'], { config, env: {} });
    if (result.type !== 'value') {
      throw new Error('Expected the preview command to parse');
    }
    const { value } = result;
    const deploy = value.subcommand?.args;
    if (deploy?.subcommand === undefined) {
      throw new Error('Expected parsed deploy and preview arguments');
    }
    expect(value.account).toBe('project');
    expect(value.tags).toEqual(['project']);
    expect(value.token).toBe('secret');
    expect(getValueSource(value, 'account')).toBe('config');
    expect(getValueSource(value, 'token')).toBe('config');
    expect(getConfigValueFile(value, 'token')).toBeUndefined();
    expect(getConfigValueFile(value, 'tags')).toBe(project.href);
    expect(getConfigValueFile(value, account)).toBe(project.href);
    expect(deploy.region).toBe('east');
    expect(getConfigValueFile(deploy, 'region')).toBe(user);
    expect(getConfigValueFile(deploy, account)).toBe(project.href);
    expect(getConfigValueFile(deploy.subcommand.args, account)).toBe(project.href);

    const root = cli.parse([], { config, env: {} });
    const overridden = cli.parse(['ship', 'preview'], { config, env: { DEPLOY_ACCOUNT: 'env' } });
    const single = cli.parse([], { config: await loadConfig(user), env: {} });
    const inline = cli.parse([], { config: { values: { account: 'inline' } }, env: {} });
    if (root.type !== 'value' || overridden.type !== 'value' || single.type !== 'value' || inline.type !== 'value') {
      throw new Error('Expected each invocation to parse');
    }
    expect(getConfigValueFile(root.value, 'account')).toBe(local);
    expect(getConfigValueFile(single.value, 'account')).toBe(user);
    expect(getConfigValueFile(inline.value, 'account')).toBeUndefined();
    expect(overridden.value.account).toBe('env');
    expect(getValueSource(overridden.value, 'account')).toBe('env');
    expect(getConfigValueFile(overridden.value, 'account')).toBeUndefined();
    expect(getConfigValueFile(overridden.value.subcommand?.args ?? {}, account)).toBeUndefined();
    expect(await loadConfigs([])).toEqual({});
    await writeFile(local, '{"$schema":"./local.schema.json"}');
    expect(await loadConfigs([local])).toEqual({ $schema: './local.schema.json' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
