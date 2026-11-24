import {
  colorFlag,
  command,
  completionShells,
  flag,
  option,
  parsers,
  positional,
} from '../src';

const color = colorFlag('color');

const clone = command('clone', {
  about: 'Clone a repository',
  examples: [
    { args: { repository: 'https://github.com/oven-sh/bun', directory: '.' }, description: '' },
    { args: { repository: 'https://github.com/oven-sh/bun', directory: '.', bare: true }, description: '' },
  ],
  args: [
    positional('repository', parsers.refine(parsers.string, (v) => URL.canParse(v), 'invalid URL'), {
      required: true,
      describe: 'Repository URL',
    }),
    positional('directory', parsers.path({ kind: 'directory', mustExist: true }), {
      required: true,
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
  handler: ({
    repository,
    directory,
    bare,
    config,
  }, context) => {
    const { output, style } = context;
    const repositoryText = style(repository, { color: 'cyan' });
    const repositoryLabel = style.link(repository, { label: repositoryText });
    output.log(`clone ${repositoryLabel}`);
    output.log(`directory: ${style.path(directory)}`);
    if (bare) {
      output.log('bare repository');
    }
    for (const setting of config) {
      output.log(`config: ${setting}`);
    }
  },
});

const commit = command('commit', {
  about: 'Record changes',
  args: [
    option('message', parsers.string, {
      short: 'm',
      required: true,
    }),
    flag('amend', { describe: 'Replace the last commit' }),
  ],
  handler: ({ message, amend }, { output, style }) => {
    style('', {});
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
  about: 'A type-safe git-like example.',
  args: [color],
  subcommands: [clone, commit, completion],
  inferSubcommands: true,
  subcommandRequired: true,
  defaultToHelp: true,
  disableHelpSubcommand: true,
  hideStandardFlagsInSubcommandHelp: true,
});

process.exitCode = await cli.run();
