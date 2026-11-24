/** Converts an executable name into a safe shell function suffix. */
export function shellIdentifier(executable: string): string {
  const normalized = executable.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`;
}

/** Quotes a value for POSIX shell snippets. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll('\'', `'"'"'`)}'`;
}

/** Quotes a value for fish snippets. */
export function fishQuote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`;
}

/** Quotes a value for PowerShell snippets. */
export function powerShellQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\'')}'`;
}
