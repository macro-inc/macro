import CaretRightIcon from '@phosphor/caret-right.svg';
import CheckIcon from '@phosphor/check.svg';
import DotsIcon from '@phosphor/dots-three.svg';
import type { ViewLayout } from '@service-storage/generated/schemas/viewLayout';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX, Show } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import { boardGroupColumns, laneLabel, withLaneHidden } from '../core/views';
import { BoardCardTitlePicker } from './board-card-title-picker';

type BoardLayout = Extract<ViewLayout, { kind: 'board' }>;

/** What every board menu item reads and changes. */
type BoardMenuItemProps = {
  layout: BoardLayout;
  columns: DatabaseViewColumn[];
  onChange: (layout: BoardLayout) => void;
};

/** The board's settings: one menu, one item per setting. */
export function BoardMenu(props: BoardMenuItemProps) {
  return (
    <Dropdown>
      <Dropdown.Trigger variant="ghost" size="icon-sm" aria-label="Board menu">
        <DotsIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Group>
          <GroupByItem {...props} />
          <BoardCardTitlePicker {...props} />
          <CardFieldsItem {...props} />
          <HideEmptyLanesItem {...props} />
          <HiddenLanesItem {...props} />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function Submenu(props: { label: string; children: JSX.Element }) {
  return (
    <Dropdown.Sub>
      <Dropdown.SubTrigger>
        <span class="truncate">{props.label}</span>
        <CaretRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
      </Dropdown.SubTrigger>
      <Dropdown.SubContent class="max-h-80 min-w-44 overflow-y-auto">
        <Dropdown.Group>{props.children}</Dropdown.Group>
      </Dropdown.SubContent>
    </Dropdown.Sub>
  );
}

function GroupByItem(props: BoardMenuItemProps) {
  return (
    <Submenu label="Group by">
      <Dropdown.RadioGroup
        value={props.layout.groupBy}
        onChange={(groupBy) =>
          props.onChange({ ...props.layout, groupBy, lanes: [] })
        }
      >
        <For each={boardGroupColumns(props.columns)}>
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
    </Submenu>
  );
}

function CardFieldsItem(props: BoardMenuItemProps) {
  return (
    <Submenu label="Card fields">
      <For
        each={props.columns.filter(
          (column) => column.id !== props.layout.groupBy
        )}
      >
        {(column) => (
          <Dropdown.CheckboxItem
            checked={props.layout.cardFields.includes(column.id)}
            onChange={(shown) =>
              props.onChange({
                ...props.layout,
                cardFields: shown
                  ? [...props.layout.cardFields, column.id]
                  : props.layout.cardFields.filter((id) => id !== column.id),
              })
            }
            closeOnSelect={false}
          >
            <span class="truncate">{column.name}</span>
          </Dropdown.CheckboxItem>
        )}
      </For>
    </Submenu>
  );
}

function HideEmptyLanesItem(props: BoardMenuItemProps) {
  return (
    <Dropdown.CheckboxItem
      checked={props.layout.hideEmptyLanes}
      onChange={(hideEmptyLanes) =>
        props.onChange({ ...props.layout, hideEmptyLanes })
      }
      closeOnSelect={false}
    >
      Hide empty lanes
    </Dropdown.CheckboxItem>
  );
}

function HiddenLanesItem(props: BoardMenuItemProps) {
  const hidden = () => {
    const column = props.columns.find(
      (entry) => entry.id === props.layout.groupBy
    );
    const lanes = props.layout.lanes.filter((lane) => lane.hidden);
    return column && lanes.length ? { column, lanes } : undefined;
  };
  return (
    <Show when={hidden()}>
      {(shown) => (
        <Submenu label="Hidden lanes">
          <For each={shown().lanes}>
            {(lane) => (
              <Dropdown.Item
                onSelect={() =>
                  props.onChange(withLaneHidden(props.layout, lane.key, false))
                }
              >
                <span class="truncate">
                  Show {laneLabel(shown().column, lane.key)}
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Submenu>
      )}
    </Show>
  );
}
