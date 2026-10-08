import type { DatabaseCellValue } from './database-view';

export type DatabaseRelatedRow = { id: string; name: string };

/** Whether two reads of a related table name the same rows, in the same order. */
export function sameRelatedRows(
  left: readonly DatabaseRelatedRow[],
  right: readonly DatabaseRelatedRow[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index]?.id && row.name === right[index]?.name
    )
  );
}
export type DatabaseRelatedDestination = {
  databaseId: string;
  tableId: string;
  rowId: string;
};

/** Relationship cells are JSON arrays even for single-value property definitions. */
export function relatedRowIds(value: DatabaseCellValue): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter((id): id is string => typeof id === 'string')
          ),
        ]
      : [];
  } catch {
    return [];
  }
}
