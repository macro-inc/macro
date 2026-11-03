import type { EntityType } from '@service-properties/generated/schemas/entityType';

export type DatabaseEntityType = EntityType;

export type DatabaseMention = {
  id: string;
  entityType: DatabaseEntityType;
  label: string;
};

export type DatabaseColumnType =
  | { dataType: 'STRING' | 'NUMBER' }
  | { dataType: 'ENTITY'; entityType: DatabaseEntityType };

/** Keep identifiers (00123), unsafe integers, and formatted text intact. */
export function inferDatabaseNumber(value: string): number | undefined {
  const text = value.trim();
  if (!/^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
    return undefined;
  const number = Number(text);
  if (!Number.isFinite(number)) return undefined;
  if (Number.isInteger(number) && !Number.isSafeInteger(number))
    return undefined;
  return number;
}

/** Explicit money input also accepts locale separators; inference stays strict. */
export function parseMonetaryInput(
  value: string,
  locale?: string
): number | undefined {
  const canonical = inferDatabaseNumber(value);
  if (canonical !== undefined) return canonical;
  const format = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 20,
    useGrouping: 'always',
  });
  const parts = format.formatToParts(-12345.6);
  const decimal = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const group = parts.find((part) => part.type === 'group')?.value;
  const minus = parts.find((part) => part.type === 'minusSign')?.value ?? '-';
  const digits = Array.from({ length: 10 }, (_, digit) => format.format(digit));
  const normalize = (text: string) => {
    for (const [digit, symbol] of digits.entries())
      text = text.replaceAll(symbol, String(digit));
    for (const part of parts)
      if (part.type === 'literal') text = text.replaceAll(part.value, '');
    return text.replaceAll(minus, '-');
  };
  const text = normalize(value.trim());
  const ungrouped = group ? text.replaceAll(group, '') : text;
  const number = inferDatabaseNumber(ungrouped.replace(decimal, '.'));
  if (number === undefined) return undefined;
  if (group && text.includes(group)) {
    if (text.split(decimal)[1]?.includes(group)) return undefined;
    const integer = text.split(decimal)[0].replace(/^[+-]/, '');
    const formatted = format
      .formatToParts(Math.abs(number))
      .filter((part) => part.type === 'integer' || part.type === 'group')
      .map((part) => part.value)
      .join('');
    if (integer !== normalize(formatted)) return undefined;
  }
  return number;
}
