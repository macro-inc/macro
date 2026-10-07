import type { DataType } from '@service-storage/generated/schemas/dataType';
import type { DatabaseEntityType } from './column-inference';
import { relatedRowIds } from './database-relations';

export type DatabaseCellValue = string | number | null;

/** A select or tag option: its id, the label cells hold, and its stored colour. */
export type DatabaseOption = {
  id: string;
  label: string;
  color: string | null;
};

/** A table column as the grid draws it, named by its placement id. */
export type DatabaseViewColumn = {
  id: string;
  name: string;
  dataType: DataType;
  isMultiSelect: boolean;
  options: DatabaseOption[];
  writable: boolean;
  specificEntityType?: DatabaseEntityType | null;
  /** A new, empty Text column may adopt the type of its first entry. */
  inferType?: boolean;
  /** Schema actions reserved by the feature using this column. */
  protections?: ('delete' | 'change_type')[];
  /** The column's definition is used beyond this database, so its options change everywhere. */
  sharedOutsideDatabase?: boolean;
  /** A relationship points to rows in a table, independently of the property's scalar type. */
  relation?: {
    databaseId: string;
    tableId: string;
    labels?: Record<string, string>;
  };
};

/** The option a cell holds under `label`. */
export function optionOf(
  column: DatabaseViewColumn,
  label: string
): DatabaseOption | undefined {
  return column.options.find((option) => option.label === label);
}

/** A select or tag column: its cells hold labels from the column's options. */
export function isOptionColumn(
  column: Pick<DatabaseViewColumn, 'dataType' | 'relation'>
): boolean {
  return (
    !column.relation &&
    (column.dataType === 'SELECT_STRING' ||
      column.dataType === 'SELECT_NUMBER' ||
      column.dataType === 'TAG')
  );
}

/** A single-person column: its cells name at most one person. */
export function isPersonColumn(column: DatabaseViewColumn): boolean {
  return (
    !column.relation &&
    !column.isMultiSelect &&
    column.dataType === 'ENTITY' &&
    column.specificEntityType === 'USER'
  );
}

/** A board groups by a single select or a single person, so each card has one lane. */
export function isBoardGroupColumn(column: DatabaseViewColumn): boolean {
  return (
    isPersonColumn(column) ||
    (!column.relation &&
      !column.isMultiSelect &&
      (column.dataType === 'SELECT_STRING' ||
        column.dataType === 'SELECT_NUMBER'))
  );
}

export function databaseCellValues(
  value: DatabaseCellValue,
  column: DatabaseViewColumn
): DatabaseCellValue[] {
  if (column.relation)
    return relatedRowIds(value).map(
      (id) => column.relation?.labels?.[id] ?? 'Unavailable record'
    );
  if (column.isMultiSelect && typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed))
        return parsed.filter(
          (item): item is DatabaseCellValue =>
            item === null ||
            typeof item === 'string' ||
            typeof item === 'number'
        );
    } catch {
      // Not a JSON array: shown as the one value it is.
    }
  }
  return [value];
}
