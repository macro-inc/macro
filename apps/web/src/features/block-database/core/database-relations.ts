import type { DatabaseCellValue } from './database-view';

export type DatabaseRelatedRow = { id: string; name: string };
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
