import type { SheetTable } from '@macro-inc/spreadsheet/sheet-tables';
import { TABLE_COLORS, tableColor } from '@macro-inc/spreadsheet/table-styles';
import ArrowsOutSimple from '@phosphor/arrows-out-simple.svg';
import CaretDown from '@phosphor/caret-down.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Rows from '@phosphor/rows.svg';
import SelectionAll from '@phosphor/selection-all.svg';
import Trash from '@phosphor/trash.svg';
import XCircle from '@phosphor/x-circle.svg';
import TableIcon from '@phosphor-fill/table-fill.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX, Show } from 'solid-js';
import type { TableOption } from '../core/table-types';

/**
 * A table's name, shown above its header row as Google Sheets shows it. Its
 * menu renames the table, changes its range and look, opens a group by view
 * and converts or deletes it.
 */
export function TableMenu(props: {
  table: SheetTable;
  readonly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  style: JSX.CSSProperties;
  /** The table starts in the first row, so its name shows as an icon in
   * the column header bar. */
  compact: boolean;
  onRename: () => void;
  onAdjustRange: () => void;
  onColor: (color: string) => void;
  onOption: (option: TableOption, on: boolean) => void;
  onTotalsRow: (on: boolean) => void;
  onGroupBy: () => void;
  onClearFilters: () => void;
  onConvertToRange: () => void;
  onDelete: () => void;
  onRestoreFocus: () => void;
}) {
  const color = () => tableColor(props.table);
  const option = (label: string, key: TableOption) => (
    <Dropdown.CheckboxItem
      closeOnSelect={false}
      checked={!!props.table[key]}
      onChange={(on) => props.onOption(key, on)}
    >
      {label}
    </Dropdown.CheckboxItem>
  );
  return (
    <div
      data-table-name={props.table.name}
      class="absolute flex"
      classList={{ 'z-[6]': !props.compact, 'z-[25] py-0.5': props.compact }}
      style={props.style}
      onPointerDown={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
    >
      <Show
        when={!props.readonly}
        fallback={
          <NameChip
            name={props.table.name}
            color={color()}
            compact={props.compact}
          />
        }
      >
        <Dropdown
          open={props.open}
          onOpenChange={props.onOpenChange}
          placement="bottom-start"
          modal={false}
        >
          <Dropdown.Trigger
            variant="ghost"
            size="xs"
            tabIndex={-1}
            label={`Table ${props.table.name} menu`}
            class="h-full rounded-none border-0 bg-transparent p-0 touch:min-h-0"
          >
            <NameChip
              name={props.table.name}
              color={color()}
              compact={props.compact}
              menu
            />
          </Dropdown.Trigger>
          <Dropdown.Content
            class="min-w-60 text-xs touch:text-[max(14px,0.875rem)] touch:[&_[role=menuitem]]:min-h-[44px] touch:[&_[role=menuitemcheckbox]]:min-h-[44px]"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              queueMicrotask(props.onRestoreFocus);
            }}
          >
            <Dropdown.Group>
              <Dropdown.GroupLabel class="h-auto flex-col items-start py-1">
                <span class="font-medium text-ink">{props.table.name}</span>
                <span>
                  {props.table.range} · formulas use {props.table.name}
                  [Column]
                </span>
              </Dropdown.GroupLabel>
              <Dropdown.Item closeOnSelect onSelect={props.onRename}>
                <PencilSimple class="size-4" />
                Rename table
              </Dropdown.Item>
              <Dropdown.Item closeOnSelect onSelect={props.onAdjustRange}>
                <ArrowsOutSimple class="size-4" />
                Adjust table range…
              </Dropdown.Item>
            </Dropdown.Group>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Color</Dropdown.GroupLabel>
              <div
                role="radiogroup"
                aria-label="Table color"
                class="grid grid-cols-5 gap-1.5 px-2 pb-1.5"
              >
                <For each={TABLE_COLORS}>
                  {(choice) => (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={color() === choice.color}
                      aria-label={choice.label}
                      title={choice.label}
                      class="size-6 rounded-full border-2 outline-none focus-visible:ring-2 focus-visible:ring-accent touch:size-9"
                      classList={{
                        'border-ink': color() === choice.color,
                        'border-transparent': color() !== choice.color,
                      }}
                      style={{ 'background-color': choice.color }}
                      onClick={() => props.onColor(choice.color)}
                    />
                  )}
                </For>
              </div>
            </Dropdown.Group>
            <Dropdown.Group>
              <Dropdown.GroupLabel>Formatting</Dropdown.GroupLabel>
              {option('Alternating colors', 'bandedRows')}
              {option('Banded columns', 'bandedColumns')}
              {option('Bold first column', 'firstColumn')}
              {option('Bold last column', 'lastColumn')}
              <Dropdown.CheckboxItem
                closeOnSelect={false}
                checked={props.table.totalsRow}
                onChange={props.onTotalsRow}
              >
                Footer row with totals
              </Dropdown.CheckboxItem>
            </Dropdown.Group>
            <Dropdown.Group>
              <Dropdown.Item closeOnSelect onSelect={props.onGroupBy}>
                <Rows class="size-4" />
                Group by view…
              </Dropdown.Item>
              <Show when={props.table.filters}>
                <Dropdown.Item closeOnSelect onSelect={props.onClearFilters}>
                  <XCircle class="size-4" />
                  Clear all filters
                </Dropdown.Item>
              </Show>
            </Dropdown.Group>
            <Dropdown.Group>
              <Dropdown.Item closeOnSelect onSelect={props.onConvertToRange}>
                <SelectionAll class="size-4" />
                Convert to range
              </Dropdown.Item>
              <Dropdown.Item
                closeOnSelect
                class="text-failure-ink"
                onSelect={props.onDelete}
              >
                <Trash class="size-4" />
                Delete table
              </Dropdown.Item>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Show>
    </div>
  );
}

/** The tab showing a table's name on its top edge, or just its icon in
 * the column header bar. */
function NameChip(props: {
  name: string;
  color: string;
  compact: boolean;
  menu?: boolean;
}) {
  return (
    <span
      title={props.name}
      class="flex h-full max-w-56 items-center gap-1 border border-edge-muted bg-panel px-1.5 text-xs font-medium text-ink shadow-sm"
      classList={{
        'rounded-md': props.compact,
        'rounded-t-md border-b-0': !props.compact,
        'not-touch:hover:bg-hover': props.menu,
      }}
    >
      <TableIcon class="size-3.5 shrink-0" style={{ color: props.color }} />
      <span class="truncate" classList={{ 'sr-only': props.compact }}>
        {props.name}
      </span>
      <Show when={props.menu}>
        <CaretDown class="size-3 shrink-0 text-ink-muted" />
      </Show>
    </span>
  );
}
