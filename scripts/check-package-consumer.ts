import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackedPackage } from './packed-package';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = resolve(root, 'fixtures/package-consumer.ts');
const entries = ['.', './completion', './testing'] as const;

const packed = await createPackedPackage(root);
try {
  await verifyManifest(packed.directory);
  await verifyConsumer(packed.directory);
  console.log('Verified packaged entry points and Infer with the current TypeScript version.');
} finally {
  await packed.cleanup();
}

async function verifyManifest(packageDirectory: string): Promise<void> {
  const manifest = await Bun.file(resolve(packageDirectory, 'package.json')).json() as {
    readonly exports?: Record<string, unknown>;
  };
  assert.deepEqual(
    Object.keys(manifest.exports ?? {}).sort(),
    entries.toSorted(),
    'Published entry points changed',
  );
}

async function verifyConsumer(packageDirectory: string): Promise<void> {
  const consumerDirectory = await mkdtemp(join(tmpdir(), 'konstit-cli-consumer-'));
  try {
    const installedPackage = resolve(
      consumerDirectory,
      'node_modules/@konstit/cli',
    );
    await mkdir(dirname(installedPackage), { recursive: true });
    await cp(packageDirectory, installedPackage, { recursive: true });
    await cp(fixturePath, resolve(consumerDirectory, 'consumer.ts'));
    await writeFile(
      resolve(consumerDirectory, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    );
    await writeFile(
      resolve(consumerDirectory, 'tsconfig.json'),
      `${
        JSON.stringify(
          {
            compilerOptions: {
              exactOptionalPropertyTypes: true,
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              noEmit: true,
              noUncheckedIndexedAccess: true,
              skipLibCheck: false,
              strict: true,
              target: 'ESNext',
              types: [],
            },
            files: ['consumer.ts'],
          },
          null,
          2,
        )
      }\n`,
    );

    const executable = resolve(root, 'node_modules/typescript/bin/tsc');
    const result = Bun.spawnSync(
      [process.execPath, executable, '--project', resolve(consumerDirectory, 'tsconfig.json')],
      { cwd: consumerDirectory, stdout: 'pipe', stderr: 'pipe' },
    );
    assert.equal(
      result.exitCode,
      0,
      `TypeScript consumer check failed:\n${result.stdout.toString()}${result.stderr.toString()}`,
    );
  } finally {
    await rm(consumerDirectory, { recursive: true, force: true });
  }
}
