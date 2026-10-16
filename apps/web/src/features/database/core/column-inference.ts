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
