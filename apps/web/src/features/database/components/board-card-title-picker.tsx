import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { Dropdown } from '@ui/components/Dropdown';
import { For } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';

type BoardLayout = Extract<ViewLayout, { kind: 'board' }>;

/** A board menu item choosing the column every card is titled by. */
export function BoardCardTitlePicker(props: {
  layout: BoardLayout;
  columns: DatabaseViewColumn[];
  onChange: (layout: BoardLayout) => void;
}) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <span class="truncate">Card title</span>
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
