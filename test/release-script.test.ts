import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { release } from '../scripts/release';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(root, 'scripts/release.ts');

const initialVersion = '1.2.3';
const nextVersion = '1.2.4';
const tag = `v${nextVersion}`;
const createReleaseCommand = ['gh', 'release', 'create', tag, '--verify-tag', '--generate-notes', '--title', tag];
const steps = [
  { args: ['gh', 'auth', 'status'], lastStage: 'version validation', version: initialVersion },
  { args: ['git', 'fetch', 'origin', 'main', '--tags'], lastStage: 'version validation', version: initialVersion },
  { args: ['bun', 'run', 'check'], lastStage: 'repository validation', version: initialVersion },
  { args: ['bun', 'run', 'lint'], lastStage: 'repository validation', version: initialVersion },
  { args: ['git', 'add', '--', 'package.json'], lastStage: 'manifest update', version: nextVersion },
  { args: ['git', 'commit', '-m', `release: ${tag}`], lastStage: 'manifest staging', version: nextVersion },
  { args: ['git', 'tag', '--annotate', tag, '--message', tag], lastStage: 'release commit', version: nextVersion },
  { args: ['git', 'push', '--atomic', 'origin', 'main', `refs/tags/${tag}`], lastStage: 'local tag creation', version: nextVersion },
  { args: createReleaseCommand, lastStage: 'atomic push', version: nextVersion },
].map((step) => ({ ...step, command: step.args.join(' ') }));

function run(...args: readonly string[]) {
  return Bun.spawnSync([process.execPath, script, ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

async function simulateRelease(failAt?: string) {
  const directory = await mkdtemp(resolve(tmpdir(), 'konstit-cli-release-'));
  const manifestPath = resolve(directory, 'package.json');
  const commands: Array<readonly string[]> = [];
  const messages: string[] = [];
  const failure = new Error('simulated command failure');
  const captured = new Map([
    ['git rev-parse --show-toplevel', directory],
    ['git branch --show-current', 'main'],
    ['git status --porcelain', ''],
    ['git rev-list --left-right --count origin/main...HEAD', '0\t0'],
    [`git tag --list ${tag}`, ''],
    [`git ls-remote --tags origin refs/tags/${tag}`, ''],
  ]);
  try {
    await Bun.write(manifestPath, JSON.stringify({ name: 'fixture', version: initialVersion }));
    const error = await release(nextVersion, {
      root: directory,
      log: (message) => {
        messages.push(message);
      },
      capture: async (args) => {
        const command = args.join(' ');
        const output = captured.get(command);
        if (output === undefined) {
          throw new Error(`unexpected command ${command}`);
        }
        return output;
      },
      run: async (args) => {
        commands.push(args);
        const command = args.join(' ');
        if (command === 'git add -- package.json') {
          expect(await Bun.file(manifestPath).json()).toMatchObject({ version: nextVersion });
        }
        if (command === failAt) {
          throw failure;
        }
      },
    }).then(() => undefined, (error: unknown) => error);
    return { commands, messages, error, failure, manifest: await Bun.file(manifestPath).json() as unknown };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('release script', () => {
  test('uses the project CLI framework for help and version parsing', () => {
    const help = run('--help');
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain('Usage: release <MAJOR.MINOR.PATCH>');

    for (const invalid of ['v1.2.3', '1.2', '1.2.3-beta', '01.2.3']) {
      const result = run(invalid);
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain(
        'expected an exact major.minor.patch version',
      );
    }
  });

  test('rejects a version that is not greater before changing files', async () => {
    const manifest = await Bun.file(resolve(root, 'package.json')).json() as {
      readonly version: string;
    };
    const before = await Bun.file(resolve(root, 'package.json')).text();
    const result = run(manifest.version);

    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      `must be greater than current version ${manifest.version}`,
    );
    expect(await Bun.file(resolve(root, 'package.json')).text()).toBe(before);
  });

  test('runs the release stages in order through GitHub Release creation', async () => {
    const result = await simulateRelease();
    expect(result.error).toBeUndefined();
    expect(result.commands).toEqual(steps.map(({ args }) => args));
    expect(result.manifest).toEqual({ name: 'fixture', version: nextVersion });
    expect(result.messages.at(-1)).toContain(`Published GitHub Release ${tag}.`);
  });

  test.each(steps)('reports the last completed stage when $command fails', async (step) => {
    const result = await simulateRelease(step.command);
    expect(result.error).toBeInstanceOf(Error);
    const error = result.error as Error;
    expect(error.cause).toBe(result.failure);
    expect(error.message).toContain(result.failure.message);
    if (step.lastStage === 'atomic push') {
      expect(error.message).toContain('The commit and tag were pushed.');
      expect(error.message).toContain(createReleaseCommand.join(' '));
    } else {
      expect(error.message).toContain(`Release ${tag} stopped after ${step.lastStage}.`);
    }
    expect(result.commands).toEqual(steps.slice(0, steps.indexOf(step) + 1).map(({ args }) => args));
    expect(result.manifest).toEqual({ name: 'fixture', version: step.version });
    expect(result.messages.some((message) => message.startsWith('Published GitHub Release'))).toBe(false);
  });
});
