import {
  expect,
  test,
} from 'bun:test';
import { resolve } from 'node:path';
import * as ts from 'typescript';

test('keeps configured defaults sound without exact optional properties', () => {
  const compilerOptions: ts.CompilerOptions = {
    exactOptionalPropertyTypes: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    types: ['bun'],
  };
  const sourcePath = ts.sys.resolvePath(
    resolve(import.meta.dir, 'nonexact-consumer.ts'),
  );
  const isSourcePath = (fileName: string): boolean => ts.sys.resolvePath(fileName) === sourcePath;
  const source = `
    import { command, option, parsers } from '../src';

    const color = option('color', parsers.enum(['auto', 'never']), {
      default: 'auto',
    });
    command('consumer', {
      args: [color],
      handler: ({ color }) => {
        const exact: 'auto' | 'never' = color;
        void exact;
      },
    });

    // @ts-expect-error undefined is not a valid string default
    option('undefined-default', parsers.string, { default: undefined });

    // @ts-expect-error required arguments cannot also have defaults
    option('conflicting-presence', parsers.string, { required: true, default: undefined });

    // @ts-expect-error undefined is not a valid string defaultMissing value
    option('undefined-default-missing', parsers.string, { defaultMissing: undefined });
  `;
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => isSourcePath(fileName) || ts.sys.fileExists(fileName);
  host.readFile = (fileName) => isSourcePath(fileName) ? source : ts.sys.readFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (isSourcePath(fileName)) {
      return ts.createSourceFile(fileName, source, languageVersion, true);
    }
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram([sourcePath], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const formatted = ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
  expect(formatted).toBe('');
}, { timeout: 20_000 });
