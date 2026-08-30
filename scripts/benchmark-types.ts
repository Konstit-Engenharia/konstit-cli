import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
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
import { typecheckScenarios } from '../benchmark/typecheck/scenarios';
import { createPackedPackage } from './packed-package';

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

interface LimitsFile {
  readonly schemaVersion: 1;
  readonly compilers: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const limitsPath = resolve(root, 'benchmark/typecheck/limits.json');
const reportPath = resolve(root, 'reports/typecheck-benchmark.json');
const shouldUpdate = process.argv.includes('--update');
const compilers = [
  { name: 'typescript-current', path: resolve(root, 'node_modules/typescript/bin/tsc') },
] as const;

const packed = await createPackedPackage(root);
const consumerDirectory = await mkdtemp(join(tmpdir(), 'konstit-cli-type-benchmark-'));
try {
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

  if (shouldUpdate) {
    const limits = createLimits(results);
    await writeFile(limitsPath, `${JSON.stringify(limits, null, 2)}\n`);
    console.log('Updated benchmark/typecheck/limits.json.');
  } else {
    const limits = JSON.parse(await readFile(limitsPath, 'utf8')) as LimitsFile;
    verifyLimits(results, limits);
    console.log('Type instantiation limits passed.');
  }
  console.log('Full diagnostics: reports/typecheck-benchmark.json');
} finally {
  await Promise.all([
    packed.cleanup(),
    rm(consumerDirectory, { recursive: true, force: true }),
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

function createLimits(results: readonly BenchmarkResult[]): LimitsFile {
  const compilerLimits: Record<string, Record<string, number>> = {};
  for (const result of results) {
    const limits = compilerLimits[result.compiler] ?? {};
    limits[result.scenario] = result.instantiations;
    compilerLimits[result.compiler] = limits;
  }
  return { schemaVersion: 1, compilers: compilerLimits };
}

function verifyLimits(
  results: readonly BenchmarkResult[],
  limits: LimitsFile,
): void {
  assert.equal(limits.schemaVersion, 1, 'Unsupported type benchmark limits schema');
  const failures: string[] = [];
  for (const result of results) {
    const maximum = limits.compilers[result.compiler]?.[result.scenario];
    if (maximum === undefined) {
      failures.push(`${result.compiler}/${result.scenario}: missing limit`);
    } else if (result.instantiations > maximum) {
      failures.push(
        `${result.compiler}/${result.scenario}: ${result.instantiations} > ${maximum}`,
      );
    }
  }
  assert.equal(
    failures.length,
    0,
    `Type instantiation regression:\n${failures.join('\n')}`,
  );
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
