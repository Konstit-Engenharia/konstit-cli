import {
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

const color = option(
  'color',
  parsers.enum(['auto', 'always', 'never']),
  {
    global: true,
    default: 'auto',
  },
);

const clone = command('clone', {
  about: 'Clone a repository',
  visibleAliases: ['copy'],
  aliases: ['cp'],
  args: [
    positional('repository', parsers.string, {
      required: true,
      describe: 'Repository URL',
    }),
    positional('directory', parsers.string, {
      valueHint: 'directory',
      describe: 'Target directory',
    }),
    flag('bare', {
      describe: 'Create a bare repository',
    }),
  ],
  handler: ({
    repository,
    directory,
    bare,
  }, context) => {
    const verbosity = context.global(verbose);
    const colorMode = context.global(color);
    console.log(`clone ${repository}`);
    if (directory !== undefined) {
      console.log(`directory: ${directory}`);
    }
    if (bare) {
      console.log('bare repository');
    }
    if (verbosity > 0) {
      console.log(`verbosity: ${verbosity}; color: ${colorMode}`);
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
  handler: ({ message, amend }) => {
    console.log(`commit: ${message}`);
    if (amend) {
      console.log('amend previous commit');
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
  defaultToHelp: true,
});

process.exitCode = await cli.run();
