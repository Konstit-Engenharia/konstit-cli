import {
  expect,
  test,
} from 'bun:test';
import {
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  command,
  option,
  parsers,
  positional,
} from '../src';
import { generateCompletion } from '../src/completion';

const bash = Bun.which('bash');
const supportsTerminal = process.platform !== 'win32' && bash !== null;

test.skipIf(!supportsTerminal)('Bash completes an option value in a real terminal', async () => {
  if (bash === null) {
    return;
  }

  const cli = command('demo', {
    args: [
      option('mode', parsers.enum(['dev', 'prod'])),
      positional('literal', parsers.enum(['--literal']), {
        allowHyphenValues: true,
      }),
    ],
  });
  const directory = await mkdtemp(join(tmpdir(), 'bun-clap-terminal-'));
  const rcFile = join(directory, 'bashrc');
  const prompt = '__BUN_CLAP_PROMPT__ ';
  await Bun.write(
    rcFile,
    `${generateCompletion(cli, 'bash')}\nPS1='${prompt}'\nPS2=''\n`,
  );

  const decoder = new TextDecoder();
  let output = '';
  let waiter: Waiter | undefined;
  const terminal = new Bun.Terminal({
    cols: 80,
    rows: 24,
    data: (_terminal, data) => {
      output += decoder.decode(data, { stream: true });
      if (waiter !== undefined && output.includes(waiter.text)) {
        clearTimeout(waiter.timeout);
        waiter.resolve();
        waiter = undefined;
      }
    },
  });
  const subprocess = Bun.spawn(
    [bash, '--noprofile', '--rcfile', rcFile, '-i'],
    {
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal,
    },
  );

  const waitFor = (text: string): Promise<void> => {
    if (output.includes(text)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiter = undefined;
        reject(
          new Error(
            `Timed out waiting for terminal output: ${text}\n${JSON.stringify(output)}`,
          ),
        );
      }, 3_000);
      waiter = { text, resolve, timeout };
    });
  };

  try {
    await waitFor(prompt);
    output = '';

    terminal.write('demo --mode d\t');
    await waitFor('demo --mode dev ');

    expect(output).toContain('demo --mode dev ');

    output = '';
    terminal.write('\x15demo -- --l\t');
    await waitFor('demo -- --literal ');

    expect(output).toContain('demo -- --literal ');
  } finally {
    terminal.close();
    await subprocess.exited;
    await rm(directory, { recursive: true });
  }
}, 10_000);

interface Waiter {
  readonly text: string;
  readonly resolve: () => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}
