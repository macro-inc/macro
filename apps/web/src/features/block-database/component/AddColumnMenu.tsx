import { createDatabaseColumn } from '@queries/storage/databases';
import type { DatabaseColumnDetail } from '@service-storage/databases';
import {
  PropertyCreator,
  type PropertyCreatorVariant,
} from '../components/property-creator';
import type { DatabasePropertyType } from '../core/property-creation';

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
      onCreated={() => !!createdId && !!props.onCreated?.(createdId)}
      onCreate={async (property) => {
        const columnId = await createDatabaseColumn({
          databaseId: props.databaseId,
          tableId: props.tableId,
          request: {
            infer_type: property.inferType,
            binding: {
              kind: 'new',
              name: property.name,
              data_type: property.dataType,
              is_multi_select: false,
              ...(property.options.length ? { options: property.options } : {}),
            },
          },
        });
        if (!columnId) throw new Error('Could not add this column');
        createdId = columnId;
      }}
    />
  );
}
