# @konstit/cli

A declarative, type-safe command-line parser for Bun.

The command and argument factories infer the successful parse type from one
static schema. This is an independent TypeScript implementation inspired by
clap. It is not a source port.

## Type safety

- Value parsers determine the returned TypeScript type.
- `required: true` removes `undefined` when the configured arity guarantees a value.
- `default` keeps a value present.
- `defaultValues` keeps a collection present, preserving fixed tuple types.
- `repeatable: true` returns `readonly Value[]`.
- `numArgs: 2` returns an exact readonly tuple for a non-repeated argument.
- Ranged and repeated arity return readonly arrays.
- Flags and counters return `boolean` and `number`.
- Subcommands return a discriminated union.
- `subcommandRequired: true` removes `undefined` from that union.
- Argument names and conditional values in relations are checked.
- Duplicate argument, subcommand, and group names fail during type checking.
- Widened arrays and JavaScript input receive structural runtime validation.
- Handler contexts preserve the exact type of each global argument.

## Install

Requires Bun 1.4 or newer.

```sh
bun add @konstit/cli
```

## Quick start

```ts
import {
  colorFlag,
  command,
  count,
  flag,
  option,
  parsers,
  positional,
  type Infer,
} from '@konstit/cli';

const verbose = count('verbose', { global: true, short: 'v' });
const color = colorFlag('color');

const serve = command('serve', {
  about: 'Serve static files',
  version: '1.0.0',
  args: [
    option('port', parsers.range(1, 65_535, { integer: true }), {
      short: 'p',
      default: 3000,
    }),
    option('host', parsers.string, { default: '127.0.0.1' }),
    flag('open', { short: 'o' }),
    verbose,
    color,
    positional('root', parsers.string, { required: true }),
  ],
  handler: async ({ port, host, open, verbose, color, root }) => {
    // port: number; host: string; open: boolean
    // verbose: number; color: boolean; root: string
    console.log(`Serving ${root} on ${host}:${port}`);
  },
});

type Args = Infer<typeof serve>;

process.exitCode = await serve.run();
```

Tuple order is preserved. A command schema is complete when `command()`
returns. Add all arguments, subcommands, relations, and the handler in its
options object.

## Command configuration

`command(name, options)` accepts these fields:

| Field                         | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `version`                     | Text printed by `-V` and `--version`.                                   |
| `about`                       | Short help and completion description.                                  |
| `longAbout`                   | Extended help description.                                              |
| `author`                      | Author line in help.                                                    |
| `beforeHelp`                  | Text before generated help.                                             |
| `afterHelp`                   | Text after generated help.                                              |
| `overrideUsage`               | Exact replacement for generated usage.                                  |
| `overrideHelp`                | Exact replacement for generated help.                                   |
| `aliases`                     | Parseable aliases hidden from help and completion.                      |
| `visibleAliases`              | Parseable aliases shown in help and completion.                         |
| `deprecated`                  | Replacement guidance emitted when the command is invoked.               |
| `deprecatedAliases`           | Deprecation messages keyed by declared aliases.                         |
| `args`                        | Argument tuple in parse order.                                          |
| `subcommands`                 | Subcommand tuple.                                                       |
| `inferSubcommands`            | Accept an unambiguous name or alias prefix.                             |
| `argsOverrideSelf`            | Let the last occurrence replace a non-repeated option or ordinary flag. |
| `subcommandRequired`          | Require a subcommand and make its result non-optional.                  |
| `argsConflictWithSubcommands` | Reject explicit local arguments when a subcommand is selected.          |
| `defaultToHelp`               | Display help when no argument or subcommand is supplied.                |
| `disableHelpSubcommand`       | Disable the generated `help` subcommand.                                |
| `disableHelpFlag`             | Disable generated `-h` and `--help`.                                    |
| `disableVersionFlag`          | Disable generated `-V` and `--version`.                                 |
| `hide`                        | Hide this command from parent help and completion.                      |
| `requires`                    | Unconditional argument dependencies.                                    |
| `requiresIf`                  | Single-value conditional dependencies.                                  |
| `requiredIfAny`               | Dependencies activated by any matching condition.                       |
| `requiredIfAll`               | Dependencies activated by all matching conditions.                      |
| `requiredUnlessPresent`       | Require a target unless one alternative is present.                     |
| `requiredUnlessAll`           | Require a target unless all alternatives are present.                   |
| `overrides`                   | Clear a target when a source is explicitly supplied.                    |
| `defaultIf`                   | Supply a typed default when another argument matches.                   |
| `conflicts`                   | Mutually conflicting argument sets.                                     |
| `exclusive`                   | Arguments that conflict with every other supplied argument.             |
| `groups`                      | Named argument groups and their relations.                              |
| `handler`                     | Synchronous or asynchronous command callback.                           |

Each field is optional. Duplicate primary argument and subcommand names are
checked from literal tuples. Alias collisions, invalid layouts, and widened
configuration are checked at runtime.

## Parsing and running

`parse(argv)` parses an explicit array. It returns a parsed value or a
successful help/version display request. It throws `CliError` only for an
expected CLI failure.

```ts
const outcome = serve.parse(['--port', '8080', '.']);

if (outcome.type === 'value') {
  console.log(outcome.value.port);
} else {
  process.stdout.write(outcome.output);
}
```

`tryParse(argv)` returns `{ ok: false, type: 'error', error }` for expected CLI
failures. Unexpected programming errors still throw.

`run()` reads `Bun.argv.slice(2)`, writes displays and parse failures, invokes
the deepest selected handler, and returns an exit code. Pass an explicit array
to `run(argv)` for tests or embedding. Pass `run({ color: true })` or
`run({ color: false })` to control styling.

Set `parseErrorExitCode` to choose the status returned for parse failures:

```ts
process.exitCode = await serve.run({ parseErrorExitCode: 1 });
```

The option accepts integers from `1` to `255` and defaults to the error's
`exitCode` (`2`). Handler exit codes, including `2`, pass through unchanged;
help, version, and completion return `0`. Handler exceptions still propagate.
The original `CliError` is unchanged.

`run()` parses each normal invocation once and handles shell completion
requests before normal argument validation. Together with
`argsConflictWithSubcommands: true`, this supports a single command tree for
root operations and maintenance subcommands.

To inspect a parse result before dispatch, pass the result from the same
command's `parse()` or `tryParse()` to `runParsed()`:

```ts
const result = serve.tryParse(['--port', '8080', '.']);
if (result.type === 'value') {
  console.log('Selected port:', result.value.port);
}
process.exitCode = await serve.runParsed(result, { parseErrorExitCode: 1 });
```

`runParsed()` runs the deepest selected handler or writes the stored help,
version, or error output. It reuses parsed values and inherited globals without
parsing or applying environment fallbacks again. Its `RunParsedOptions` accepts
`stdout`, `stderr`, `color`, and `parseErrorExitCode`; `color` controls output
styling while preserving resolved argument values. Use `run()` for executable
entry points that must detect shell completion requests; `runParsed()` only
executes the supplied result.

Each command path that can be selected by `run()` needs a handler. Set
`subcommandRequired: true` when only subcommands are runnable.

Use `renderHelp()` and `renderUsage()` when output must be generated without
parsing arguments.

Expected failures expose structured details through `CliError`: `kind`,
`argumentName`, `commandPath`, `tokenIndex`, `suggestions`, and
`relatedArguments`, alongside the existing message, rendered `output`, and
`exitCode`. `tokenIndex` is zero-based in the original argv array, including
across nested subcommands. It is absent when no input token caused the error,
such as a missing required argument or an invalid environment/configuration
value. The path and suggestion arrays are immutable copies.

```ts
const result = serve.tryParse(['--port', 'invalid', '.']);
if (result.type === 'error') {
  console.log(result.error.argumentName); // port
  console.log(result.error.tokenIndex); // 1
  console.log(result.error.commandPath); // ['serve']
}
```

## Configuration and value sources

`parse()` and `tryParse()` accept an optional second `ParseOptions` argument.
`run()` accepts the same tree under `RunOptions.config`:

```ts
const result = cli.parse([], {
  config: {
    values: { host: '127.0.0.1', verbose: 1 },
    subcommands: {
      serve: { values: { port: '8080' } },
    },
  },
});
```

Configuration keys use canonical argument and subcommand names. Each
`config.values` entry must be a string, a readonly string array, a boolean, or
a nonnegative safe integer. Value options and positionals accept strings or
string arrays; each raw item goes through the argument parser after delimiter
splitting and arity checks. Flags accept booleans, and counters accept
nonnegative integer counts. Parser errors, too many values, and relations use
the same validation as CLI input. A lower-priority configuration value is
parsed only when no CLI or environment value wins, so an invalid configuration
fallback does not hide a valid higher-priority value.

For a repeatable argument, a string array is one flat sequence of values. A
fixed `numArgs` must divide that sequence into complete occurrences; for a
ranged `numArgs`, the sequence must be partitionable into occurrences whose
counts are within the configured range. For example, eight values satisfy a
repeatable `{ min: 4, max: 5 }` argument (4 + 4), while six values do not.

Configuration for the selected command tree is applied; values under another
valid subcommand are retained in the config object but are not parsed for that
invocation. For an inherited global argument, configuration at the deepest
selected command wins among configuration entries. CLI and environment values
still take priority over every configuration entry. Unknown argument or
subcommand keys produce a structured CLI error. Malformed configuration nodes
produce a `TypeError`.

Values are resolved in this order: CLI, environment, configuration, then the
argument default. A higher-priority repeated value replaces lower-priority
collections. `getValueSource(parsedValue, argumentName)` returns the source of
the final value (`'cli'`, `'env'`, `'config'`, or `'default'`); you can also
pass the original argument declaration instead of its name. Absent optional
arguments return `undefined`.

`NO_COLOR` is a source exception for `colorFlag()`: when the variable is
present, the final color value is `false` and its source is reported as `'env'`,
even when the CLI or configuration supplied the color switch.

Source metadata is attached to the parsed object identity and is preserved by
`runParsed()`. For an inherited global, pass its original argument declaration
to look it up on the root parsed value or on each selected nested
`subcommand.args` object, even when that object also has local arguments. The
global value is owned by its declaring command. A spread or clone creates a new
object without source metadata.

## Subcommands

```ts
const clone = command('clone', {
  visibleAliases: ['copy'],
  aliases: ['cp'],
  args: [
    positional('url', parsers.string, { required: true }),
    flag('bare'),
  ],
  handler: ({ url, bare }) => {
    console.log(`clone ${url}${bare ? ' --bare' : ''}`);
  },
});

const commit = command('commit', {
  args: [
    option('message', parsers.string, { short: 'm', required: true }),
  ],
  handler: ({ message }) => {
    console.log(`commit: ${message}`);
  },
});

const cli = command('repo', {
  subcommands: [clone, commit],
  inferSubcommands: true,
  subcommandRequired: true,
});

process.exitCode = await cli.run();
```

The `subcommand` result is a union discriminated by its canonical `name`.
Without `subcommandRequired: true`, it also includes `undefined`. Visible
aliases appear in help and completion. Hidden aliases affect parsing only.
`repo help clone` renders nested help.

### Local arguments that conflict with subcommands

Set `argsConflictWithSubcommands: true` when a command's local arguments are
only meaningful without a subcommand. The setting defaults to `false`.

```ts
const cli = command('demo', {
  argsConflictWithSubcommands: true,
  args: [flag('dry-run', { short: 'n' })],
  handler: (args) => {
    console.log('build dry-run:', args['dry-run']);
  },
  subcommands: [command('clean', {
    args: [flag('dry-run', { short: 'n' })],
    handler: (args) => {
      console.log('clean dry-run:', args['dry-run']);
    },
  })],
});

process.exitCode = await cli.run();
```

```sh
demo -n          # Runs build with dry-run enabled
demo clean -n    # Runs clean with dry-run enabled
demo -n clean    # ArgumentConflict; no handler runs
```

The constraint rejects explicitly supplied local flags, counts, options, and
positionals when that command selects a subcommand. An explicit occurrence
counts even if its value is `false`, empty, equal to its default, omitted for
an option with optional values, or later cleared by an `overrides` relation.
Defaults, absent arguments, and environment fallbacks do not cause conflicts.
Global options remain available before and after subcommands.

The setting applies only to the command that declares it. Enable it on nested
commands independently. Subcommand aliases and inferred prefixes follow the
same rule. Tokens consumed as positional values after `--` or by a trailing
positional do not select subcommands. Help and version requests retain their
normal display behavior.

`parse()` throws a `CliError` with `ErrorKind.ArgumentConflict`; `tryParse()`
returns that error, and `run()` reports it and returns exit code `2` by default
without calling a handler. Existing required-argument and relation checks still run.
In particular, this setting does not waive a parent's required local arguments:
if one must be supplied on the CLI, a subcommand invocation cannot satisfy both
rules. Use this constraint with local arguments that can be absent for
subcommand invocations.

## Arguments

Argument configuration is always last. Value arguments keep their parser in
the second position.

```ts
const verbose = count('verbose', {
  global: true,
  short: 'v',
  describe: 'Increase verbosity',
});

const color = option(
  'color',
  parsers.enum(['auto', 'always', 'never']),
  { global: true, default: 'auto' },
);
```

All argument kinds accept `describe`, `env`, `hide`, and `deprecated`. For value arguments
and counters, `env` parses the variable content. For flags, `env` tests only
whether the variable exists; an empty value counts as present. Named arguments
also accept `global`, `short`, `long`, `aliases`, and `deprecatedAliases`.

```ts
const ci = flag('ci', { env: 'CI' });
// CI exists: true; CI is absent: false

const color = colorFlag('color');
// Adds --color and --no-color and returns a resolved boolean.
```

`colorFlag()` is global. `NO_COLOR` presence disables color, including when
`--color` is present. Using both switches is an argument conflict. Without a
switch, handler and help output use stdout TTY detection, errors use stderr TTY
detection, and `TERM=dumb` disables color. Explicit switches override terminal
detection. The handler receives only the resolved boolean.

Value options and positionals accept:

| Field                  | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `valueName`            | Label shown in usage and help.                                  |
| `valueHint`            | `file` or `directory` path completion.                          |
| `complete`             | Dynamic completion provider.                                    |
| `required`             | Require the argument occurrence.                                |
| `default`              | Value used when the argument is absent.                         |
| `defaultValues`        | Typed values used when a collection argument is absent.         |
| `repeatable`           | Append occurrences into a readonly array.                       |
| `numArgs`              | Fixed count or `{ min, max? }` value range.                     |
| `valueDelimiter`       | Split each raw value by one character.                          |
| `valueTerminator`      | Stop collecting values at a token.                              |
| `allowHyphenValues`    | Accept values that begin with `-`.                              |
| `allowNegativeNumbers` | Accept negative numeric values while preserving option parsing. |

Options also accept `defaultMissing` and `requireEquals`. Positionals also
accept `trailingVarArg`. Flags accept `negated`. Counters use their occurrence
count as the output value. `colorFlag()` provides the paired color policy.

```ts
const port = option('port', parsers.integer, {
  short: 'p',
  long: 'port',
  aliases: ['listen-port'],
  required: true,
  describe: 'Port to listen on',
  valueName: 'PORT',
  env: 'PORT',
}); // number

const tag = option('tag', parsers.string, { repeatable: true });
// readonly string[], empty when absent

const colorMode = option('color', parsers.string, {
  numArgs: { min: 0, max: 1 },
}); // string | undefined

const pair = option('pair', parsers.string, { numArgs: 2 });
// readonly [string, string] | undefined

const points = option('point', parsers.integer, {
  numArgs: 2,
  repeatable: true,
}); // readonly number[]

const file = positional('file', parsers.string, { required: true });
const cache = flag('cache', { negated: true });
const verbosity = count('verbose', { short: 'v' });
```

Defaults belong to the argument, not its parser. A default must match the
parser output. Use an explicit `parsers.string` when a string option or
positional needs configuration.

Use `defaultValues` for repeatable arguments or arguments that collect multiple
values. The values must match the parser output and configured arity. `default`
continues to mean one parsed value, including when a custom parser returns an
array. `default` and `defaultValues` cannot be combined.

```ts
const serve = command('serve', {
  args: [
    option('mode', parsers.enum(['development', 'production']), {
      default: 'development',
    }),
    option('port', parsers.integer, { default: 3000 }),
    option('tags', parsers.string, {
      repeatable: true,
      defaultValues: ['local', 'debug'],
    }),
  ],
  defaultIf: [
    { source: 'mode', equals: 'production', target: 'port', value: 443 },
  ],
  argsOverrideSelf: true,
});
```

Conditional defaults use parsed values. Omit `equals` to match an argument
explicitly supplied through CLI, environment, or configuration. With `equals`,
the source may also come from a default; a collection matches if any item is
equal. The first matching rule for each target wins. Dependencies are resolved
before their targets, and cyclic rules are rejected when creating the command.
Precedence is CLI, environment, configuration, conditional default, then
unconditional default. Both forms of default report the source `'default'`.
For collection targets, the rule's `value` is the complete collection.
Defaults do not count as explicit occurrences for required arguments or
argument relations.

`argsOverrideSelf: true` makes the last CLI occurrence of a non-repeatable option
or flag replace its earlier value. A multi-value occurrence replaces the entire
earlier collection. Repeatable arguments still append and counters still
increment. Inherited global options use the setting of their declaring command.
The default setting continues to reject duplicate non-repeatable occurrences.
Paired `colorFlag()` switches retain their conflict behavior.

### Advanced value collection

```ts
const run = command('run', {
  args: [
    option('features', parsers.string, {
      repeatable: true,
      valueDelimiter: ',',
    }),
    option('define', parsers.string, {
      numArgs: { min: 1, max: 4 },
      valueTerminator: ';',
    }),
    option('config', parsers.string, { requireEquals: true }),
    option('color', parsers.string, { defaultMissing: 'auto' }),
    option('offset', parsers.integer, { allowNegativeNumbers: true }),
    option('pattern', parsers.string, { allowHyphenValues: true }),
    positional('command', parsers.string, { trailingVarArg: true }),
  ],
});
```

- `--features a,b --features c` returns `['a', 'b', 'c']`.
- `--config=file.json` is accepted. `--config file.json` is rejected.
- `--color` uses `auto`; `--color=always` uses `always`.
- A trailing positional captures tokens such as `--inspect` without `--`.

## Parsers

Built-in parsers include `string`, `integer`, `float`, `bigint`, `boolean`,
`url`, `date`, `duration`, `byteSize`, `keyValue`, `cron`, and `color`. Factory
parsers include:

```ts
parsers.enum(['dev', 'prod']);
parsers.regex(/^[a-z][a-z0-9-]*$/);
parsers.range(1, 10);
parsers.range(1, 65_535, { integer: true });
parsers.json(isMyConfig);
parsers.custom('PORT', parsePort);
```

Enum entries may include aliases, descriptions, and visibility settings:

```ts
const mode = parsers.enum([
  { value: 'development', aliases: ['dev'], describe: 'Local development' },
  { value: 'production', aliases: ['prod'], describe: 'Production deployment' },
  { value: 'legacy', hide: true },
], { ignoreCase: true });

mode.parse('PROD'); // 'production'
```

Aliases and case variants return the canonical value, preserving the inferred
literal union. Hidden entries remain accepted but are omitted from help, error
suggestions, and completion. Duplicate or ambiguous spellings are rejected.
`EnumValue` and `EnumParserOptions` describe these settings; `ValueParser.choices`
and `ValueParser.ignoreCase` expose their immutable metadata.

Compose parsers when conversion or an additional validation rule should be
reused. `map` transforms the typed value and keeps the source parser's label,
static raw completions, and completion hint unless completion options are
provided. `refine` keeps values that satisfy its predicate; a type-guard
predicate narrows the parser output type. Static completions rejected by the
source parser or predicate are removed when the refined parser is created:

```ts
const seconds = parsers.map(
  parsers.duration,
  (milliseconds) => milliseconds / 1_000,
);
const httpsUrl = parsers.refine(
  parsers.url,
  (value) => value.protocol === 'https:',
  'URL must use HTTPS',
);
const mode = parsers.refine(
  parsers.enum(['dev', 'prod', 'test']),
  (value): value is 'dev' | 'prod' => value !== 'test',
);
```

Pass `ValueParserOptions` as the final argument to either function to replace
static completions or completion hints. Refinement predicates run again when
input is parsed, so predicates should be deterministic when completion output
needs to stay aligned with accepted values.

A regex parser returns the original string when the pattern matches. Add `^`
and `$` when the complete argument must match.

A range includes both bounds and accepts fractional values by default. Set
`integer: true` to use the same base-10 safe integer rules as `parsers.integer`:
signed integer text is accepted, while decimals, exponent notation, hex, and
values outside JavaScript's safe integer range are rejected. The parser still
returns a `number`. Setting `integer: false` preserves the default behavior.

The unit parsers return integer base units. Byte sizes use decimal `KB` through
`TB`, or binary `KiB` through `TiB`. A key/value parser splits at the first `=`:

```ts
parsers.duration.parse('1.5s'); // 1500 milliseconds
parsers.byteSize.parse('4MiB'); // 4194304 bytes
parsers.keyValue.parse('MODE=safe'); // { key: 'MODE', value: 'safe' }
parsers.cron.parse('30 9 * * MON-FRI'); // original string
parsers.color.parse('oklch(65% 0.2 30)'); // original string
```

The cron parser accepts Bun's five-field syntax and predefined nicknames. It
rejects expressions with no possible execution time.

The color parser accepts CSS colors supported by `Bun.color`, including named,
hex, RGB, HSL, LAB, and OKLCH colors. It returns the original text so handlers
can select a Bun output format.

A custom parser can throw an `Error`. The library converts it to a structured
`CliError` with `ErrorKind.InvalidValue`.

## Relations and groups

Relation names are checked against the `args` tuple. Conditional expected
values are checked against the source parser type.

```ts
const release = command('release', {
  args: [
    flag('major'),
    flag('minor'),
    flag('dry-run'),
    flag('offline'),
    flag('quiet'),
    count('verbose'),
    option('format', parsers.enum(['text', 'json'])),
    option('schema'),
    option('token'),
  ],
  conflicts: [['major', 'minor']],
  requires: [['token', 'dry-run']],
  requiresIf: [['format', 'json', 'schema']],
  requiredIfAny: [{
    conditions: [['format', 'json'], ['dry-run', true]],
    target: 'schema',
  }],
  requiredIfAll: [{
    conditions: [['format', 'json'], ['offline', true]],
    target: 'token',
  }],
  requiredUnlessPresent: [{ alternatives: ['offline'], target: 'token' }],
  requiredUnlessAll: [{
    alternatives: ['offline', 'dry-run'],
    target: 'schema',
  }],
  overrides: [['quiet', 'verbose']],
  exclusive: ['offline'],
  groups: [{
    name: 'level',
    members: ['major', 'minor'],
    required: true,
    requires: ['format'],
    conflicts: ['quiet'],
  }],
});
```

Each conflict entry makes its members mutually exclusive. Each `exclusive`
argument conflicts with every other supplied argument. A group allows one
member by default. Set `multiple: true` to allow more than one. Group
`requires` and `conflicts` activate when any member is present.

`overrides` evaluates source presence from a snapshot of the arguments supplied
on the CLI before any target is cleared. Every override relation uses that same
snapshot, so a chain such as `a -> b` and `b -> c` clears both targets in either
declaration order. Environment, configuration, and default values do not make
an override source explicit.

## Global arguments and custom help

```ts
const verbose = count('verbose', { global: true, short: 'v' });
const profile = option('profile', parsers.string, { global: true });

const serveCommand = command('serve', {
  args: [option('port', parsers.integer, { required: true })],
  handler: ({ port }, context) => {
    const verbosity = context.global(verbose);
    const selectedProfile = context.global(profile);
    // port: number; verbosity: number
    // selectedProfile: string | undefined
  },
});

const cli = command('tool', {
  about: 'Manage services',
  author: 'Example team',
  beforeHelp: 'Run this command from a project directory.',
  afterHelp: 'See https://example.test/docs for more help.',
  args: [verbose, profile],
  subcommands: [serveCommand],
  subcommandRequired: true,
});
```

A global named argument is available before or after nested subcommands. It is
shown in nested help and completion. A handler receives local fields in its
first parameter. `context.global(globalArgument)` returns a registered global
value with its exact inferred type.

Use `overrideUsage`, `overrideHelp`, `disableHelpFlag`,
`disableVersionFlag`, and `disableHelpSubcommand` for custom control output.

## Shell completions

Generate scripts for Bash, Zsh, Fish, and PowerShell with a completion
subcommand:

```ts
import {
  command,
  completionShells,
  parsers,
  positional,
} from '@konstit/cli';

const completion = command('completion', {
  about: 'Generate a shell completion script',
  args: [
    positional('shell', parsers.enum(completionShells), { required: true }),
  ],
  handler: async ({ shell }) => {
    const { generateCompletion } = await import('@konstit/cli/completion');
    process.stdout.write(generateCompletion(cli, shell, {
      executable: 'tiny-git',
      dynamic: true,
    }));
  },
});

const cli = command('tiny-git', {
  subcommands: [completion],
  subcommandRequired: true,
});

process.exitCode = await cli.run();
```

The generated scripts include visible options, aliases, built-ins, nested
subcommands, and static parser values. Hidden arguments and commands are
omitted. Plain `cli.run()` detects and serves dynamic completion requests.

Use parser metadata for static values and path completion:

```ts
const region = parsers.custom('REGION', parseRegion, {
  completions: ['us-east-1', 'eu-west-1'],
});

const config = option('config', parsers.string, { valueHint: 'file' });
const output = positional('output', parsers.string, { valueHint: 'directory' });
```

Use the `complete` argument field when candidates depend on the command line:

```ts
const packageOption = option('package', parsers.string, {
  complete: async ({ current, commandPath, rawValues }) => {
    const workspace = rawValues.workspace?.at(-1);
    const packages = await findWorkspacePackages(workspace, current);
    return packages.map((name) => ({
      value: name,
      description: `Package in ${commandPath.join(' ')}`,
    }));
  },
});
```

Providers can return an array, a promise, or an async iterable. Scripts can
also be generated directly with `generateCompletion(cli, shell, options)`.

## Command metadata and documentation

Export an immutable, callback-free command tree with `describeCommand()`:

```ts
import {
  describeCommand,
  renderManPage,
  renderMarkdown,
} from '@konstit/cli';

const metadata = describeCommand(cli);
const markdown = renderMarkdown(cli, { title: 'Tiny Git reference' });
const man = renderManPage(cli, {
  title: 'tiny-git',
  section: '1',
  source: 'Tiny Git',
  manual: 'Tiny Git manual',
});

await Bun.write('tiny-git.md', markdown);
await Bun.write('tiny-git.1', man);
```

Handlers, parser `parse` functions, and dynamic completion callbacks are
omitted. Metadata arrays and nested records are frozen. Hidden arguments,
aliases, and subcommands are omitted by default; pass `{ includeHidden: true }`
to `describeCommand()`, `renderMarkdown()`, or `renderManPage()` to include
them.

Nested command metadata keeps local arguments in `arguments` and ancestor
globals in `inheritedArguments`. The root command has an empty
`inheritedArguments` array. Documentation renderers include each inherited
global once in the nested command's options.

Defaults are exposed only when they can be represented by `MetadataValue`.
Strings, booleans, `null`, finite numbers, plain objects, and arrays are
copied recursively; `bigint`, `Date`, `URL`, and `RegExp` values use stable
string forms. Functions, symbols, `undefined`, non-finite numbers, class
instances, accessor properties, sparse arrays, cycles, and other unsupported
values omit `defaultValue`. Composite values are copied all-or-nothing so an
unsupported element cannot shift array positions or partially rewrite a
default. `hasDefaultValue` still reports that the argument was configured with
a default. The same safe-value rules apply to relation expectations and
`defaultMissingValue`.

Metadata also includes `defaultIf`, `argsOverrideSelf`, collection defaults,
and enum `choices` with aliases and descriptions. Hidden enum choices follow
the same `includeHidden` setting as hidden arguments.

## Deprecation warnings

Set `deprecated` to a replacement message on a command or argument. Use
`deprecatedAliases` to warn only for specific aliases already declared in
`aliases` or `visibleAliases`:

```ts
import {
  command,
  getWarnings,
  option,
  parsers,
} from '@konstit/cli';

const cli = command('build', {
  args: [
    option('output', parsers.string, {
      aliases: ['out'],
      deprecatedAliases: { out: 'Use --output instead.' },
    }),
  ],
  handler: ({ output }) => console.log(output),
});

const result = cli.tryParse(['--out', 'dist']);
console.log(getWarnings(result));
await cli.runParsed(result);
```

Parsing collects immutable structured warnings without printing them.
`run()` and `runParsed()` write warnings to stderr before execution or a parse
failure. Set `onWarning` to receive each warning yourself; a no-op callback
suppresses output. Help, version, and completion output do not emit warnings.
Warnings are collected once per deprecated spelling and command path.
Argument warnings require explicit CLI input; environment values, configuration,
and defaults do not warn. Alias warnings apply to exact alias spellings.

## Supported behavior

- Long and short options, attached values, clusters, and counters
- Repeatable, fixed-count, ranged, delimited, and terminated values
- Equals-only options and optional option values
- Hyphen values, negative numbers, trailing positionals, and `--`
- Nested subcommands, aliases, inferred prefixes, and generated help
- Global options shared by nested subcommands
- Environment fallbacks overridden by explicit CLI values
- Requirements, conflicts, exclusivity, overrides, and argument groups
- Automatic help, version, usage, and close-name suggestions
- Static and dynamic completion for Bash, Zsh, Fish, and PowerShell

## Development

```sh
bun install
bun run check
bun run lint
bun run format:check
bun run examples/gitlike.ts --help
```

The Bun configuration requires 100% line and function coverage.
