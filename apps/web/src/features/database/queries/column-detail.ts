import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { DatabaseViewColumn } from '../core/database-view';

export function toViewColumn(column: ColumnDetail): DatabaseViewColumn {
  const config = column.column.config;
  const relation = config?.kind === 'link' ? config : undefined;
  const formula = config?.kind === 'derived' ? config.formula : undefined;
  return {
    id: column.column.id,
    name:
      column.column.display_name ?? column.definition.definition.display_name,
    dataType: column.definition.definition.data_type,
    isMultiSelect: !!relation || column.definition.definition.is_multi_select,
    options: column.definition.property_options.map((option) => ({
      id: option.id,
      label: String(option.value.value),
      color: option.color,
    })),
    writable: column.writable && !formula,
    sharedOutsideDatabase: column.shared_outside_database,
    ...(formula ? { formula } : {}),
    ...(relation
      ? {
          relation: {
            databaseId: relation.database_id,
            tableId: relation.table_id,
          },
        }
      : {}),
    specificEntityType: column.definition.definition.specific_entity_type,
    inferType: column.column.infer_type,
    protections: column.column.protections,
    nullable: column.column.nullable,
  };
}
