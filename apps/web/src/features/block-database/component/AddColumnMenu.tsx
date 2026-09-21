import {
  createDatabaseColumn,
  useDatabaseDetailQuery,
} from '@queries/storage/databases';
import type { DatabaseColumnDetail } from '@service-storage/databases';
import {
  PropertyCreator,
  type PropertyCreatorVariant,
} from '../components/property-creator';
import type {
  DatabasePropertyType,
  DatabaseRelationTables,
} from '../core/property-creation';

/** Production adapter; the form itself only receives names and a save action. */
export function AddColumnMenu(props: {
  databaseId: string;
  tableId: string;
  columns: DatabaseColumnDetail[];
  label?: string;
  variant?: PropertyCreatorVariant;
  initialType?: DatabasePropertyType;
  onCreated?: (columnId: string) => boolean;
}) {
  const detail = useDatabaseDetailQuery(() => props.databaseId);
  // Guard resource reads so loading this menu never suspends the owning grid.
  const relationTables = (): DatabaseRelationTables => {
    if (detail.isError)
      return { status: 'error', retry: () => void detail.refetch() };
    if (!detail.isSuccess) return { status: 'loading' };
    return {
      status: 'ready',
      tables: detail.data.tables.map(({ table }) => ({
        id: table.id,
        name: table.name,
      })),
    };
  };
  let createdId: string | undefined;
  return (
    <PropertyCreator
      existingNames={props.columns.map(
        (column) =>
          column.column.display_name ??
          column.definition.definition.display_name
      )}
      label={props.label}
      variant={props.variant}
      initialType={props.initialType}
      relationTables={relationTables()}
      onCreated={() => !!createdId && !!props.onCreated?.(createdId)}
      onCreate={async (property) => {
        if (property.dataType === 'ENTITY' && !property.relationTableId)
          throw new Error('Choose a related table');
        const columnId = await createDatabaseColumn({
          databaseId: props.databaseId,
          tableId: props.tableId,
          request: {
            infer_type: property.inferType,
            binding: {
              kind: 'new',
              name: property.name,
              data_type: property.dataType,
              is_multi_select: property.dataType === 'ENTITY',
              ...(property.options.length ? { options: property.options } : {}),
            },
            ...(property.dataType === 'ENTITY'
              ? {
                  linkToTableId: property.relationTableId,
                  linkToDatabaseId: props.databaseId,
                }
              : {}),
          },
        });
        if (!columnId) throw new Error('Could not add this column');
        createdId = columnId;
      }}
    />
  );
}
