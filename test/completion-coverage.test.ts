import {
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import {
  command,
  option,
  parsers,
  positional,
} from '../src';
import {
  dynamicCompletionEnvironment,
  generateCompletion,
} from '../src/completion';

describe('completion edge behavior', () => {
  test('uses the default output writer through Command.run', async () => {
    const cli = command('packages').arg(
      option('package').complete(() => ['react', 'redis']),
    );
    let output = '';
    const write = spyOn(process.stdout, 'write').mockImplementation(
      ((chunk: string | Uint8Array) => {
        output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
        return true;
      }) as typeof process.stdout.write,
    );
    try {
      expect(
        await withDynamicCompletion(() =>
          cli.run({
            argv: ['--package', 're'],
          })
        ),
      ).toBe(0);
    } finally {
      write.mockRestore();
    }
    expect(output).toBe('react\nredis\n');
  });

  test('writes nothing when a request has no candidates', async () => {
    let output = 'untouched';
    expect(
      await withDynamicCompletion(() =>
        command('empty').run({
          argv: ['unknown'],
          stdout: (value) => {
            output = value;
          },
        })
      ),
    ).toBe(0);
    expect(output).toBe('untouched');
  });

  test('covers shell quoting, path registration, aliases, and positional values', () => {
    const cli = command('edge')
      .arg(
        option('mode', parsers.enum(['dev', 'prod']))
          .short('m')
          .alias('build-mode')
          .describe('Build mode'),
      )
      .arg(option('directory').valueHint('directory'))
      .arg(positional('target', parsers.enum(['web', 'server'])));

    const bash = generateCompletion(cli, 'bash', { executable: '1\'tool' });
    expect(bash).toContain('_bun_clap__1_tool');
    expect(bash).toContain('\'1\'"\'"\'tool\'');

    const fish = generateCompletion(cli, 'fish', { executable: './edge\\tool' });
    expect(fish).toContain('complete -p \'./edge\\\\tool\'');
    expect(fish).toContain('-l \'build-mode\'');
    expect(fish).toContain('web');
    expect(fish).toContain('server');

    const powerShell = generateCompletion(cli, 'powershell', {
      executable: 'edge\'tool',
    });
    expect(powerShell).toContain('\'edge\'\'tool\'');

    const files = command('files').arg(positional('file'));
    expect(generateCompletion(files, 'bash')).toContain('_allows_files');
    expect(generateCompletion(files, 'zsh')).toContain('_allows_files');
    expect(generateCompletion(files, 'powershell')).toContain('$allowsFiles');
  });

  test('rejects an unsupported shell in dynamic mode', () => {
    expect(() =>
      generateCompletion(
        command('tool'),
        'nu' as 'bash',
        { dynamic: true },
      )
    ).toThrow('Unsupported completion shell');
  });
});

async function withDynamicCompletion<Result>(
  callback: () => Promise<Result>,
): Promise<Result> {
  const previous = Bun.env[dynamicCompletionEnvironment];
  Bun.env[dynamicCompletionEnvironment] = '1';
  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete Bun.env[dynamicCompletionEnvironment];
    } else {
      Bun.env[dynamicCompletionEnvironment] = previous;
    }
  }
}
