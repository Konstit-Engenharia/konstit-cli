import {
  command,
  completionShells,
  count,
  flag,
  option,
  parsers,
  positional,
} from '../src';

const verbose = count('verbose').short('v').global().describe('Increase verbosity');
const color = option('color', parsers.enum(['auto', 'always', 'never']))
  .global()
  .default('auto');

const clone = command('clone')
  .about('Clone a repository')
  .visibleAlias('copy')
  .alias('cp')
  .arg(positional('repository').required().describe('Repository URL'))
  .arg(positional('directory').valueHint('directory').describe('Target directory'))
  .arg(flag('bare').describe('Create a bare repository'))
  .handler(({
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
  });

const commit = command('commit')
  .about('Record changes')
  .arg(option('message').short('m').required().valueName('MESSAGE'))
  .arg(flag('amend').describe('Replace the last commit'))
  .handler(({ message, amend }) => {
    console.log(`commit: ${message}`);
    if (amend) {
      console.log('amend previous commit');
    }
  });

const completion = command('completion')
  .about('Generate a shell completion script')
  .arg(positional('shell', parsers.enum(completionShells)).required())
  .handler(async ({ shell }) => {
    const { generateCompletion } = await import('../src/completion');
    process.stdout.write(generateCompletion(cli, shell, {
      executable: 'tiny-git',
      dynamic: true,
    }));
  });

const cli = command('tiny-git')
  .version('0.1.0')
  .about('A type-safe git-like example')
  .arg(verbose)
  .arg(color)
  .subcommand(clone)
  .subcommand(commit)
  .subcommand(completion)
  .inferSubcommands()
  .requireSubcommand();

process.exitCode = await cli.run();
