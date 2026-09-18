import { toast } from '@core/component/Toast/Toast';
import PlusIcon from '@phosphor/plus.svg';
import { createDatabaseColumn } from '@queries/storage/databases';
import type { DataType } from '@service-properties/generated/schemas/dataType';
import type { DatabaseColumnDetail } from '@service-storage/databases';
import { Button, Dropdown, Tooltip } from '@ui';
import { createSignal, For } from 'solid-js';

type AddColumnMenuProps = {
  databaseId: string;
  tableId: string;
  /** Existing columns, so a new one is not named over an old one. */
  columns: DatabaseColumnDetail[];
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

/**
 * First free `Text`, `Text 2`, `Text 3`… for a type's label.
 *
 * Without this, two text columns are both named "Text" and only their SQL
 * names (`text`, `text_2`) tell them apart — and there is no rename-column
 * endpoint yet to recover from it.
 */
function uniqueColumnName(label: string, taken: string[]): string {
  const used = new Set(taken);
  if (!used.has(label)) return label;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${label} ${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function AddColumnMenu(props: AddColumnMenuProps) {
  const [pending, setPending] = createSignal(false);

  const addColumn = async (label: string, dataType: DataType) => {
    if (pending()) return;
    setPending(true);
    const columnId = await createDatabaseColumn({
      databaseId: props.databaseId,
      tableId: props.tableId,
      request: {
        binding: {
          kind: 'new',
          name: uniqueColumnName(
            label,
            props.columns.map(
              (column) => column.definition.definition.display_name
            )
          ),
          data_type: dataType,
          is_multi_select: false,
        },
      },
    });
    setPending(false);
    if (!columnId) toast.failure('Could not add that column');
  };

  return (
    <Dropdown>
      <Tooltip label="Add column">
        <Dropdown.Trigger
          as={Button}
          variant="ghost"
          size="sm"
          class="size-6 p-0"
          aria-label="Add column"
        >
          <PlusIcon class="size-3" />
        </Dropdown.Trigger>
      </Tooltip>
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
