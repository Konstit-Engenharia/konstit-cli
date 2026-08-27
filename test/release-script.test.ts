import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  dirname,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const script = resolve(root, 'scripts/release.ts');

function run(...args: readonly string[]) {
  return Bun.spawnSync([process.execPath, script, ...args], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });
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
});
