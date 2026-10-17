import {
  TABLE_COLUMN_TYPES,
  type TableColumnFilter,
  type TableColumnType,
} from '@macro-inc/spreadsheet/sheet-tables';
import { TABLE_COLUMN_TYPE_LABELS } from '@macro-inc/spreadsheet/table-columns';
import { filterSummary } from '@macro-inc/spreadsheet/table-filters';
import ArrowLineLeft from '@phosphor/arrow-line-left.svg';
import ArrowLineRight from '@phosphor/arrow-line-right.svg';
import CaretDown from '@phosphor/caret-down.svg';
import Funnel from '@phosphor/funnel-simple.svg';
import Rows from '@phosphor/rows.svg';
import SortAscending from '@phosphor/sort-ascending.svg';
import SortDescending from '@phosphor/sort-descending.svg';
import Trash from '@phosphor/trash.svg';
import XCircle from '@phosphor/x-circle.svg';
import FunnelFill from '@phosphor-fill/funnel-simple-fill.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { createSignal, For, Show } from 'solid-js';
import type { TableFilterChoice } from '../core/table-types';
import { TableColumnTypeIcon } from './TableColumnTypeIcon';
import { TableFilterPanel } from './TableFilterPanel';

export type TableColumnStructure = 'insert-before' | 'insert-after' | 'delete';

/**
 * A table header's menu, opened from the button at the header's right edge
 * as in Google Sheets: the column's type, sorting, filters, a group by view,
 * and inserting or deleting columns.
 */
export function TableColumnMenu(props: {
  column: string;
  type: TableColumnType | undefined;
  filter: TableColumnFilter | undefined;
  choices: () => TableFilterChoice[];
  canChangeStructure: boolean;
  onSort: (descending: boolean) => void;
  onFilter: (filter: TableColumnFilter | undefined) => void;
  onType: (type: TableColumnType | undefined) => void;
  onGroupBy: () => void;
  onStructure: (action: TableColumnStructure) => void;
  onRestoreFocus: () => void;
}) {
  let anchor!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const [filtering, setFiltering] = createSignal(false);
  let openFilter = false;
  return (
    <div
      ref={anchor}
      class="absolute right-0.5 top-1/2 z-[2] size-4 -translate-y-1/2 touch:size-6"
      onPointerDown={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
    >
      <Dropdown
        open={open()}
        onOpenChange={setOpen}
        placement="bottom-end"
        modal={false}
      >
        <Dropdown.Trigger
          variant="ghost"
          size="icon-xs"
          label={`${props.column} column menu${props.filter ? ', filtered' : ''}`}
          title={
            props.filter
              ? `Filtered: ${filterSummary(props.filter)}`
              : `${props.column} options`
          }
          tabIndex={-1}
          class="size-full min-h-0 min-w-0 rounded-sm border border-edge-muted bg-panel p-0 text-ink-muted hover:text-ink touch:min-h-0 touch:min-w-0"
        >
          <Show when={props.filter} fallback={<CaretDown class="size-3" />}>
            <FunnelFill class="size-3 text-accent" />
          </Show>
        </Dropdown.Trigger>
        <Dropdown.Content
          class="min-w-56 text-xs touch:text-[max(14px,0.875rem)] touch:[&_[role=menuitem]]:min-h-[44px] touch:[&_[role=menuitemradio]]:min-h-[44px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (openFilter) {
              openFilter = false;
              setFiltering(true);
              return;
            }
            // Kobalte returns focus to its trigger after this handler.
            queueMicrotask(props.onRestoreFocus);
          }}
        >
          <Dropdown.Group>
            <Dropdown.GroupLabel class="gap-1.5">
              <TableColumnTypeIcon type={props.type} class="size-3.5" />
              <span class="truncate font-medium text-ink">{props.column}</span>
              <span class="ml-auto">
                {props.type ? TABLE_COLUMN_TYPE_LABELS[props.type] : 'No type'}
              </span>
            </Dropdown.GroupLabel>
            <Dropdown.Sub>
              <Dropdown.SubTrigger>
                <span class="flex items-center gap-1.5">
                  <TableColumnTypeIcon type={props.type} class="size-4" />
                  Column type
                </span>
              </Dropdown.SubTrigger>
              <Dropdown.SubContent class="min-w-44 text-xs touch:text-[max(14px,0.875rem)]">
                <Dropdown.Group>
                  <Dropdown.RadioGroup
                    value={props.type ?? 'none'}
                    onChange={(value) =>
                      props.onType(
                        TABLE_COLUMN_TYPES.find((type) => type === value)
                      )
                    }
                  >
                    <Dropdown.RadioItem value="none" closeOnSelect>
                      <TableColumnTypeIcon type={undefined} class="size-4" />
                      None
                      <Dropdown.ItemIndicator class="ml-auto text-accent">
                        ●
                      </Dropdown.ItemIndicator>
                    </Dropdown.RadioItem>
                    <For each={TABLE_COLUMN_TYPES}>
                      {(type) => (
                        <Dropdown.RadioItem value={type} closeOnSelect>
                          <TableColumnTypeIcon type={type} class="size-4" />
                          {TABLE_COLUMN_TYPE_LABELS[type]}
                          <Dropdown.ItemIndicator class="ml-auto text-accent">
                            ●
                          </Dropdown.ItemIndicator>
                        </Dropdown.RadioItem>
                      )}
                    </For>
                  </Dropdown.RadioGroup>
                </Dropdown.Group>
              </Dropdown.SubContent>
            </Dropdown.Sub>
          </Dropdown.Group>
          <Dropdown.Group>
            <Dropdown.Item closeOnSelect onSelect={() => props.onSort(false)}>
              <SortAscending class="size-4" />
              Sort A → Z
            </Dropdown.Item>
            <Dropdown.Item closeOnSelect onSelect={() => props.onSort(true)}>
              <SortDescending class="size-4" />
              Sort Z → A
            </Dropdown.Item>
          </Dropdown.Group>
          <Dropdown.Group>
            <Dropdown.Item
              closeOnSelect
              onSelect={() => {
                openFilter = true;
              }}
            >
              <Funnel class="size-4" />
              Filter…
              <Show when={props.filter}>
                {(filter) => (
                  <span class="ml-auto max-w-28 truncate text-ink-extra-muted">
                    {filterSummary(filter())}
                  </span>
                )}
              </Show>
            </Dropdown.Item>
            <Show when={props.filter}>
              <Dropdown.Item
                closeOnSelect
                onSelect={() => props.onFilter(undefined)}
              >
                <XCircle class="size-4" />
                Clear filter
              </Dropdown.Item>
            </Show>
            <Dropdown.Item closeOnSelect onSelect={props.onGroupBy}>
              <Rows class="size-4" />
              Group by this column
            </Dropdown.Item>
          </Dropdown.Group>
          <Show when={props.canChangeStructure}>
            <Dropdown.Group>
              <Dropdown.Item
                closeOnSelect
                onSelect={() => props.onStructure('insert-before')}
              >
                <ArrowLineLeft class="size-4" />
                Insert column left
              </Dropdown.Item>
              <Dropdown.Item
                closeOnSelect
                onSelect={() => props.onStructure('insert-after')}
              >
                <ArrowLineRight class="size-4" />
                Insert column right
              </Dropdown.Item>
              <Dropdown.Item
                closeOnSelect
                class="text-failure-ink"
                onSelect={() => props.onStructure('delete')}
              >
                <Trash class="size-4" />
                Delete column
              </Dropdown.Item>
            </Dropdown.Group>
          </Show>
        </Dropdown.Content>
      </Dropdown>
      <TableFilterPanel
        open={filtering()}
        anchor={anchor}
        column={props.column}
        filter={props.filter}
        choices={props.choices}
        onApply={(filter) => {
          setFiltering(false);
          props.onFilter(filter);
        }}
        onClose={() => setFiltering(false)}
        onRestoreFocus={props.onRestoreFocus}
      />
    </div>
  );
}
