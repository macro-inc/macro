import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';

/** A board or timeline menu item choosing the column every card or bar is titled by. */
export function BoardCardTitlePicker<Layout extends { title: string }>(props: {
  layout: Layout;
  columns: DatabaseViewColumn[];
  onChange: (layout: Layout) => void;
  /** The item's name; `Card title` on a board. */
  label?: string;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <span class="truncate">{props.label ?? 'Card title'}</span>
        <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent class="max-h-80 min-w-44 overflow-y-auto">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.layout.title}
            onChange={(title) => props.onChange({ ...props.layout, title })}
          >
            <For each={props.columns}>
              {(column) => (
                <Dropdown.RadioItem value={column.id} closeOnSelect>
                  <span class="flex-1 truncate">{column.name}</span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-3.5" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}
