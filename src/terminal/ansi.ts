/* oxlint-disable no-control-regex -- ANSI SGR sequences contain control characters. */
const reset = '\x1b[0m';

/** Wraps each line separately and restores the enclosing style after nested resets. */
export function wrapAnsi(text: string, opening: string): string {
  if (opening === '' || text === '') {
    return text;
  }
  return text.split(/(\r\n|\r|\n)/).map((part, index) => {
    if (index % 2 === 1 || part === '') {
      return part;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI reset sequences delimit nested styles.
    return opening + part.replace(/\x1b\[(?:0+)?m/g, reset + opening) + reset;
  }).join('');
}

const attributes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 21, 22, 23, 24, 25, 27, 28, 29, 39, 49, 53, 55]);

/** Accepts SGR attributes and palette/RGB colors without terminal-control payloads. */
export function isSgrSequence(sequence: string): boolean {
  if (!/^\d*(?:;\d*)*$/.test(sequence)) {
    return false;
  }
  const codes = sequence.split(';').map(Number);
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] as number;
    if (code === 38 || code === 48) {
      const mode = codes[++index];
      const size = mode === 5 ? 1 : mode === 2 ? 3 : 0;
      const values = codes.slice(index + 1, index + 1 + size);
      if (size === 0 || values.length !== size || values.some((value) => value > 255)) {
        return false;
      }
      index += size;
    } else if (
      !attributes.has(code)
      && !(code >= 30 && code <= 37)
      && !(code >= 40 && code <= 47)
      && !(code >= 90 && code <= 97)
      && !(code >= 100 && code <= 107)
    ) {
      return false;
    }
  }
  return true;
}
