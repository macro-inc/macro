import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For, Show } from 'solid-js';
import type { DatabaseColumnTypeChange } from '../core/column-schema';
import type { DatabaseViewColumn } from '../core/database-view';
import { PropertyIcon } from './property-icon';

const types: { label: string; change: DatabaseColumnTypeChange }[] = [
  { label: 'Text', change: { dataType: 'STRING' } },
  { label: 'Number', change: { dataType: 'NUMBER' } },
  { label: 'Select', change: { dataType: 'SELECT_STRING' } },
  {
    label: 'Multi-select',
    change: { dataType: 'SELECT_STRING', isMultiSelect: true },
  },
  { label: 'Date', change: { dataType: 'DATE' } },
  { label: 'Checkbox', change: { dataType: 'BOOLEAN' } },
  { label: 'URL', change: { dataType: 'LINK' } },
  {
    label: 'People',
    change: { dataType: 'ENTITY', specificEntityType: 'USER' },
  },
  {
    label: 'Documents',
    change: { dataType: 'ENTITY', specificEntityType: 'DOCUMENT' },
  },
  {
    label: 'Tasks',
    change: { dataType: 'ENTITY', specificEntityType: 'TASK' },
  },
];

export function ColumnTypeMenu(props: {
  column: DatabaseViewColumn;
  tables?: { id: string; name: string }[];
  onChange: (change: DatabaseColumnTypeChange) => void;
}) {
  const selected = (change: DatabaseColumnTypeChange) =>
    !props.column.relation &&
    props.column.dataType === change.dataType &&
    props.column.isMultiSelect === !!change.isMultiSelect &&
    (props.column.specificEntityType ?? undefined) ===
      change.specificEntityType;
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <PropertyIcon
          type={props.column.dataType}
          entityType={props.column.specificEntityType}
          relation={!!props.column.relation}
        />
        <span class="flex-1">Change type</span>
        <CaretRightIcon class="size-3" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent class="w-48 max-h-[min(28rem,80vh)] overflow-y-auto">
        <Dropdown.Group>
          <For each={types}>
            {(type) => (
              <Dropdown.Item onSelect={() => props.onChange(type.change)}>
                <PropertyIcon
                  type={type.change.dataType}
                  entityType={type.change.specificEntityType}
                />
                <span class="flex-1">{type.label}</span>
                <Show when={selected(type.change)}>
                  <CheckIcon class="size-3.5" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
        <Show when={props.tables?.length}>
          <Dropdown.Group>
            <Dropdown.GroupLabel>Related table</Dropdown.GroupLabel>
            <For each={props.tables}>
              {(table) => (
                <Dropdown.Item
                  onSelect={() =>
                    props.onChange({
                      dataType: 'ENTITY',
                      isMultiSelect: true,
                      linkToTableId: table.id,
                    })
                  }
                >
                  <PropertyIcon type="ENTITY" relation />
                  <span class="flex-1 truncate">{table.name}</span>
                  <Show when={props.column.relation?.tableId === table.id}>
                    <CheckIcon class="size-3.5" />
                  </Show>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Show>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
