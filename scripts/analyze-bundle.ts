import {
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  dirname,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = resolve(root, 'reports');
const report = resolve(reportDirectory, 'bundle.md');
const outputDirectory = await mkdtemp(resolve(tmpdir(), 'bun-clap-bundle-'));

await mkdir(reportDirectory, { recursive: true });

try {
  const build = Bun.spawn(
    [
      process.execPath,
      'build',
      './src/index.ts',
      './src/completion.ts',
      '--outdir',
      outputDirectory,
      '--target=bun',
      '--format=esm',
      '--sourcemap=external',
      '--splitting',
      '--chunk-naming',
      'chunks/[name]-[hash].[ext]',
      `--metafile-md=${report}`,
    ],
    { cwd: root, stdout: 'inherit', stderr: 'inherit' },
  );
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`Bundle analysis failed with exit code ${exitCode}`);
  }
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}

console.log(`Bundle analysis: ${report}`);
