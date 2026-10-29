import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';

/**
 * A view menu item choosing which columns cards or bars show, in the order
 * they are turned on: a board's card fields, a timeline's bar fields.
 */
export function ShownFieldsPicker(props: {
  label: string;
  /** The columns that can be shown. */
  columns: DatabaseViewColumn[];
  shown: string[];
  onChange: (shown: string[]) => void;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <span class="truncate">{props.label}</span>
        <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent class="max-h-80 min-w-44 overflow-y-auto">
        <Dropdown.Group>
          <For each={props.columns}>
            {(column) => (
              <Dropdown.CheckboxItem
                checked={props.shown.includes(column.id)}
                onChange={(shown) =>
                  props.onChange(
                    shown
                      ? [...props.shown, column.id]
                      : props.shown.filter((id) => id !== column.id)
                  )
                }
                closeOnSelect={false}
              >
                <span class="truncate">{column.name}</span>
              </Dropdown.CheckboxItem>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
