export const completionShells = Object.freeze(
  [
    'bash',
    'zsh',
    'fish',
    'powershell',
  ] as const,
);

export type CompletionShell = (typeof completionShells)[number];

/** Narrows an untrusted string to a supported completion shell. */
export function isCompletionShell(value: string): value is CompletionShell {
  return (completionShells as readonly string[]).includes(value);
}
