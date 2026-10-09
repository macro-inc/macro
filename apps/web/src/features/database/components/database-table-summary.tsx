import PlusIcon from '@phosphor/plus.svg';
import { Key } from '@solid-primitives/keyed';
import { Dropdown } from '@ui/components/Dropdown';
import { createMemo, createSignal, For, Show } from 'solid-js';
import {
  type ColumnCalculation,
  summarizeColumn,
} from '../core/column-summary';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow } from '../core/table';

const calculations: {
  value: ColumnCalculation;
  label: string;
  numeric?: boolean;
}[] = [
  { value: 'none', label: 'None' },
  { value: 'count', label: 'Count filled' },
  { value: 'unique', label: 'Count unique' },
  { value: 'sum', label: 'Sum', numeric: true },
  { value: 'average', label: 'Average', numeric: true },
  { value: 'min', label: 'Min', numeric: true },
  { value: 'max', label: 'Max', numeric: true },
];
const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** Shares the grid's column tracks and scroll container so totals stay aligned. */
export function DatabaseTableSummary(props: {
  columns: DatabaseViewColumn[];
  rows: DatabaseRow[];
  template: string;
  addColumn: boolean;
}) {
  return (
    <div
      role="row"
      aria-label="Table summary"
      class="sticky bottom-0 z-2 grid h-10 shrink-0 border-t border-edge-muted bg-panel text-xs"
      style={{ 'grid-template-columns': props.template }}
    >
      <div
        role="gridcell"
        aria-colspan={props.columns.length ? 2 : 1}
        class="sticky left-0 z-1 flex min-w-0 items-center gap-1 border-r border-edge-muted/40 bg-panel px-4 text-ink-muted"
        style={{ 'grid-column': props.columns.length ? 'span 2' : 'span 1' }}
      >
        <span class="tabular-nums text-ink">
          {format.format(props.rows.length)}
        </span>
        <span>{props.rows.length === 1 ? 'record' : 'records'} in view</span>
      </div>
      <Key each={props.columns.slice(1)} by="id">
        {(column) => <SummaryCell column={column()} rows={props.rows} />}
      </Key>
      <Show when={props.addColumn}>
        <div role="gridcell" />
      </Show>
    </div>
  );
}

function SummaryCell(props: {
  column: DatabaseViewColumn;
  rows: DatabaseRow[];
}) {
  const numeric = () =>
    props.column.dataType === 'NUMBER' &&
    !props.column.isMultiSelect &&
    !props.column.relation;
  const [choice, setChoice] = createSignal<ColumnCalculation>();
  const options = () =>
    calculations.filter((option) => !option.numeric || numeric());
  const calculation = () =>
    options().find(
      (option) => option.value === (choice() ?? (numeric() ? 'sum' : 'none'))
    ) ?? calculations[0];
  const value = createMemo(() =>
    summarizeColumn(
      props.rows.map((row) => row.cells[props.column.id] ?? null),
      calculation().value
    )
  );
  return (
    <div
      role="gridcell"
      class="flex min-w-0 items-center justify-start border-r border-edge-muted/40 px-2"
    >
      <Dropdown>
        <Dropdown.Trigger
          size="sm"
          variant="ghost"
          class="h-7 min-w-0 gap-1.5 rounded-none border-0 px-2 text-xs font-normal text-ink-muted"
          aria-label={`${props.column.name} calculation: ${calculation().label}`}
        >
          <Show
            when={calculation().value !== 'none'}
            fallback={
              <>
                <PlusIcon class="size-3.5 shrink-0" />
                <span>Add calculation</span>
              </>
            }
          >
            <span class="tabular-nums text-ink">
              {value() === null ? '—' : format.format(value()!)}
            </span>
            <span class="truncate lowercase">{calculation().label}</span>
          </Show>
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Group>
            <Dropdown.GroupLabel>{props.column.name}</Dropdown.GroupLabel>
            <For each={options()}>
              {(option) => (
                <Dropdown.Item onSelect={() => setChoice(option.value)}>
                  {option.label}
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Group>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
