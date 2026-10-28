/** Open databases as the schema the engine's `buildCatalog` reads, as the server maps its own. */

import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { Schema } from './generated/types';

export function databaseSqlSchema(
  databases: readonly DatabaseDetail[]
): Schema {
  return {
    databases: databases.map(({ database, tables }) => ({
      id: database.id,
      name: database.name,
      tables: tables.map(({ table, columns }) => ({
        id: table.id,
        name: table.name,
        columns: columns.map(({ column, definition }) => ({
          id: column.id,
          definition: definition.definition.id,
          name: column.display_name ?? definition.definition.display_name,
          property: {
            dataType: definition.definition.data_type,
            multi: definition.definition.is_multi_select,
            entityType: definition.definition.specific_entity_type,
            relation: column.config?.kind === 'link',
          },
          options: definition.property_options.map((option) => ({
            id: option.id,
            value: option.value,
            order: option.display_order,
          })),
          ...(column.config?.kind === 'derived'
            ? { formula: column.config.formula }
            : {}),
        })),
      })),
    })),
    // The server's catalog offers every viewer `macro.people`; so does the browser's.
    platform: ['people'],
  };
}
