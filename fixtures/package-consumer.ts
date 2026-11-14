import {
  CliError,
  colorFlag,
  command,
  completionShells,
  count,
  describeCommand,
  flag,
  getValueSource,
  getWarnings,
  option,
  parsers,
  positional,
  renderManPage,
  renderMarkdown,
  type CommandConfig,
  type CommandMetadata,
  type ConditionalDefaultMetadata,
  type DeprecationWarning,
  type EnumParserOptions,
  type EnumValue,
  type Infer,
  type KeyValuePair,
  type OutputWriter,
  type ParseOutcome,
  type RunOptions,
  type RunParsedOptions,
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

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;

const child = command('deploy', {
  args: [
    option('region', parsers.enum(['us', 'eu']), { required: true }),
    flag('dryRun'),
  ],
  requiresValue: [['dryRun', 'region', 'us']],
  handler: async ({ region }, { stdout }) => {
    const written: Promise<void> = stdout(region);
    await written;
  },
});
const cli = command('tool', {
  args: [
    option('config', parsers.string, { required: true }),
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
  const options: RunParsedOptions = { parseErrorExitCode: 1, color: false, stderr };
  const runOptions: RunOptions = { ...options, argv: [] };
  const executed: Promise<number> = cli.runParsed(outcome, options);
  const attempted: Promise<number> = cli.runParsed(cli.tryParse([]), options);
  const run: Promise<number> = cli.run(runOptions);
  void [executed, attempted, run];
  // @ts-expect-error a child parse result cannot replace the root result
  void cli.runParsed(child.parse(['--region', 'us']));
  // @ts-expect-error runParsed cannot take argv
  void cli.runParsed(outcome, { argv: [] });
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
  outcome,
  provider,
  script,
  errorType,
  dynamicCompletionEnvironment,
  resolveDynamicCompletion(cli, ['deploy', '--region', '']),
];
