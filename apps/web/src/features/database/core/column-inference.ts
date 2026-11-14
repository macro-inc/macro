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

/** Percentage points to the stored fraction: `25` and `25%` are 0.25. */
export function inferDatabasePercentage(value: string): number | undefined {
  const points = inferDatabaseNumber(value.trim().replace(/%$/, '').trim());
  return points === undefined ? undefined : points / 100;
}

/** The stored fraction as percentage points for the cell editor. */
export function percentagePointsText(value: number): string {
  return String(Number((value * 100).toPrecision(12)));
}
