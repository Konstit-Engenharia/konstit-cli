export function finiteNumber(input: string): number {
  if (input.trim() === '') {
    throw new Error('expected a number');
  }
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new Error('expected a finite number');
  }
  return value;
}

export function scaledInteger(
  input: string,
  units: Readonly<Record<string, number>>,
  errorMessage: string,
): number {
  const match = /^(\d+)(?:\.(\d+))?([A-Za-z]*)$/.exec(input);
  if (match === null) {
    throw new Error(errorMessage);
  }

  const [, whole = '0', fraction, unit = '',] = match;
  if (!Object.hasOwn(units, unit)) {
    throw new Error(errorMessage);
  }
  const multiplier = units[unit] as number;

  const multiplierValue = BigInt(multiplier);
  let value = BigInt(whole) * multiplierValue;
  if (fraction !== undefined) {
    const denominator = 10n ** BigInt(fraction.length);
    const numerator = BigInt(fraction) * multiplierValue;
    if (numerator % denominator !== 0n) {
      throw new Error(errorMessage);
    }
    value += numerator / denominator;
  }

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(errorMessage);
  }
  return Number(value);
}

export const durationUnits = Object.freeze({
  '': 1,
  'ms': 1,
  's': 1_000,
  'm': 60_000,
  'h': 3_600_000,
  'd': 86_400_000,
});

export const byteSizeUnits = Object.freeze({
  '': 1,
  'B': 1,
  'KB': 1_000,
  'MB': 1_000_000,
  'GB': 1_000_000_000,
  'TB': 1_000_000_000_000,
  'KiB': 1_024,
  'MiB': 1_048_576,
  'GiB': 1_073_741_824,
  'TiB': 1_099_511_627_776,
});
