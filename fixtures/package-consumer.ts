import {
  CliError,
  colorFlag,
  command,
  CommandFailure,
  completionShells,
  count,
  describeCommand,
  flag,
  generateConfigSchema,
  getValueSource,
  getWarnings,
  loadConfig,
  option,
  parsers,
  positional,
  renderManPage,
  renderMarkdown,
  type CommandConfig,
  type CommandConfigSchema,
  type CommandExample,
  type CommandMetadata,
  type CommandValidationIssue,
  type ConditionalDefaultMetadata,
  type ConsoleOptions,
  type ConsoleWriters,
  type DeprecationWarning,
  type EnumParserOptions,
  type EnumValue,
  type FileStat,
  type FileStyleOptions,
  type HandlerConsole,
  type Infer,
  type KeyValuePair,
  type LinkStyleOptions,
  type OutputWriter,
  type ParseOutcome,
  type PathParserOptions,
  type PathStyleOptions,
  type RunOptions,
  type RunParsedOptions,
  type Style,
  type StyleOptions,
  type SyncOutputWriter,
  type ValueParser,
  type ValueSource,
} from '@konstit/cli';
import {
  dynamicCompletionEnvironment,
  generateCompletion,
  resolveDynamicCompletion,
  type CompletionOptions,
  type DynamicCompletionProvider,
} from '@konstit/cli/completion';
import {
  invoke,
  type InvokeOptions,
  type InvokeResult,
} from '@konstit/cli/testing';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const deployExample: CommandExample = { command: 'tool --config app.json deploy --region us', description: 'Deploy to the US region.' };
const child = command('deploy', {
  examples: [deployExample],
  args: [
    option('region', parsers.enum(['us', 'eu']), { required: true }),
    flag('dryRun'),
  ],
  requiresValue: [['dryRun', 'region', 'us']],
  validate({ region, dryRun }) {
    type _RegionIsExact = Expect<Equal<typeof region, 'us' | 'eu'>>;
    if (dryRun && region === 'eu') {
      const issue: CommandValidationIssue<'region' | 'dryRun'> = {
        argumentName: 'region',
        relatedArguments: ['dryRun'],
        message: 'The selected region does not support dry runs.',
      };
      return issue;
    }
  },
  handler: async ({ region }, { stdout }) => {
    if (region === 'eu') {
      throw new CommandFailure('Deployment is unavailable.', 4);
    }
    const written: Promise<void> = stdout(region);
    await written;
  },
});
const cli = command('tool', {
  args: [
    option('config', parsers.string, { required: true, sensitive: true }),
    option('define', parsers.keyValue),
    positional('files', parsers.string, { trailingVarArg: true }),
    colorFlag('color'),
    count('verbose'),
  ],
  subcommands: [child],
  subcommandRequired: true,
});

type Actual = Infer<typeof cli>;
type Expected = {
  readonly config: string;
  readonly define: KeyValuePair | undefined;
  readonly files: readonly string[];
  readonly color: boolean;
  readonly verbose: number;
  readonly subcommand: {
    readonly name: 'deploy';
    readonly args: {
      readonly region: 'us' | 'eu';
      readonly dryRun: boolean;
    };
  };
};
type _InferContract = Expect<Equal<Actual, Expected>>;

const parser: ValueParser<number> = parsers.custom('PORT', Number);
const pathParserOptions: PathParserOptions = { kind: 'file', mustExist: true };
const pathParser: ValueParser<string> = parsers.path(pathParserOptions);
const outcome: ParseOutcome<Actual> = cli.parse([
  '--config',
  'tool.json',
  'deploy',
  '--region',
  'us',
]);
const completionOptions: CompletionOptions = { dynamic: true };
const provider: DynamicCompletionProvider<Actual> = ({ values }) => {
  return values.config === 'tool.json' ? ['us', 'eu'] : [];
};
const script: string = generateCompletion(
  cli,
  completionShells[0],
  completionOptions,
);
const errorType: typeof CliError = CliError;

void (() => {
  const chunks: string[] = [];
  const stderr: OutputWriter = (text) => Promise.resolve(chunks.push(text));
  const syncWriter: SyncOutputWriter = (text) => chunks.push(text);
  const output: ConsoleWriters = { stdout: syncWriter, stderr: () => {} };
  const consoleOptions: ConsoleOptions = { output, lsColors: '*.csv=38;5;114' };
  const stdin: ReadableStream<Uint8Array> = new Blob(['input']).stream();
  const options: RunParsedOptions = { ...consoleOptions, parseErrorExitCode: 1, color: false, stdin, stderr };
  const runOptions: RunOptions = { ...options, argv: [] };
  const executed: Promise<number> = cli.runParsed(outcome, options);
  const attempted: Promise<number> = cli.runParsed(cli.tryParse([]), options);
  const run: Promise<number> = cli.run(runOptions);
  const invokeOptions: InvokeOptions = { stdin };
  const invocation: Promise<InvokeResult> = invoke(cli, ['--config', 'tool.json', 'deploy', '--region', 'us'], invokeOptions);
  const configSchema: CommandConfigSchema = generateConfigSchema(cli);
  const loadedConfig: Promise<CommandConfig> = loadConfig('tool.json');
  void [executed, attempted, run, invocation, configSchema, loadedConfig];
  // @ts-expect-error a child parse result cannot replace the root result
  void cli.runParsed(child.parse(['--region', 'us']));
  // @ts-expect-error runParsed cannot take argv
  void cli.runParsed(outcome, { argv: [] });
  // @ts-expect-error synchronous output sinks reject promises
  void cli.run({ output: { stdout: async (_text: string) => {} } });
  // @ts-expect-error synchronous output sinks reject promised byte counts
  void cli.runParsed(outcome, { output: { stderr: (text) => Promise.resolve(text.length) } });
});

void (() => {
  const app = command('styled', {
    handler: async (_args, context) => {
      const style: Style = context.style;
      const output: HandlerConsole = context.output;
      type _ConsoleContract = Expect<
        Equal<HandlerConsole, Record<'log' | 'debug' | 'info' | 'warn' | 'error', (...data: unknown[]) => void>>
      >;
      type _StyleReturnsString = Expect<Equal<ReturnType<Style>, string>>;
      const options: StyleOptions = { stream: 'stderr', color: '#dc2626', background: 'black', bold: true };
      const linkOptions: LinkStyleOptions = { stream: 'stdout', label: 'Documentation' };
      const stats: FileStat = { mode: 0o100644, nlink: 1 };
      const fileOptions: FileStyleOptions = { stats, targetStats: null, label: 'report.csv' };
      const pathOptions: PathStyleOptions = { stream: 'stdout', label: 'report.csv' };
      const filename: string = style.file('/data/report.csv', fileOptions);
      const inspected: Promise<string> = style.path('/data/report.csv', pathOptions);
      const docs: string = style.link(new URL('https://example.com/docs'), linkOptions);
      output.info(filename);
      await context.stdout(docs);
      await context.stdout(await new Response(context.stdin).text());
      await context.stderr(style(await inspected, options));
      // @ts-expect-error the handler's style binding is immutable
      context.style = style;
      // @ts-expect-error the handler's output binding is immutable
      context.output = output;
      output.log('Count: %d', 42);
    },
  });
  void app.run({ lsColors: false });
});

void (() => {
  const port = parsers.refine(parsers.integer, (value) => value > 0, 'Expected a positive port');
  const label: ValueParser<string> = parsers.map(port, (value) => `port:${value}`);
  const app = command('serve', {
    args: [option('port', port, {
      aliases: ['listen'],
      deprecatedAliases: { listen: 'Use --port.' },
      default: 3000,
    })],
    handler: ({ port }) => {
      void port;
    },
  });
  const config: CommandConfig = { values: { port: '8080' } };
  const result = app.tryParse([], { config });
  const warnings: readonly DeprecationWarning[] = getWarnings(result);
  if (result.type === 'value') {
    const source: ValueSource | undefined = getValueSource(result.value, 'port');
    void source;
    // @ts-expect-error source lookup requires a declared argument name
    getValueSource(result.value, 'unknown');
  } else if (result.type === 'error') {
    const position: number | undefined = result.error.tokenIndex;
    const path: readonly string[] = result.error.commandPath;
    void [position, path];
  }
  const metadata: CommandMetadata = describeCommand(app);
  const markdown: string = renderMarkdown(app);
  const man: string = renderManPage(app, { section: '1', date: '2026-10-18' });
  const run: Promise<number> = app.run({
    config,
    onWarning: (warning) => {
      void warning.message;
    },
  });
  void [label, warnings, metadata, markdown, man, run];
});

void (() => {
  const choice: EnumValue<'production'> = {
    value: 'production',
    aliases: ['prod'],
    describe: 'Production mode',
  };
  const options: EnumParserOptions = { ignoreCase: true };
  const mode = parsers.enum(['development', choice], options);
  const app = command('defaults', {
    args: [
      option('mode', mode, { default: 'development' }),
      option('port', parsers.integer, { default: 3000 }),
      option('tags', parsers.string, { repeatable: true, defaultValues: ['local'] }),
      option('pair', parsers.integer, { numArgs: 2, defaultValues: [1, 2] }),
    ],
    defaultIf: [{ source: 'mode', equals: 'production', target: 'port', value: 443 }],
    argsOverrideSelf: true,
  });
  type ExpectedDefaults = {
    readonly mode: 'development' | 'production';
    readonly port: number;
    readonly tags: readonly string[];
    readonly pair: readonly [number, number];
  };
  type _DefaultsContract = Expect<Equal<Infer<typeof app>, ExpectedDefaults>>;
  const rule: ConditionalDefaultMetadata | undefined = describeCommand(app).defaultIf[0];
  void rule;
  command('invalid-condition', {
    args: [option('mode', mode), option('port', parsers.integer)],
    // @ts-expect-error conditions compare canonical values, not enum aliases
    defaultIf: [{ source: 'mode', equals: 'prod', target: 'port', value: 443 }],
  });
  command('invalid-default', {
    args: [option('mode', mode), option('port', parsers.integer)],
    // @ts-expect-error conditional values must match the target parser output
    defaultIf: [{ source: 'mode', target: 'port', value: '443' }],
  });
});

void [
  parser,
  pathParser,
  outcome,
  provider,
  script,
  errorType,
  dynamicCompletionEnvironment,
  resolveDynamicCompletion(cli, ['deploy', '--region', '']),
];
