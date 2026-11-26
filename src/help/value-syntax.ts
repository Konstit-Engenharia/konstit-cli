import type { RequiresIfValueCount } from '../command/types.js';

export interface ValueCountSyntax {
  readonly minValues: number;
  readonly maxValues: number | null;
  readonly repeatable: boolean;
}

export interface PositionalCountSyntax extends ValueCountSyntax {
  readonly presence: 'optional' | 'required' | 'default';
  readonly trailingVarArg: boolean;
}

const expandedValueCountLimit = 8;

export function describeRequiredValueCount({ exactValues, minValues, maxValues }: RequiresIfValueCount): string {
  if (minValues !== undefined && maxValues !== undefined) {
    return `between ${minValues} and ${maxValues} values`;
  }
  const count = exactValues ?? minValues ?? maxValues;
  const qualifier = exactValues !== undefined ? 'exactly' : minValues !== undefined ? 'at least' : 'at most';
  return `${qualifier} ${count} ${count === 1 ? 'value' : 'values'}`;
}

function compactValueCount(
  minimum: number,
  maximum: number | null,
): string | undefined {
  if (
    minimum <= expandedValueCountLimit
    && (maximum === null || maximum <= expandedValueCountLimit)
  ) {
    return undefined;
  }
  if (maximum === null) {
    return `{${minimum}..}`;
  }
  return minimum === maximum ? `{${minimum}}` : `{${minimum}..${maximum}}`;
}

export function renderValueCount(
  argument: ValueCountSyntax,
  label: string,
  minimum = argument.minValues,
): string {
  const value = `<${label}>`;
  const compact = compactValueCount(minimum, argument.maxValues);
  if (compact !== undefined) {
    return ` ${value}${compact}${argument.repeatable ? '...' : ''}`;
  }
  if (argument.maxValues === null) {
    if (minimum === 0) {
      return ` [${value}...]`;
    }
    const required = Array<string>(Math.max(0, minimum - 1)).fill(value);
    return ` ${[...required, `${value}...`].join(' ')}`;
  }
  const required = Array<string>(minimum).fill(value);
  const optional = Array<string>(argument.maxValues - minimum).fill(`[${value}]`);
  const values = [...required, ...optional];
  const repeated = argument.repeatable ? '...' : '';
  return values.length === 0 ? '' : ` ${values.join(' ')}${repeated}`;
}

export function renderEqualsValueCount(
  argument: ValueCountSyntax,
  label: string,
): string {
  const minimum = argument.minValues === 0 && argument.maxValues !== 0
    ? 1
    : argument.minValues;
  const values = renderValueCount(argument, label, minimum).trimStart();
  return argument.minValues === 0 ? `[=${values}]` : `=${values}`;
}

export function renderPositionalCount(
  argument: PositionalCountSyntax,
  name: string,
): string {
  const value = `<${name}>`;
  const optionalValue = `[${name}]`;
  const maximum = argument.trailingVarArg ? null : argument.maxValues;
  const compact = compactValueCount(argument.minValues, maximum);
  if (compact !== undefined) {
    const compactValue = argument.presence === 'required' ? value : optionalValue;
    return `${compactValue}${compact}${argument.repeatable ? '...' : ''}`;
  }
  if (maximum === null) {
    if (argument.presence !== 'required') {
      if (argument.minValues <= 1) {
        return `${optionalValue}...`;
      }
      const values = Array<string>(argument.minValues - 1).fill(value);
      return `[${[...values, `${value}...`].join(' ')}]`;
    }
    const required = Array<string>(Math.max(0, argument.minValues - 1)).fill(value);
    return [...required, `${value}...`].join(' ');
  }
  const requiredCount = argument.presence === 'required' ? argument.minValues : 0;
  const required = Array<string>(requiredCount).fill(value);
  const optional = Array<string>(maximum - requiredCount).fill(optionalValue);
  const repeated = argument.repeatable ? '...' : '';
  return `${[...required, ...optional].join(' ')}${repeated}`;
}
