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
    const verbose = count('verbose', {
      global: true,
      short: 'v',
      describe: 'Verbosity',
    });
    const profile = option('profile', parsers.string, {
      global: true,
      default: 'default',
    });
    let received: unknown;
    let receivedPath: readonly string[] = [];
    const serve = command('serve', {
      args: [option('port', parsers.integer, { required: true })],
      handler: (args, context) => {
        type _ArgsAreExact = Expect<
          Equal<typeof args, {
            readonly port: number;
          }>
        >;
        const typedVerbose: number = context.global(verbose);
        const typedProfile: string = context.global(profile);
        received = { ...args, verbose: typedVerbose, profile: typedProfile };
        receivedPath = context.commandPath;
      },
    });
    const cli = command('tool', {
      args: [verbose, profile],
      subcommands: [serve],
    });

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
    const orphan = option('profile', parsers.string, { global: true });
    const cli = command('tool', {
      subcommands: [command('serve', {
        handler: (_args, context) => {
          context.global(orphan);
        },
      })],
    });
    // oxlint-disable-next-line typescript/await-thenable -- Bun async matchers must be awaited.
    await expect(cli.run(['serve'])).rejects.toThrow(
      'Global argument \'profile\' is not registered',
    );
  });
});

function _checkHandlerGlobalArgumentTypes() {
  const local = option('local');
  const explicitlyLocal = option('explicitlyLocal', parsers.string, {
    global: false,
  });
  command('bad', {
    handler: (_args, context) => {
      // @ts-expect-error context.global only accepts arguments branded as global
      context.global(local);
      // @ts-expect-error global false keeps an argument local
      context.global(explicitlyLocal);
    },
  });
}
