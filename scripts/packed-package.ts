import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  join,
  resolve,
} from 'node:path';

export interface PackedPackage {
  readonly directory: string;
  readonly cleanup: () => Promise<void>;
}

/** Builds a real publish tarball and installs it with Bun for consumer checks. */
export async function createPackedPackage(root: string, temporaryRoot = tmpdir()): Promise<PackedPackage> {
  const temporaryDirectory = await mkdtemp(join(temporaryRoot, 'konstit-cli-package-'));
  const cleanup = () => rm(temporaryDirectory, { recursive: true, force: true });
  try {
    const directory = await packAndInstall(root, temporaryDirectory);
    return { directory, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Package preparation and cleanup both failed');
    }
    throw error;
  }
}

async function packAndInstall(root: string, temporaryDirectory: string): Promise<string> {
  const pack = Bun.spawnSync(
    [
      process.execPath,
      'pm',
      'pack',
      '--destination',
      temporaryDirectory,
      '--ignore-scripts',
      '--quiet',
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  );
  assert.equal(
    pack.exitCode,
    0,
    `Package archive creation failed:\n${pack.stdout.toString()}${pack.stderr.toString()}`,
  );
  const archiveNames = (await readdir(temporaryDirectory)).filter((name) => name.endsWith('.tgz'));
  assert.equal(archiveNames.length, 1, 'Package creation must produce one tarball');
  const archiveName = archiveNames[0];
  assert(archiveName !== undefined);
  const installDirectory = resolve(temporaryDirectory, 'installed');
  await mkdir(installDirectory);
  await writeFile(
    resolve(installDirectory, 'package.json'),
    `${
      JSON.stringify(
        {
          private: true,
          dependencies: { '@konstit/cli': `file:../${archiveName}` },
        },
        null,
        2,
      )
    }\n`,
  );

  const install = Bun.spawnSync(
    [process.execPath, 'install', '--ignore-scripts'],
    { cwd: installDirectory, stdout: 'pipe', stderr: 'pipe' },
  );
  assert.equal(
    install.exitCode,
    0,
    `Package archive installation failed:\n${install.stdout.toString()}${install.stderr.toString()}`,
  );

  const directory = resolve(installDirectory, 'node_modules/@konstit/cli');
  for (const entry of ['index', 'completion', 'testing']) {
    const declaration = `dist/${entry}.d.ts`;
    assert.equal(await Bun.file(resolve(directory, declaration)).exists(), true, `The package archive does not contain ${declaration}`);
  }

  return directory;
}
