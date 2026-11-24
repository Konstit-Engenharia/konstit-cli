export function validateClosedObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  context: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  const unsupported = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupported !== undefined) {
    throw new TypeError(`${context} contains unsupported field '${unsupported}'`);
  }
}

export function validateArray(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array`);
  }
  return value;
}
