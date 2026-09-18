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
import type { Property, PropertyApiValues, ValueType } from '@property/types';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOwner } from '@service-properties/generated/schemas/propertyOwner';
import type {
  DatabaseColumnDetail,
  SqlValue,
} from '@service-storage/databases';

/** Property value types the grid can edit in place. */
const EDITABLE_VALUE_TYPES = new Set<string>([
  'STRING',
  'NUMBER',
  'BOOLEAN',
  'LINK',
  'DATE',
]);

/** Whether a column's editing is handled by the `@property` editors. */
export function isPropertyEditableColumn(column: DatabaseColumnDetail) {
  const dataType = column.definition.definition.data_type;
  return (
    column.writable &&
    !column.definition.definition.is_multi_select &&
    EDITABLE_VALUE_TYPES.has(dataType)
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
    // Unique per cell so the editors' focus-restoration lookups land on this
    // cell rather than on the same column in another row.
    propertyId: `${rowId}:${column.column.id}`,
    propertyDefinitionId: definition.id,
    displayName: definition.display_name,
    isMultiSelect: definition.is_multi_select,
    isSystemProperty: definition.is_system,
    owner: definition.owner as PropertyOwner,
    specificEntityType: definition.specific_entity_type,
    options: column.definition.property_options,
    createdAt: definition.created_at,
    updatedAt: definition.updated_at,
  };

  switch (definition.data_type as ValueType) {
    case 'STRING':
      return {
        ...shared,
        valueType: 'STRING',
        value: value === null ? null : String(value),
      };
    case 'NUMBER':
      return {
        ...shared,
        valueType: 'NUMBER',
        value: typeof value === 'number' ? value : null,
      };
    case 'BOOLEAN':
      return {
        ...shared,
        valueType: 'BOOLEAN',
        value: value === null ? null : Boolean(value),
      };
    case 'LINK':
      return {
        ...shared,
        valueType: 'LINK',
        value: value === null ? null : [String(value)],
      };
    case 'DATE': {
      const parsed = value === null ? null : new Date(String(value));
      return {
        ...shared,
        valueType: 'DATE',
        value: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      };
    }
    default:
      return undefined;
  }
}

/** Turn what an editor saved back into the scalar SQL should store. */
export function apiValuesToSqlValue(values: PropertyApiValues): SqlValue {
  switch (values.valueType) {
    case 'STRING':
      return values.value === '' ? null : values.value;
    case 'NUMBER':
      return values.value;
    case 'BOOLEAN':
      return values.value === null ? null : values.value ? 1 : 0;
    case 'DATE':
      return values.value === null ? null : values.value.toISOString();
    case 'LINK':
      return values.values?.[0] ?? null;
    case 'SELECT_STRING':
    case 'SELECT_NUMBER':
    case 'ENTITY':
      // Not reachable: these column kinds never mount a property editor.
      return null;
  }
}
