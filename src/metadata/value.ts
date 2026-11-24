import type { MetadataValue } from './types.js';

export function toMetadataValue(
  value: unknown,
  active = new WeakSet<object>(),
): MetadataValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'bigint') {
    return `${value}n`;
  }
  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return undefined;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (value instanceof URL) {
    return value.href;
  }
  if (value instanceof RegExp) {
    return `/${value.source}/${value.flags}`;
  }
  if (typeof value !== 'object' || active.has(value)) {
    return undefined;
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const values: MetadataValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          return undefined;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !('value' in descriptor)) {
          return undefined;
        }
        const safeItem = toMetadataValue(descriptor.value, active);
        if (safeItem === undefined) {
          return undefined;
        }
        values.push(safeItem);
      }
      return Object.freeze(values);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const copy: Record<string, MetadataValue> = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !('value' in descriptor)) {
        return undefined;
      }
      const safeValue = toMetadataValue(descriptor.value, active);
      if (safeValue === undefined) {
        return undefined;
      }
      copy[key] = safeValue;
    }
    return Object.freeze(copy);
  } finally {
    active.delete(value);
  }
}
