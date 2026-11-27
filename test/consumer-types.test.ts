import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

test('keeps configured defaults sound without exact optional properties', () => {
  const root = resolve(import.meta.dir, '..');
  const executable = resolve(root, 'node_modules/typescript/bin/tsc');
  const result = Bun.spawnSync(
    [
      process.execPath,
      executable,
      '--ignoreConfig',
      '--exactOptionalPropertyTypes',
      'false',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--noEmit',
      '--pretty',
      'false',
      '--skipLibCheck',
      '--strict',
      '--target',
      'ESNext',
      '--types',
      'bun',
      'fixtures/nonexact-consumer.ts',
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  );

  assert.equal(
    result.exitCode,
    0,
    `TypeScript consumer check failed:\n${result.stdout.toString()}${result.stderr.toString()}`,
  );
}, { timeout: 20_000 });
