import {
  expect,
  test,
} from 'bun:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPackedPackage } from '../scripts/packed-package';

test.each([
  { name: 'packing fails', manifest: undefined, error: 'Package archive creation failed' },
  { name: 'declaration validation fails', manifest: { name: '@konstit/cli', version: '1.0.0' }, error: 'does not contain dist/index.d.ts' },
])('cleans up the temporary package when $name', async ({ manifest, error }) => {
  const directory = await mkdtemp(join(tmpdir(), 'konstit-cli-package-test-'));
  try {
    const root = join(directory, 'source');
    const temporaryRoot = join(directory, 'scratch');
    await Promise.all([mkdir(root), mkdir(temporaryRoot)]);
    if (manifest !== undefined) {
      await Bun.write(join(root, 'package.json'), JSON.stringify(manifest));
    }

    await assert.rejects(
      createPackedPackage(root, temporaryRoot),
      (reason: unknown) => reason instanceof Error && reason.message.includes(error),
    );
    expect(await readdir(temporaryRoot)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
