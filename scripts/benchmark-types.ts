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
import { typecheckScenarios } from './typecheck-benchmark-scenarios';

interface Diagnostics {
  readonly files: number;
  readonly lines: number;
  readonly identifiers: number;
  readonly symbols: number;
  readonly types: number;
  readonly instantiations: number;
  readonly memoryKiB: number;
  readonly parseSeconds: number;
  readonly bindSeconds: number;
  readonly checkSeconds: number;
  readonly totalSeconds: number;
}

interface BenchmarkResult extends Diagnostics {
  readonly compiler: string;
  readonly compilerVersion: string;
  readonly scenario: string;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = resolve(root, 'benchmark/typecheck-results.json');
const compilers = [
  { name: 'typescript-current', path: resolve(root, 'node_modules/typescript/bin/tsc') },
] as const;

const packed = await createPackedPackage(root);
let consumerDirectory: string | undefined;
try {
  consumerDirectory = await mkdtemp(join(tmpdir(), 'konstit-cli-type-benchmark-'));
  await installPackedPackage(packed.directory, consumerDirectory);
  const results: BenchmarkResult[] = [];
  for (const compiler of compilers) {
    const compilerVersion = compilerOutput(
      compiler.path,
      ['--version'],
      consumerDirectory,
    ).replace(/^Version\s+/, '').trim();
    for (const scenario of typecheckScenarios) {
      const sourcePath = resolve(consumerDirectory, `${scenario.name}.ts`);
      const configPath = resolve(consumerDirectory, `${scenario.name}.json`);
      await writeFile(sourcePath, scenario.source);
      await writeFile(
        configPath,
        `${
          JSON.stringify(
            {
              compilerOptions: {
                exactOptionalPropertyTypes: true,
                extendedDiagnostics: true,
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                noEmit: true,
                noUncheckedIndexedAccess: true,
                skipLibCheck: true,
                strict: true,
                target: 'ESNext',
                types: [],
              },
              files: [`${scenario.name}.ts`],
            },
            null,
            2,
          )
        }\n`,
      );
      const output = compilerOutput(
        compiler.path,
        ['--project', configPath, '--pretty', 'false'],
        consumerDirectory,
      );
      results.push({
        compiler: compiler.name,
        compilerVersion,
        scenario: scenario.name,
        ...parseDiagnostics(output),
      });
    }
  }

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ results }, null, 2)}\n`);
  printResults(results);
  console.log('Full diagnostics: benchmark/typecheck-results.json');
} finally {
  await Promise.all([
    packed.cleanup(),
    consumerDirectory === undefined ? undefined : rm(consumerDirectory, { recursive: true, force: true }),
  ]);
}

async function installPackedPackage(
  packageDirectory: string,
  consumerDirectory: string,
): Promise<void> {
  const installedPackage = resolve(consumerDirectory, 'node_modules/@konstit/cli');
  await mkdir(dirname(installedPackage), { recursive: true });
  await cp(packageDirectory, installedPackage, { recursive: true });
  await writeFile(
    resolve(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
}

function compilerOutput(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
): string {
  const result = Bun.spawnSync(
    [process.execPath, executable, ...arguments_],
    { cwd, stdout: 'pipe', stderr: 'pipe' },
  );
  assert.equal(
    result.exitCode,
    0,
    `Compiler failed:\n${result.stdout.toString()}${result.stderr.toString()}`,
  );
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

function parseDiagnostics(output: string): Diagnostics {
  return {
    files: integerMetric(output, 'Files'),
    lines: integerMetric(output, 'Lines of TypeScript'),
    identifiers: integerMetric(output, 'Identifiers'),
    symbols: integerMetric(output, 'Symbols'),
    types: integerMetric(output, 'Types'),
    instantiations: integerMetric(output, 'Instantiations'),
    memoryKiB: integerMetric(output, 'Memory used', 'K'),
    parseSeconds: timeMetric(output, 'Parse time'),
    bindSeconds: timeMetric(output, 'Bind time'),
    checkSeconds: timeMetric(output, 'Check time'),
    totalSeconds: timeMetric(output, 'Total time'),
  };
}

function integerMetric(output: string, label: string, suffix = ''): number {
  const pattern = new RegExp(`^${escapeRegExp(label)}:\\s+([0-9,]+)${suffix}$`, 'm');
  const match = output.match(pattern);
  assert(match?.[1] !== undefined, `Missing ${label} in extendedDiagnostics output`);
  return Number(match[1].replaceAll(',', ''));
}

function timeMetric(output: string, label: string): number {
  const pattern = new RegExp(`^${escapeRegExp(label)}:\\s+([0-9.]+)s$`, 'm');
  const match = output.match(pattern);
  assert(match?.[1] !== undefined, `Missing ${label} in extendedDiagnostics output`);
  return Number(match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printResults(results: readonly BenchmarkResult[]): void {
  console.table(results.map((result) => ({
    compiler: `${result.compiler} (${result.compilerVersion})`,
    scenario: result.scenario,
    instantiations: result.instantiations,
    types: result.types,
    memoryMiB: (result.memoryKiB / 1024).toFixed(1),
    checkSeconds: result.checkSeconds.toFixed(2),
    totalSeconds: result.totalSeconds.toFixed(2),
  })));
}
