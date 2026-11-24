import {
  expect,
  test,
} from 'bun:test';
import * as completionApi from '../src/completion';
import * as mainApi from '../src/index';

test('keeps the runtime package exports explicit', () => {
  expect(Object.keys(mainApi).sort()).toEqual([
    'CliError',
    'DisplayKind',
    'ErrorKind',
    'colorFlag',
    'command',
    'completionShells',
    'count',
    'describeCommand',
    'flag',
    'getValueSource',
    'getWarnings',
    'isCompletionShell',
    'option',
    'parsers',
    'positional',
    'renderManPage',
    'renderMarkdown',
  ]);
  expect(Object.keys(completionApi).sort()).toEqual([
    'completionShells',
    'dynamicCompletionEnvironment',
    'generateCompletion',
    'isCompletionShell',
    'resolveDynamicCompletion',
  ]);
});

test('keeps the parser namespace explicit', () => {
  expect(Object.keys(mainApi.parsers).sort()).toEqual([
    'bigint',
    'boolean',
    'byteSize',
    'color',
    'cron',
    'custom',
    'date',
    'duration',
    'enum',
    'float',
    'integer',
    'json',
    'keyValue',
    'map',
    'path',
    'range',
    'refine',
    'regex',
    'string',
    'url',
  ]);
});
