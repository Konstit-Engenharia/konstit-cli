import {
  expect,
  test,
} from 'bun:test';
import {
  command,
  describeCommand,
  flag,
  option,
  parsers,
  renderManPage,
  renderMarkdown,
} from '../src/index.js';

test('feature metadata preserves defaults and visible enum documentation', () => {
  const app = command('serve', {
    args: [
      option(
        'mode',
        parsers.enum([
          { value: 'development', aliases: ['dev'], describe: 'Local development' },
          { value: 'production', aliases: [], describe: 'Production deployment', hide: false },
          { value: 'legacy', aliases: ['old'], describe: 'Hidden mode', hide: true },
          'test',
        ], { ignoreCase: true }),
        { default: 'development', global: true },
      ),
      option('port', parsers.integer, { default: 3000 }),
      option('tags', parsers.string, { repeatable: true, defaultValues: ['local', 'debug'] }),
      flag('secret', { hide: true }),
    ],
    subcommands: [command('status')],
    defaultIf: [
      { source: 'mode', equals: 'production', target: 'port', value: 443 },
      { source: 'mode', target: 'tags', value: ['explicit'] },
      { source: 'secret', target: 'port', value: 80 },
    ],
    argsOverrideSelf: true,
  });
  const metadata = describeCommand(app);
  expect(metadata.argsOverrideSelf).toBe(true);
  expect(metadata.defaultIf).toEqual([
    { source: 'mode', target: 'port', hasEquals: true, equals: 'production', value: 443 },
    { source: 'mode', target: 'tags', hasEquals: false, value: ['explicit'] },
  ]);
  expect(metadata.arguments[2]).toMatchObject({ hasDefaultValue: true, defaultValues: ['local', 'debug'] });
  const parser = metadata.arguments[0]?.parser;
  expect(parser?.ignoreCase).toBe(true);
  expect(parser?.choices?.map(({ value }) => value)).toEqual(['development', 'production', 'test']);
  expect(Object.isFrozen(parser?.choices?.[0]?.aliases)).toBe(true);
  expect(Object.isFrozen(metadata.defaultIf[1]?.value)).toBe(true);
  expect(metadata.subcommands[0]?.inheritedArguments[0]?.parser).toEqual(parser);
  expect(describeCommand(app, { includeHidden: true }).defaultIf).toHaveLength(3);
  expect(describeCommand(app, { includeHidden: true }).arguments[0]?.parser?.choices).toHaveLength(4);
  for (const rendered of [app.renderHelp(), renderMarkdown(app), renderManPage(app)]) {
    expect(rendered).toContain('Local development');
    expect(rendered).toContain('insensitive values');
    expect(rendered).toContain('aliases: dev');
    expect(rendered).not.toContain('legacy');
    expect(rendered).not.toContain('Hidden mode');
  }
  expect(app.renderHelp()).toContain('[default: local,debug]');
  expect(renderMarkdown(app)).toContain('default: \\["local","debug"\\]');
  expect(renderMarkdown(app)).toContain('is explicitly provided');
  expect(renderMarkdown(app)).toContain('defaults to `443`');
  expect(renderMarkdown(app)).toContain('Later occurrences replace');
});

test('metadata omits unsupported defaults without exposing callbacks', () => {
  const callback = () => 1;
  const parser = parsers.custom('CALLBACK', () => callback);
  const app = command('callbacks', {
    args: [
      option('source', parser),
      option('target', parser),
      option('list', parser, { repeatable: true, defaultValues: [callback] }),
    ],
    defaultIf: [{ source: 'source', equals: callback, target: 'target', value: callback }],
  });
  const metadata = describeCommand(app);
  expect(metadata.defaultIf).toEqual([{ source: 'source', target: 'target', hasEquals: true }]);
  expect(metadata.arguments[2]?.defaultValues).toBeUndefined();
  expect(metadata.arguments[2]?.hasDefaultValue).toBe(true);
  expect(renderMarkdown(app)).toContain('default: unavailable');
});
