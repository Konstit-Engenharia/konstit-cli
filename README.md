# @konstit/cli

A clap-inspired command-line parser for Bun. Its immutable builders carry the
command schema through TypeScript, so successful parse values have the exact
inferred type.

This is an independent TypeScript implementation. It uses clap's builder UX as
a reference; it is not a source port and does not try to match every clap feature.

## What is type-safe

- Value parsers determine the returned TypeScript type.
- `.required()` removes `undefined`.
- `.default()` keeps a value present.
- `.repeatable()` returns `readonly Value[]`.
- `.numArgs(2)` returns an exact readonly tuple.
- `.numArgs({ min: 0, max: 1 })` keeps the value optional after `.required()`.
- Ranged arity and repeated arity return `readonly Value[]`.
- Flags and counters always return `boolean` and `number`.
- Subcommands return a discriminated union.
- Argument names in groups, conflicts, and requirements are checked.
- Conditional values in `.requiresIf()` are checked against the source parser type.
- Advanced conditional relations correlate every source name with its value type.
- Handler contexts return only the exact type of each declared global argument.
- Duplicate argument and subcommand names fail during type checking.
- Short names with more than one character fail during type checking.
- Completion shells and value hints are closed string unions.

## Install

Requires Bun 1.4 or newer.

```sh
bun add @konstit/cli
```

To use a local checkout before the package is published, pass the checkout's
absolute path from the project where you install it:

```sh
bun add /absolute/path/to/konstit-cli
```

## Quick start

```ts
import {
  command,
  count,
  flag,
  option,
  parsers,
  positional,
  type Infer,
} from '@konstit/cli';

const serve = command('serve')
  .about('Serve static files')
  .version('1.0.0')
  .arg(option('port', parsers.range(1, 65_535)).short('p').default(3000))
  .arg(option('host').default('127.0.0.1'))
  .arg(flag('open').short('o'))
  .arg(count('verbose').short('v'))
  .arg(positional('root').required())
  .handler(async ({ port, host, open, verbose, root }) => {
    // port: number; host: string; open: boolean
    // verbose: number; root: string
    console.log(`Serving ${root} on ${host}:${port}`);
  });

type Args = Infer<typeof serve>;
// {
//   readonly port: number;
//   readonly host: string;
//   readonly open: boolean;
//   readonly verbose: number;
//   readonly root: string;
// }

const exitCode = await serve.run();

process.exitCode = exitCode;
```

`.handler()` receives the exact inferred argument object, so destructuring keeps
every field type. It is a terminal schema step: add all arguments, subcommands,
and relations before the handler. The returned command supports parsing,
rendering, and running, but no more schema changes.

`parse(argv)` always parses the explicit array. It returns either a value or a
successful display request for help or version. It throws `CliError` only for a
user-facing parse failure:

```ts
const outcome = serve.parse(['--port', '8080', '.']);

if (outcome.type === 'value') {
  console.log(outcome.value.port); // number
} else {
  process.stdout.write(outcome.output); // help or version
}
```

`tryParse(argv)` adds `{ ok: false, type: "error", error }` to that result union
instead of throwing `CliError`. Unexpected programming errors still throw.
`run()` is the only API that reads `Bun.argv.slice(2)`. It prints displays and
parse failures, invokes the deepest handler, and returns an exit code. Pass an
explicit array to `run(argv)` when needed.

## Subcommands

```ts
const cli = command('repo')
  .subcommand(
    command('clone')
      .visibleAlias('copy')
      .alias('cp')
      .arg(positional('url').required())
      .arg(flag('bare'))
      .handler(({ url, bare }) => {
        // url: string; bare: boolean
        console.log(`clone ${url}${bare ? ' --bare' : ''}`);
      }),
  )
  .subcommand(
    command('commit')
      .arg(option('message').short('m').required())
      .handler(({ message }) => {
        // message: string
        console.log(`commit: ${message}`);
      }),
  )
  .inferSubcommands()
  .requireSubcommand();

process.exitCode = await cli.run();
```

Without `.requireSubcommand()`, the `subcommand` field also includes `undefined`.
Visible aliases appear in help and completion output. Hidden aliases only affect
parsing. With `.inferSubcommands()`, an unambiguous prefix such as `clo` selects
`clone`. `repo help clone` renders nested help. `.run()` invokes the handler on
the deepest matched subcommand. That handler receives its command's local fields
and a context for registered global values.

## Shell completions

Generate scripts for Bash, Zsh, Fish, and PowerShell with a handled completion
subcommand:

```ts
import {
  command,
  completionShells,
  parsers,
  positional,
} from '@konstit/cli';

const completion = command('completion')
  .about('Generate a shell completion script')
  .arg(positional('shell', parsers.enum(completionShells)).required())
  .handler(async ({ shell }) => {
    const { generateCompletion } = await import('@konstit/cli/completion');
    process.stdout.write(generateCompletion(cli, shell, {
      executable: 'tiny-git',
      dynamic: true,
    }));
  });

const cli = command('tiny-git')
  // Add the application's other arguments and subcommands here.
  .subcommand(completion)
  .requireSubcommand();

process.exitCode = await cli.run();
```

The handler's dynamic import keeps the generator out of the normal command path.
For a dynamic script, plain `cli.run()` detects and serves completion requests.
The application does not need an environment check or a separate startup path.

The generated scripts include visible options, aliases, help, version, nested
subcommands, and static parser values. Hidden arguments and commands are omitted.

Enum and Boolean parser values are completed automatically:

```ts
option('mode', parsers.enum(['dev', 'prod']));
option('enabled', parsers.boolean);
```

Add custom static values or path completion metadata:

```ts
const region = parsers.custom('REGION', parseRegion, {
  completions: ['us-east-1', 'eu-west-1'],
});

option('region', region);
option('config').valueHint('file');
positional('output').valueHint('directory');
```

Use `.complete()` when candidates depend on the current command line. Providers
can return an array, a promise, or an async iterable:

```ts
const packageOption = option('package').complete(async ({
  current,
  commandPath,
  rawValues,
}) => {
  const workspace = rawValues.workspace?.at(-1);
  const packages = await findWorkspacePackages(workspace, current);
  return packages.map((name) => ({
    value: name,
    description: `Package in ${commandPath.join(' ')}`,
  }));
});
```

You can also generate a script directly:

```ts
import { generateCompletion } from '@konstit/cli/completion';

await Bun.write(
  './tiny-git.bash',
  generateCompletion(cli, 'bash', { executable: 'tiny-git' }),
);
```

Install or load each generated script as follows.

### Bash

```sh
tiny-git completion bash > ~/.tiny-git-completion.bash
source ~/.tiny-git-completion.bash
```

Add the `source` command to `.bashrc` for persistent loading.

### Zsh

```sh
mkdir -p ~/.zfunc
tiny-git completion zsh > ~/.zfunc/_tiny-git
```

Configure Zsh to load the file:

```zsh
fpath=(~/.zfunc $fpath)
autoload -Uz compinit && compinit
```

### Fish

```fish
mkdir -p ~/.config/fish/completions
tiny-git completion fish > ~/.config/fish/completions/tiny-git.fish
```

### PowerShell

```powershell
tiny-git completion powershell > "$HOME/.tiny-git-completion.ps1"
. "$HOME/.tiny-git-completion.ps1"
```

Add the dot-source command to `$PROFILE` for persistent loading.

## Arguments

```ts
option('port', parsers.integer) // number | undefined
  .short('p')
  .long('port')
  .alias('listen-port')
  .required() // number
  .describe('Port to listen on')
  .valueName('PORT')
  .env('PORT');

option('tag').repeatable(); // readonly string[], empty when absent
option('color').numArgs({ min: 0, max: 1 }); // string | undefined
option('pair').numArgs(2); // readonly [string, string] | undefined
option('level', parsers.integer)
  .numArgs({ min: 1, max: 3 }); // readonly number[] | undefined
option('point', parsers.integer)
  .numArgs(2)
  .repeatable(); // readonly number[]
positional('file').required(); // string
flag('force'); // boolean, false when absent
flag('cache').negated(); // boolean, true when absent and false when present
count('verbose').short('v'); // number, supports -vvv
```

Use `.repeatable()` to collect option values, `count()` for occurrences, and
`.negated()` for a switch that disables an enabled-by-default value. Help and
version behavior comes from the command.

Built-in parsers include `string`, `integer`, `float`, `bigint`, `boolean`,
`url`, and `date`. Factory parsers include:

```ts
parsers.enum(['dev', 'prod']); // "dev" | "prod"
parsers.range(1, 10); // number
parsers.json(isMyConfig); // MyConfig, inferred from the type guard
parsers.custom('PORT', parsePort); // inferred from parsePort
```

A custom parser can throw an `Error`. `@konstit/cli` converts it to a structured
`CliError` with `ErrorKind.InvalidValue`.

### Value collection

```ts
const cli = command('run')
  .arg(option('features').repeatable().valueDelimiter(','))
  .arg(option('define').numArgs({ min: 1, max: 4 }).valueTerminator(';'))
  .arg(option('config').requireEquals())
  .arg(option('color').defaultMissing('auto'))
  .arg(option('offset', parsers.integer).allowNegativeNumbers())
  .arg(option('pattern').allowHyphenValues())
  .arg(positional('command').trailingVarArg());
```

- `--features a,b --features c` returns `["a", "b", "c"]`.
- `--config=file.json` is accepted. `--config file.json` is rejected.
- `--color` uses `"auto"`; `--color=always` uses `"always"`.
- A trailing positional captures tokens such as `--inspect` without `--`.

## Relations

Relation names use the command's accumulated argument-name union:

```ts
const release = command('release')
  .arg(flag('major'))
  .arg(flag('minor'))
  .arg(flag('dry-run'))
  .arg(flag('offline'))
  .arg(flag('quiet'))
  .arg(count('verbose'))
  .arg(option('format', parsers.enum(['text', 'json'])))
  .arg(option('schema'))
  .arg(option('token'))
  .conflicts('major', 'minor')
  .requires('token', 'dry-run')
  .requiresIf('format', 'json', 'schema')
  .requiredIfAny([['format', 'json'], ['dry-run', true]], 'schema')
  .requiredIfAll([['format', 'json'], ['offline', false]], 'token')
  .requiredUnlessPresent(['offline'], 'token')
  .requiredUnlessAll(['offline', 'dry-run'], 'schema')
  .overrides('quiet', 'verbose')
  .exclusive('offline')
  .group('level', ['major', 'minor'], { required: true })
  .groupRequires('level', 'format')
  .groupConflicts('level', 'quiet');
```

Relations put their source or source list before the target. `requiredIfAny`
matches one condition. `requiredIfAll` matches every condition.
`requiredUnlessAll` requires its target until all alternatives are present.
`exclusive` conflicts with every other supplied argument. Groups are mutually
exclusive unless `{ multiple: true }` is set. Group names are checked after
`.group()`.

## Global arguments and custom help

```ts
const verbose = count('verbose').short('v').global();
const profile = option('profile').global();

const cli = command('tool')
  .about('Manage services')
  .author('Example team')
  .beforeHelp('Run this command from a project directory.')
  .afterHelp('See https://example.test/docs for more help.')
  .arg(verbose)
  .arg(profile)
  .subcommand(
    command('serve')
      .arg(option('port', parsers.integer).required())
      .handler(({ port }, context) => {
        const verbosity = context.global(verbose);
        const selectedProfile = context.global(profile);
        // port: number; verbosity: number
        // selectedProfile: string | undefined
      }),
  );
```

Global arguments work before or after nested subcommands and appear in nested
help and completion output. A handler receives local fields in its first
parameter. Its context returns a registered global value through
`context.global(globalArgument)`, with the exact inferred type. Help can also
use `.overrideUsage()`,
`.overrideHelp()`, `.disableHelpFlag()`, `.disableVersionFlag()`, and
`.disableHelpSubcommand()`.

## Supported parsing behavior

- Long options: `--port 3000` and `--port=3000`
- Short values: `-p 3000` and `-p3000`
- Short flag clusters and counters: `-qvvv`
- Repeatable options and trailing positionals
- Fixed and ranged value counts, delimiters, and value terminators
- Equals-only options, optional option values, hyphen values, and negative numbers
- `--` to stop option parsing
- Nested subcommands, aliases, inferred prefixes, and the `help` subcommand
- Global options shared by nested subcommands
- Environment fallbacks, overridden by explicit CLI values
- Conditional sets, required-unless rules, exclusivity, group relations, and overrides
- Automatic help, version, usage, and close-name suggestions
- Static and async completion generation for Bash, Zsh, Fish, and PowerShell

## Development

```sh
bun install
bun run check
bun run coverage
bun run examples/gitlike.ts --help
```

The Bun configuration requires 100% line and function coverage.
