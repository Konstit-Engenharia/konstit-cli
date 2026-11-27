import {
  colorFlag,
  command,
  completionShells,
  count,
  flag,
  option,
  parsers,
  positional,
  type CompletionShell,
  type Infer,
  type OptionOptions,
  type RangeParserOptions,
} from '../src';
import { generateCompletion } from '../src/completion';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;

const integerRangeOptions: RangeParserOptions = { integer: true };
const integerRangeCli = command('bounded', {
  args: [option('port', parsers.range(1, 65_535, integerRangeOptions), { required: true })],
});
type _IntegerRangeOutputIsExact = Expect<Equal<Infer<typeof integerRangeCli>['port'], number>>;

function _checkIntegerRangeOptions() {
  // @ts-expect-error integer mode accepts only a boolean
  parsers.range(1, 10, { integer: 'true' });
}

const typedCli = command('deploy', {
  args: [
    option('port', parsers.integer, { required: true }),
    option('mode', parsers.enum(['dev', 'prod']), { default: 'dev' }),
    option('labels', parsers.string, { repeatable: true }),
    flag('verbose'),
    positional('directory'),
  ],
  subcommands: [
    command('init', { args: [flag('bare')] }),
    command('remote', {
      args: [positional('url', parsers.string, { required: true })],
    }),
  ],
  subcommandRequired: true,
});

type Actual = Infer<typeof typedCli>;
type Expected = {
  readonly port: number;
  readonly mode: 'dev' | 'prod';
  readonly labels: readonly string[];
  readonly verbose: boolean;
  readonly directory: string | undefined;
  readonly subcommand:
    | { readonly name: 'init'; readonly args: { readonly bare: boolean; }; }
    | { readonly name: 'remote'; readonly args: { readonly url: string; }; };
};

type _ResultIsExact = Expect<Equal<Actual, Expected>>;

function _checkConditionalRequiredArguments() {
  const profile = option('profile', parsers.string, { global: true, required: true });
  const input = option('input', parsers.string, { required: 'without-subcommand' });
  const bounds = option('bounds', parsers.integer, { required: 'without-subcommand', numArgs: 2 });
  const label = option('label', parsers.string, { required: 'without-subcommand', numArgs: { min: 0, max: 1 } });
  const child = command('clean', {
    handler: (_args, ctx) => {
      const global = ctx.global(profile);
      type _GlobalIsRequired = Expect<Equal<typeof global, string>>;
    },
  });
  const cli = command('tool', {
    args: [profile, input, bounds, label],
    subcommands: [child],
    handler: ({ input, bounds, label, subcommand }) => {
      type _DirectInput = Expect<Equal<typeof input, string>>;
      type _DirectTuple = Expect<Equal<typeof bounds, readonly [number, number]>>;
      type _DirectValueIsOptional = Expect<Equal<typeof label, string | undefined>>;
      type _NoSubcommand = Expect<Equal<typeof subcommand, undefined>>;
    },
    validate: (value) => {
      if (value.subcommand === undefined) {
        type _DirectInput = Expect<Equal<typeof value.input, string>>;
      } else {
        type _ChildInput = Expect<Equal<typeof value.input, string | undefined>>;
        type _ChildGlobal = Expect<Equal<typeof value.profile, string>>;
      }
    },
  });
  const result = cli.tryParse([]);
  if (result.type === 'value') {
    const { value } = result;
    type _GlobalAcrossBranches = Expect<Equal<typeof value.profile, string>>;
    if (value.subcommand === undefined) {
      type _DirectInput = Expect<Equal<typeof value.input, string>>;
      type _DirectTuple = Expect<Equal<typeof value.bounds, readonly [number, number]>>;
    } else {
      type _ChildInput = Expect<Equal<typeof value.input, string | undefined>>;
      type _ChildTuple = Expect<Equal<typeof value.bounds, readonly [number, number] | undefined>>;
      type _Subcommand = Expect<Equal<typeof value.subcommand.name, 'clean'>>;
    }
  }
  const leaf = command('leaf', { args: [input] });
  type _LeafInput = Expect<Equal<Infer<typeof leaf>['input'], string>>;
  const nested = command('nested', { subcommands: [cli], subcommandRequired: true });
  type _NestedInput = Expect<Equal<Infer<typeof nested>['subcommand']['args'], Infer<typeof cli>>>;
  const forwarding = command('forwarding', { args: [input], subcommands: [child], subcommandRequired: true });
  type _SubcommandAlwaysSelected = Expect<Equal<Infer<typeof forwarding>['subcommand']['name'], 'clean'>>;
  type _ForwardingInput = Expect<Equal<Infer<typeof forwarding>['input'], string | undefined>>;

  // @ts-expect-error globals are required independently of subcommand selection
  option('scoped-global', parsers.string, { global: true, required: 'without-subcommand' });
  // @ts-expect-error required arguments cannot declare a fallback
  option('scoped-default', parsers.string, { default: 'fallback', required: 'without-subcommand' });
}

const initializedCli = command('release', {
  version: '1.0.0',
  about: 'Create a release',
  argsConflictWithSubcommands: true,
  args: [
    option('port', parsers.integer, { required: true }),
    flag('dryRun'),
  ],
  subcommands: [
    command('init', { args: [flag('bare')] }),
    command('remote', {
      args: [positional('url', parsers.string, { required: true })],
    }),
  ],
  defaultToHelp: true,
  handler: ({ port, dryRun, subcommand }) => {
    const _typedPort: number = port;
    const _typedDryRun: boolean = dryRun;
    const _typedSubcommand: InitializedExpected['subcommand'] = subcommand;
  },
});

type InitializedActual = Infer<typeof initializedCli>;
type InitializedExpected = {
  readonly port: number;
  readonly dryRun: boolean;
  readonly subcommand:
    | { readonly name: 'init'; readonly args: { readonly bare: boolean; }; }
    | { readonly name: 'remote'; readonly args: { readonly url: string; }; }
    | undefined;
};
type _InitializerResultIsExact = Expect<
  Equal<InitializedActual, InitializedExpected>
>;

const requiredSubcommandHandler = command('required-handler', {
  subcommands: [command('child', { args: [flag('force')] })],
  subcommandRequired: true,
  handler: ({ subcommand }) => {
    type _HandlerSubcommandIsRequired = Expect<
      Equal<
        typeof subcommand,
        {
          readonly name: 'child';
          readonly args: { readonly force: boolean; };
        }
      >
    >;
    const _childName: 'child' = subcommand.name;
    const _force: boolean = subcommand.args.force;
  },
});
type _RequiredHandlerResultIsExact = Expect<
  Equal<
    Infer<typeof requiredSubcommandHandler>,
    {
      readonly subcommand: {
        readonly name: 'child';
        readonly args: { readonly force: boolean; };
      };
    }
  >
>;

const colorParser = parsers.enum(['auto', 'always', 'never']);
const configuredVerbose = count('verbose', {
  global: true,
  short: 'v',
  describe: 'Verbosity',
});
const configuredColor = option('color', colorParser, {
  global: true,
  default: 'auto',
});
const configuredOutputColor = colorFlag('outputColor');
const configuredArgumentsCli = command('configured-arguments', {
  args: [
    configuredVerbose,
    configuredColor,
    configuredOutputColor,
    option('fallback', colorParser),
  ],
  handler: ({ color, fallback }, context) => {
    const _typedColor: 'auto' | 'always' | 'never' = color;
    const _typedFallback: 'auto' | 'always' | 'never' | undefined = fallback;
    const _typedVerbose: number = context.global(configuredVerbose);
    const _typedOutputColor: boolean = context.global(configuredOutputColor);
  },
});

type ConfiguredArgumentsActual = Infer<typeof configuredArgumentsCli>;
type ConfiguredArgumentsExpected = {
  readonly verbose: number;
  readonly color: 'auto' | 'always' | 'never';
  readonly outputColor: boolean;
  readonly fallback: 'auto' | 'always' | 'never' | undefined;
};
type _ConfiguredArgumentsAreExact = Expect<
  Equal<ConfiguredArgumentsActual, ConfiguredArgumentsExpected>
>;

const requiredDefinedParser = command('required-defined-parser', {
  args: [
    option(
      'value',
      parsers.custom<string | undefined>('DEFINED', (input) => input),
      { required: true },
    ),
  ],
});
type _RequiredParserValueIsDefined = Expect<
  Equal<Infer<typeof requiredDefinedParser>['value'], string>
>;

const advancedConfiguredCli = command('advanced-configured', {
  args: [
    option('pair', parsers.string, { numArgs: 2, required: true }),
    option('points', parsers.integer, { numArgs: 2, repeatable: true }),
    option('values', parsers.integer, { numArgs: { min: 1, max: 3 } }),
    option('maybe', parsers.string, {
      numArgs: { min: 0, max: 1 },
      required: true,
    }),
    option('mode', parsers.enum(['fast', 'safe']), { defaultMissing: 'safe' }),
    positional('command', parsers.string, { trailingVarArg: true }),
    flag('debug'),
  ],
  handler: ({ pair, points, values, maybe, mode, command }) => {
    const _typedPair: readonly [string, string] = pair;
    const _typedPoints: readonly number[] = points;
    const _typedValues: readonly number[] | undefined = values;
    const _typedMaybe: string | undefined = maybe;
    const _typedMode: 'fast' | 'safe' | undefined = mode;
    const _typedCommand: readonly string[] = command;
  },
});

type AdvancedConfiguredActual = Infer<typeof advancedConfiguredCli>;
type AdvancedConfiguredExpected = {
  readonly pair: readonly [string, string];
  readonly points: readonly number[];
  readonly values: readonly number[] | undefined;
  readonly maybe: string | undefined;
  readonly mode: 'fast' | 'safe' | undefined;
  readonly command: readonly string[];
  readonly debug: boolean;
};
type _AdvancedConfiguredArgumentsAreExact = Expect<
  Equal<AdvancedConfiguredActual, AdvancedConfiguredExpected>
>;

const broadOptions = {} as OptionOptions<string>;
const broadConfiguredCli = command('broad-configured', {
  args: [option('value', parsers.string, broadOptions)],
});
type _BroadConfiguredOutputIsSafe = Expect<
  Equal<
    Infer<typeof broadConfiguredCli>['value'],
    string | readonly string[] | undefined
  >
>;

const optionalPairOptions: { readonly numArgs?: 2; } = { numArgs: 2 };
const optionalPairCli = command('optional-pair', {
  args: [option('pair', parsers.string, optionalPairOptions)],
});
type _OptionalPairConfigKeepsPrecision = Expect<
  Equal<
    Infer<typeof optionalPairCli>['pair'],
    string | readonly [string, string] | undefined
  >
>;

const disabledRepeatOptions: { readonly repeatable?: false; } = {};
const disabledRepeatCli = command('disabled-repeat', {
  args: [option('value', parsers.string, disabledRepeatOptions)],
});
type _DisabledOptionalRepeatStaysScalar = Expect<
  Equal<Infer<typeof disabledRepeatCli>['value'], string | undefined>
>;

const envScalarCli = command('env', {
  args: [option('port', parsers.integer, { env: 'PORT' })],
});
type _EnvScalarIsExact = Expect<
  Equal<Infer<typeof envScalarCli>['port'], number | undefined>
>;

const parsedOutcome = typedCli.parse(['--port', '3000', 'init']);
if (parsedOutcome.type !== 'value') {
  throw new Error('expected parsed arguments');
}
const parsed = parsedOutcome.value;
const _port: number = parsed.port;
const _mode: 'dev' | 'prod' = parsed.mode;
const _labels: readonly string[] = parsed.labels;

switch (parsed.subcommand.name) {
  case 'init': {
    const _bare: boolean = parsed.subcommand.args.bare;
    break;
  }
  case 'remote': {
    const _url: string = parsed.subcommand.args.url;
    break;
  }
}

const shell: CompletionShell = completionShells[0];
const _completionScript: string = generateCompletion(typedCli, shell);

const advanced = command('advanced', {
  args: [
    option('pair', parsers.string, {
      numArgs: 2,
      env: 'ADVANCED_PAIR',
      required: true,
    }),
    option('points', parsers.integer, { numArgs: 2, repeatable: true }),
    option('values', parsers.integer, { numArgs: { min: 1, max: 3 } }),
    option('mode', parsers.enum(['fast', 'safe']), { defaultMissing: 'safe' }),
    positional('command', parsers.string, { trailingVarArg: true }),
  ],
});
const advancedOutcome = advanced.parse(['--pair', 'left', 'right']);
if (advancedOutcome.type !== 'value') {
  throw new Error('expected parsed arguments');
}
const advancedResult = advancedOutcome.value;
const _pair: readonly [string, string] = advancedResult.pair;
const _points: readonly number[] = advancedResult.points;
const _values: readonly number[] | undefined = advancedResult.values;
const _advancedMode: 'fast' | 'safe' | undefined = advancedResult.mode;
const _trailingCommand: readonly string[] = advancedResult.command;

type HandlerArguments = {
  readonly port: number;
  readonly mode: 'dev' | 'prod';
  readonly verbose: boolean;
};
const handlerCommand = command('handler', {
  args: [
    option('port', parsers.integer, { required: true }),
    option('mode', parsers.enum(['dev', 'prod']), { default: 'dev' }),
    flag('verbose'),
  ],
  handler: (args) => {
    type _HandlerArgsAreExact = Expect<Equal<typeof args, HandlerArguments>>;
    const { port, mode, verbose } = args;
    const _typedPort: number = port;
    const _typedMode: 'dev' | 'prod' = mode;
    const _typedVerbose: boolean = verbose;
    return 4;
  },
});
type _HandlerKeepsCommandResult = Expect<
  Equal<Infer<typeof handlerCommand>, HandlerArguments>
>;

const asyncHandlerCommand = command('async-handler', {
  args: [positional('file', parsers.string, { required: true })],
  handler: async ({ file }) => file === 'ok' ? 0 : 1,
});

const nestedHandler = command('serve', {
  args: [option('port', parsers.integer, { required: true })],
  handler: ({ port }) => {
    const _typedPort: number = port;
  },
});
const handlerRoot = command('tool', {
  args: [flag('verbose')],
  subcommands: [nestedHandler],
  handler: ({ verbose }) => {
    const _typedVerbose: boolean = verbose;
  },
});

function _checkCommandConfigurationAndRunTypes() {
  const _defaultArgvExitCode: Promise<number> = handlerCommand.run();
  const _syncExitCode: Promise<number> = handlerCommand.run(['--port', '3000']);
  const _asyncExitCode: Promise<number> = asyncHandlerCommand.run(['ok']);
  const _nestedExitCode: Promise<number> = handlerRoot.run(['serve', '--port', '3000']);
  // @ts-expect-error parse requires explicit argv
  typedCli.parse();
  // @ts-expect-error tryParse requires explicit argv
  typedCli.tryParse();
  // @ts-expect-error command schemas expose no fluent argument mutation
  handlerCommand.arg(flag('late'));
  // @ts-expect-error command schemas expose no fluent subcommand mutation
  handlerCommand.subcommand(command('late'));
  command('duplicate-initial-arguments', {
    // @ts-expect-error duplicate argument names are rejected in initializer tuples
    args: [flag('verbose'), flag('verbose')],
  });
  const trailing = positional('tail', parsers.string, { trailingVarArg: true });
  command('positional-after-trailing', {
    // @ts-expect-error another positional cannot follow a trailing positional
    args: [trailing, flag('verbose'), positional('input')],
  });
  command('two-trailing-positionals', {
    // @ts-expect-error at most one positional can be trailing
    args: [trailing, positional('other', parsers.string, { trailingVarArg: true })],
  });
  command('duplicate-initial-subcommands', {
    // @ts-expect-error duplicate subcommand names are rejected in initializer tuples
    subcommands: [command('run'), command('run')],
  });
  // @ts-expect-error command schemas expose no fluent mutation
  initializedCli.arg(flag('late'));
  command('bad-initial-handler-argument', {
    args: [flag('verbose')],
    // @ts-expect-error initializer handlers only receive configured arguments
    handler: ({ missing }) => missing,
  });
  command('bad-initial-handler-result', {
    // @ts-expect-error initializer handlers return void or a numeric exit code
    handler: () => 'failure',
  });
  command('bad-command-key', {
    // @ts-expect-error command configuration does not accept unknown fields
    unknownCommandField: true,
  });
  command('bad-group-key', {
    args: [flag('known')],
    // @ts-expect-error group configuration does not accept unknown fields
    groups: [{ name: 'group', members: ['known'], unknownGroupField: true }],
  });
  option('bad-default', colorParser, {
    // @ts-expect-error defaults must match the parser output
    default: 'sometimes',
  });
  // @ts-expect-error undefined is not a valid string default
  option('undefined-default', parsers.string, {
    default: undefined,
  });
  option(
    'bad-parser-order', // @ts-expect-error argument configuration cannot replace the positional parser
    { default: 'auto' },
  );
  count('bad-short', {
    // @ts-expect-error short names are exactly one character
    short: 'vv',
  });
  const widenedShort = 'v' as string;
  count('widened-short', { short: widenedShort });
  count('dash-short', {
    // @ts-expect-error a dash is not a valid short option
    short: '-',
  });
  count('unicode-short', {
    short: '界',
  });
  positional('path', parsers.string, {
    // @ts-expect-error positional arguments cannot be global
    global: true,
  });
  // @ts-expect-error positionals cannot configure short names
  positional('named-positional', parsers.string, {
    required: true,
    short: 'p',
  });
  // @ts-expect-error literal capture requires a trailing positional
  positional('args', parsers.string, { literal: true });
  // @ts-expect-error named options cannot start literal capture
  option('args', parsers.string, { literal: true });
  // @ts-expect-error joining requires literal capture
  positional('args', parsers.string, { trailingVarArg: true, joinWith: ' ' });
  // @ts-expect-error joining is a positional setting
  option('args', parsers.string, { joinWith: ' ' });
  // @ts-expect-error flags cannot be repeatable
  flag('value-flag', {
    describe: 'Invalid value configuration',
    repeatable: true,
  });
  // @ts-expect-error counts cannot configure value counts
  count('value-count', {
    describe: 'Invalid value configuration',
    numArgs: 2,
  });
  // @ts-expect-error options cannot be negated
  option('negated-option', parsers.string, {
    required: true,
    negated: true,
  });
  // @ts-expect-error required and default presence cannot be combined
  option('conflicting-presence', parsers.string, {
    required: true,
    default: 'value',
  });
  // @ts-expect-error repeatable arguments cannot have scalar defaults
  option('repeatable-default', parsers.string, {
    repeatable: true,
    default: 'value',
  });
  // @ts-expect-error multi-value arguments cannot have scalar defaults
  option('multi-default', parsers.string, {
    numArgs: 2,
    default: 'value',
  });
  // @ts-expect-error ranged multi-value arguments cannot have scalar defaults
  option('ranged-default', parsers.string, {
    numArgs: { min: 1, max: 2 },
    default: 'value',
  });
  // @ts-expect-error defaultMissing defines its own optional value arity
  option('missing-count', parsers.string, {
    defaultMissing: 'value',
    numArgs: 1,
  });
  option('missing-without-equals', parsers.string, {
    defaultMissing: 'value',
    requireEquals: false,
  });
  // @ts-expect-error defaultMissing must match the parser output
  option('bad-missing', parsers.integer, { defaultMissing: 'value' });
  // @ts-expect-error options cannot be trailing positional arguments
  option('trailing-option', parsers.string, { trailingVarArg: true });
  // @ts-expect-error positionals cannot require equals-form values
  positional('equals-positional', parsers.string, { requireEquals: true });
  // @ts-expect-error positionals cannot configure defaultMissing
  positional('missing-positional', parsers.string, { defaultMissing: 'value' });
  // @ts-expect-error trailing arguments cannot also be repeatable
  positional('repeatable-trailing', parsers.string, {
    trailingVarArg: true,
    repeatable: true,
  });
  // @ts-expect-error trailing arguments cannot configure a separate arity
  positional('counted-trailing', parsers.string, {
    trailingVarArg: true,
    numArgs: 2,
  });
  // @ts-expect-error trailing arguments cannot have scalar defaults
  positional('defaulted-trailing', parsers.string, {
    trailingVarArg: true,
    default: 'value',
  });
  command('bad-relation', {
    args: [flag('one'), flag('two')],
    // @ts-expect-error relation names must refer to declared arguments
    requires: [['one', 'missing']],
  });
  command('bad-group', {
    args: [flag('one'), flag('two')],
    // @ts-expect-error group members must refer to declared arguments
    groups: [{ name: 'bad', members: ['one', 'missing'] }],
  });
  // @ts-expect-error completion shells are a closed union
  generateCompletion(typedCli, 'nu');
  // @ts-expect-error flags do not consume values
  flag('verbose', { valueHint: 'file' });
  // @ts-expect-error value hints are a closed union
  option('database', parsers.string, { valueHint: 'database' });
  command('bad-relation-value', {
    args: [
      option('mode', parsers.enum(['dev', 'prod'])),
      option('config'),
    ],
    // @ts-expect-error conditional relation values match the source parser
    requiresIf: [['mode', 'preview', 'config']],
  });
  command('bad-relation-name', {
    args: [flag('offline'), option('config')],
    // @ts-expect-error conditional relation names must exist
    requiredUnlessPresent: [{ alternatives: ['offline'], target: 'missing' }],
  });
  const valueArgs = [option('entry'), option('format', parsers.enum(['zip', 'gzip']))] as const;
  command('archive', { args: valueArgs, requiresValue: [['entry', 'format', 'zip']] });
  // @ts-expect-error expected values match the target parser
  command('archive', { args: valueArgs, requiresValue: [['entry', 'format', 'text']] });
  // @ts-expect-error source and target must be different arguments
  command('archive', { args: valueArgs, requiresValue: [['format', 'format', 'zip']] });
  // @ts-expect-error both argument names must exist
  command('archive', { args: valueArgs, requiresValue: [['missing', 'format', 'zip']] });
  const countArgs = [option('mode', parsers.enum(['pair', 'any'])), option('input', parsers.string, { repeatable: true })] as const;
  command('export', { args: countArgs, requiresIf: [['mode', 'pair', 'input', { exactValues: 2 }]] });
  // @ts-expect-error count constraints still check the source value type
  command('export', { args: countArgs, requiresIf: [['mode', 'other', 'input', { exactValues: 2 }]] });
  // @ts-expect-error exact counts are mutually exclusive with bounds
  command('export', { args: countArgs, requiresIf: [['mode', 'pair', 'input', { exactValues: 2, maxValues: 3 }]] });
  // @ts-expect-error the fourth tuple element must specify at least one count
  command('export', { args: countArgs, requiresIf: [['mode', 'pair', 'input', {}]] });
}
