/**
 * Bridging between a SQL cell and the `@property` editors.
 *
 * The grid reads rows through `exec`, so a cell arrives as a SQLite scalar.
 * The property editors want a `Property`, and hand back a `PropertyApiValues`.
 * Both directions live here so the cell component stays presentational.
 *
 * Select columns are the one asymmetry worth naming: SQL reads and writes the
 * option's *display label*, while `Property` carries option *ids*, so the
 * definition's options are the lookup table between them.
 */
import type { Property, PropertyApiValues } from '@property/types';
import type { DataType } from '@service-properties/generated/schemas/dataType';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type {
  DatabaseColumnDetail,
  SqlValue,
} from '@service-storage/databases';
import { match } from 'ts-pattern';

/** Property value types the grid can edit in place. */
const EDITABLE_DATA_TYPES = new Set<DataType>([
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'LINK',
  'DATE',
]);

/** Whether a column's editing is handled by the `@property` editors. */
function isPropertyEditableColumn(column: DatabaseColumnDetail) {
  const dataType = column.definition.definition.data_type;
  return (
    column.writable &&
    !column.definition.definition.is_multi_select &&
    EDITABLE_DATA_TYPES.has(dataType)
  );
}

/** Whether a column edits through the grid's own select dropdown. */
export function isSelectColumn(column: DatabaseColumnDetail) {
  const dataType = column.definition.definition.data_type;
  return dataType === 'SELECT_STRING' || dataType === 'SELECT_NUMBER';
}

/** The display label of a select option. */
export function optionLabel(option: PropertyOption): string {
  return String(option.value.value);
}

/** Human-readable rendering of any cell, for the read-only column kinds. */
export function displayCellValue(
  column: DatabaseColumnDetail,
  value: SqlValue
): string {
  if (value === null) return '';
  if (column.definition.definition.data_type === 'BOOLEAN') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

/**
 * Build the `Property` a cell's editor binds to.
 *
 * Returns `undefined` for the column kinds the property editors cannot drive
 * from a SQL scalar (entities, tags, multi-valued columns) — those render
 * read-only.
 */
export function cellToProperty(
  column: DatabaseColumnDetail,
  rowId: string,
  value: SqlValue
): Property | undefined {
  const definition = column.definition.definition;
  if (!isPropertyEditableColumn(column)) return undefined;

  const shared = {
    // `Property.Root` restores focus by `document.querySelector` on
    // `[data-property-id]`, so the id has to be unique in the document — a
    // column id alone repeats once per row.
    propertyId: `${rowId}:${column.column.id}`,
    propertyDefinitionId: definition.id,
    displayName: definition.display_name,
    isMultiSelect: definition.is_multi_select,
    isSystemProperty: definition.is_system,
    owner: definition.owner,
    specificEntityType: definition.specific_entity_type,
    options: column.definition.property_options,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
  };

  // `DataType` is the wire enum and carries kinds the editors cannot drive
  // from a scalar (`TAG`, `ENTITY`, the selects) — those map to `undefined`.
  return match<DataType, Property | undefined>(definition.data_type)
    .with('STRING', () => ({
      ...shared,
      valueType: 'STRING' as const,
      value: value === null ? null : String(value),
    }))
    .with('NUMBER', () => ({
      ...shared,
      valueType: 'NUMBER' as const,
      value: typeof value === 'number' ? value : null,
    }))
    .with('BOOLEAN', () => ({
      ...shared,
      valueType: 'BOOLEAN' as const,
      value: value === null ? null : Boolean(value),
    }))
    .with('LINK', () => ({
      ...shared,
      valueType: 'LINK' as const,
      value: value === null ? null : [String(value)],
    }))
    .with('DATE', () => {
      const parsed = value === null ? null : new Date(String(value));
      return {
        ...shared,
        valueType: 'DATE' as const,
        value: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      };
    })
    .with('SELECT_STRING', 'SELECT_NUMBER', 'ENTITY', 'TAG', () => undefined)
    .exhaustive();
}

/** Turn what an editor saved back into the scalar SQL should store. */
export function apiValuesToSqlValue(values: PropertyApiValues): SqlValue {
  return match(values)
    .with({ valueType: 'STRING' }, (saved) =>
      saved.value === '' ? null : saved.value
    )
    .with({ valueType: 'NUMBER' }, (saved) => saved.value)
    .with({ valueType: 'BOOLEAN' }, (saved) =>
      saved.value === null ? null : saved.value ? 1 : 0
    )
    .with({ valueType: 'DATE' }, (saved) =>
      saved.value === null ? null : saved.value.toISOString()
    )
    .with({ valueType: 'LINK' }, (saved) => saved.values?.[0] ?? null)
    .with(
      { valueType: 'SELECT_STRING' },
      { valueType: 'SELECT_NUMBER' },
      { valueType: 'ENTITY' },
      // Never reached: these column kinds do not mount a property editor.
      () => null
    )
    .exhaustive();
}
