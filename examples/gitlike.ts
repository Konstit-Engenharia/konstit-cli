import {
  colorFlag,
  command,
  completionShells,
  count,
  flag,
  option,
  parsers,
  positional,
} from '../src';

const verbose = count('verbose', {
  global: true,
  short: 'v',
  describe: 'Increase verbosity',
});

const color = colorFlag('color');

const clone = command('clone', {
  about: 'Clone a repository',
  visibleAliases: ['copy'],
  aliases: ['cp'],
  args: [
    positional('repository', parsers.string, {
      required: true,
      describe: 'Repository URL',
    }),
    positional('directory', parsers.path({ kind: 'directory', mustExist: true }), {
      valueHint: 'directory',
      describe: 'Target directory',
    }),
    flag('bare', {
      describe: 'Create a bare repository',
    }),
    option('config', parsers.string, {
      short: 'c',
      repeatable: true,
      valueName: 'KEY=VALUE',
      describe: 'Set configuration before fetching',
    }),
  ],
  handler: async ({
    repository,
    directory,
    bare,
    config,
  }, context) => {
    const { output, style } = context;
    const verbosity = context.global(verbose);
    const colorEnabled = context.global(color);
    const repositoryUrl = URL.parse(repository);
    const repositoryText = style(repository, { color: 'cyan' });
    const repositoryLabel = repositoryUrl === null
      ? repositoryText
      : style.link(repositoryUrl, { label: repositoryText });
    output.log(`clone ${repositoryLabel}`);
    if (directory !== undefined) {
      output.log(`directory: ${await style.path(directory)}`);
    }
    if (bare) {
      output.log('bare repository');
    }
    for (const setting of config) {
      output.log(`config: ${setting}`);
    }
    if (verbosity > 0) {
      output.log(`verbosity: ${verbosity}; color: ${colorEnabled}`);
    }
  },
});

const commit = command('commit', {
  about: 'Record changes',
  args: [
    option('message', parsers.string, {
      short: 'm',
      required: true,
      valueName: 'MESSAGE',
    }),
    flag('amend', { describe: 'Replace the last commit' }),
  ],
  handler: ({ message, amend }, { output, style }) => {
    output.log(`commit: ${style(message, { color: 'green' })}`);
    if (amend) {
      output.log('amend previous commit');
    }
  },
});

const completion = command('completion', {
  about: 'Generate a shell completion script',
  args: [positional('shell', parsers.enum(completionShells), { required: true })],
  handler: async ({ shell }) => {
    const { generateCompletion } = await import('../src/completion');
    process.stdout.write(generateCompletion(cli, shell, {
      executable: 'tiny-git',
      dynamic: true,
    }));
  },
});

const cli = command('tiny-git', {
  version: '0.1.0',
  about: 'A type-safe git-like example',
  args: [verbose, color],
  subcommands: [clone, commit, completion],
  inferSubcommands: true,
  subcommandRequired: true,
  defaultToHelp: true,
});

process.exitCode = await cli.run({
  color: true,
  lsColors: Bun.env.LS_COLORS ?? 'di=01;34',
});
