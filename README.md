# @konstit/cli

A declarative, type-safe command-line parser for Bun.

The command and argument factories infer the successful parse type from one
static schema. This is an independent TypeScript implementation inspired by
clap. It is not a source port.

## Type safety

- Value parsers determine the returned TypeScript type.
- `required: true` removes `undefined` when the configured arity guarantees a value.
- `default` keeps a value present.
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
    option('port', parsers.range(1, 65_535), {
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

| Field                   | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `version`               | Text printed by `-V` and `--version`.                       |
| `about`                 | Short help and completion description.                      |
| `longAbout`             | Extended help description.                                  |
| `author`                | Author line in help.                                        |
| `beforeHelp`            | Text before generated help.                                 |
| `afterHelp`             | Text after generated help.                                  |
| `overrideUsage`         | Exact replacement for generated usage.                      |
| `overrideHelp`          | Exact replacement for generated help.                       |
| `aliases`               | Parseable aliases hidden from help and completion.          |
| `visibleAliases`        | Parseable aliases shown in help and completion.             |
| `args`                  | Argument tuple in parse order.                              |
| `subcommands`           | Subcommand tuple.                                           |
| `inferSubcommands`      | Accept an unambiguous name or alias prefix.                 |
| `subcommandRequired`    | Require a subcommand and make its result non-optional.      |
| `defaultToHelp`         | Display help when no argument or subcommand is supplied.    |
| `disableHelpSubcommand` | Disable the generated `help` subcommand.                    |
| `disableHelpFlag`       | Disable generated `-h` and `--help`.                        |
| `disableVersionFlag`    | Disable generated `-V` and `--version`.                     |
| `hide`                  | Hide this command from parent help and completion.          |
| `requires`              | Unconditional argument dependencies.                        |
| `requiresIf`            | Single-value conditional dependencies.                      |
| `requiredIfAny`         | Dependencies activated by any matching condition.           |
| `requiredIfAll`         | Dependencies activated by all matching conditions.          |
| `requiredUnlessPresent` | Require a target unless one alternative is present.         |
| `requiredUnlessAll`     | Require a target unless all alternatives are present.       |
| `overrides`             | Clear a target when a source is explicitly supplied.        |
| `conflicts`             | Mutually conflicting argument sets.                         |
| `exclusive`             | Arguments that conflict with every other supplied argument. |
| `groups`                | Named argument groups and their relations.                  |
| `handler`               | Synchronous or asynchronous command callback.               |

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

Each command path that can be selected by `run()` needs a handler. Set
`subcommandRequired: true` when only subcommands are runnable.

Use `renderHelp()` and `renderUsage()` when output must be generated without
parsing arguments.

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

All argument kinds accept `describe`, `env`, and `hide`. For value arguments
and counters, `env` parses the variable content. For flags, `env` tests only
whether the variable exists; an empty value counts as present. Named arguments
also accept `global`, `short`, `long`, and `aliases`.

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
parsers.json(isMyConfig);
parsers.custom('PORT', parsePort);
```

A regex parser returns the original string when the pattern matches. Add `^`
and `$` when the complete argument must match.

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
bun run coverage
bun run examples/gitlike.ts --help
```

The Bun configuration requires 100% line and function coverage.
