import {
  CliError,
  colorFlag,
  command,
  completionShells,
  count,
  flag,
  option,
  parsers,
  positional,
  type Infer,
  type KeyValuePair,
  type ParseOutcome,
  type ValueParser,
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

void [
  parser,
  outcome,
  provider,
  script,
  errorType,
  dynamicCompletionEnvironment,
  resolveDynamicCompletion(cli, ['deploy', '--region', '']),
];
