import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import { titleColumn } from '../core/table';
import type { TimelineLayout } from '../core/timeline';
import {
  timelineBarFieldColumns,
  timelineColorColumns,
} from '../core/timeline-bar';
import {
  boardGroupColumns,
  cardTitleColumn,
  timelineRangeColumns,
} from '../core/views';
import { BoardCardTitlePicker } from './board-card-title-picker';
import { ShownFieldsPicker } from './shown-fields-picker';

type TimelineMenuItemProps = {
  layout: TimelineLayout;
  columns: DatabaseViewColumn[];
  onChange: (layout: TimelineLayout) => void;
};

/** The timeline's settings: the dates its bars span, their label and fields, their grouping and their color. */
export function TimelineMenu(props: TimelineMenuItemProps) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        variant="ghost"
        size="icon-md"
        aria-label="Timeline menu"
        tooltip="Timeline menu"
      >
        <DotsIcon class="size-4" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-48">
        <Dropdown.Group>
          <RangeItem {...props} />
          <BoardCardTitlePicker {...props} label="Bar label" />
          <BarFieldsItem {...props} />
          <GroupByItem {...props} />
          <ColorByItem {...props} />
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

function Choice(props: { value: string; label: string }) {
  return (
    <Dropdown.RadioItem value={props.value} closeOnSelect>
      <span class="flex-1 truncate">{props.label}</span>
      <Dropdown.ItemIndicator>
        <CheckIcon class="size-3.5" />
      </Dropdown.ItemIndicator>
    </Dropdown.RadioItem>
  );
}

function RangeItem(props: TimelineMenuItemProps) {
  return (
    <Submenu label="Time range">
      <Dropdown.RadioGroup
        value={props.layout.range}
        onChange={(range) => props.onChange({ ...props.layout, range })}
      >
        <For each={timelineRangeColumns(props.columns)}>
          {(column) => <Choice value={column.id} label={column.name} />}
        </For>
      </Dropdown.RadioGroup>
    </Submenu>
  );
}

function GroupByItem(props: TimelineMenuItemProps) {
  return (
    <Submenu label="Group by">
      <Dropdown.RadioGroup
        value={props.layout.groupBy ?? ''}
        onChange={(groupBy) =>
          props.onChange({ ...props.layout, groupBy: groupBy || null })
        }
      >
        <Choice value="" label="None" />
        <For each={boardGroupColumns(props.columns)}>
          {(column) => <Choice value={column.id} label={column.name} />}
        </For>
      </Dropdown.RadioGroup>
    </Submenu>
  );
}

function BarFieldsItem(props: TimelineMenuItemProps) {
  const title = () =>
    (cardTitleColumn(props.layout, props.columns) ?? titleColumn(props.columns))
      ?.id;
  return (
    <ShownFieldsPicker
      label="Bar fields"
      columns={timelineBarFieldColumns(props.layout, props.columns, title())}
      shown={props.layout.barFields ?? []}
      onChange={(barFields) => props.onChange({ ...props.layout, barFields })}
    />
  );
}

function ColorByItem(props: TimelineMenuItemProps) {
  return (
    <Submenu label="Color by">
      <Dropdown.RadioGroup
        value={props.layout.colorBy ?? ''}
        onChange={(colorBy) =>
          props.onChange({ ...props.layout, colorBy: colorBy || null })
        }
      >
        <Choice value="" label="None" />
        <For each={timelineColorColumns(props.columns)}>
          {(column) => <Choice value={column.id} label={column.name} />}
        </For>
      </Dropdown.RadioGroup>
    </Submenu>
  );
}
