import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import { invalidateDatabase } from '@queries/storage/databases';
import type { DataType } from '@service-properties/generated/schemas/dataType';
import { storageServiceClient } from '@service-storage/client';
import { Button, Dropdown } from '@ui';
import { createSignal, For } from 'solid-js';

type AddColumnMenuProps = {
  databaseId: string;
  tableId: string;
};

/**
 * Column types offered at the header's `+`. Links and lookups are a separate,
 * later affordance — they need a target picker, not a type list.
 */
const COLUMN_TYPES: { label: string; dataType: DataType }[] = [
  { label: 'Text', dataType: 'STRING' },
  { label: 'Number', dataType: 'NUMBER' },
  { label: 'Checkbox', dataType: 'BOOLEAN' },
  { label: 'Date', dataType: 'DATE' },
  { label: 'Select', dataType: 'SELECT_STRING' },
  { label: 'Link', dataType: 'LINK' },
];

export function AddColumnMenu(props: AddColumnMenuProps) {
  const [pending, setPending] = createSignal(false);

  const addColumn = async (label: string, dataType: DataType) => {
    if (pending()) return;
    setPending(true);
    const result = await storageServiceClient.databases.createColumn({
      id: props.databaseId,
      tableId: props.tableId,
      request: {
        binding: {
          kind: 'new',
          name: label,
          data_type: dataType,
          is_multi_select: false,
        },
      },
    });
    setPending(false);
    if (result.isErr()) {
      toast.failure('Could not add that column');
      return;
    }
    await invalidateDatabase(props.databaseId);
  };

  return (
    <Dropdown>
      <Dropdown.Trigger
        as={Button}
        variant="ghost"
        size="sm"
        class="size-6 p-0"
        title="Add column"
      >
        <PlusIcon class="size-3" />
      </Dropdown.Trigger>
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.GroupLabel>New column</Dropdown.GroupLabel>
          <For each={COLUMN_TYPES}>
            {(type) => (
              <Dropdown.Item
                onSelect={() => addColumn(type.label, type.dataType)}
              >
                {type.label}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
