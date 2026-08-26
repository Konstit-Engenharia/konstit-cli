import {
  describe,
  expect,
  test,
} from 'bun:test';
import {
  command,
  count,
  option,
  parsers,
} from '../src';

type Equal<Left, Right> = (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2) ? true
  : false;
type Expect<Value extends true> = Value;

describe('typed handler globals', () => {
  test('provides inherited globals through every handler context', async () => {
    const verbose = count('verbose').short('v').global().describe('Verbosity');
    const profile = option('profile').global().default('default');
    let received: unknown;
    let receivedPath: readonly string[] = [];
    const serve = command('serve')
      .arg(option('port', parsers.integer).required())
      .handler((args, context) => {
        type _ArgsAreExact = Expect<
          Equal<typeof args, {
            readonly port: number;
          }>
        >;
        const typedVerbose: number = context.global(verbose);
        const typedProfile: string = context.global(profile);
        received = { ...args, verbose: typedVerbose, profile: typedProfile };
        receivedPath = context.commandPath;
      });
    const cli = command('tool')
      .arg(verbose)
      .arg(profile)
      .subcommand(serve);

    expect(
      await cli.run([
        'serve',
        '--port',
        '8080',
        '-vv',
        '--profile',
        'dev',
      ]),
    ).toBe(0);
    expect(received).toEqual({ port: 8080, verbose: 2, profile: 'dev' });
    expect(receivedPath).toEqual(['tool', 'serve']);
  });

  test('rejects a global that is not registered in the selected path', async () => {
    const orphan = option('profile').global();
    const cli = command('tool').subcommand(
      command('serve').handler((_args, context) => {
        context.global(orphan);
      }),
    );
    await expect(cli.run(['serve'])).rejects.toThrow(
      'Global argument \'profile\' is not registered',
    );
  });
});

if (false) {
  const local = option('local');
  command('bad').handler((_args, context) => {
    // @ts-expect-error context.global only accepts arguments branded as global
    context.global(local);
  });
}
