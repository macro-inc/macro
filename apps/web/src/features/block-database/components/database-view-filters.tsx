import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { For, Index, Show } from 'solid-js';
import {
  type DatabaseFilter,
  type DatabaseViewColumn,
  filterNeedsValue,
  filterOperatorsFor,
} from '../core/database-view';

function FilterValue(props: {
  column: DatabaseViewColumn | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = () =>
    props.column?.dataType === 'BOOLEAN'
      ? [
          { value: '1', label: 'Checked' },
          { value: '0', label: 'Unchecked' },
        ]
      : (props.column?.options.map((option) => ({
          value: String(option),
          label: String(option),
        })) ?? []);
  return (
    <Show
      when={options().length}
      fallback={
        <input
          aria-label="Filter value"
          type={
            props.column?.dataType === 'NUMBER'
              ? 'number'
              : props.column?.dataType === 'DATE'
                ? 'date'
                : 'text'
          }
          value={props.value}
          onInput={(event) => props.onChange(event.currentTarget.value)}
          placeholder="Enter a value…"
          class="h-8 min-w-28 flex-1 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none placeholder:text-ink-placeholder focus:border-ink/50"
        />
      }
    >
      <select
        aria-label="Filter value"
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        class="h-8 min-w-28 flex-1 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none focus:border-ink/50"
      >
        <option value="">Choose a value…</option>
        <For each={options()}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </select>
    </Show>
  );
}

export function FilterPanel(props: {
  columns: DatabaseViewColumn[];
  filters: DatabaseFilter[];
  onChange: (filters: DatabaseFilter[]) => void;
}) {
  const patch = (id: string, change: Partial<DatabaseFilter>) =>
    props.onChange(
      props.filters.map((filter) =>
        filter.id === id ? { ...filter, ...change } : filter
      )
    );
  const add = () => {
    const column = props.columns[0];
    if (!column) return;
    props.onChange([
      ...props.filters,
      {
        id: crypto.randomUUID(),
        columnId: column.id,
        operator: filterOperatorsFor(column)[0].value,
        value: '',
      },
    ]);
  };
  return (
    <div class="w-120 max-w-full">
      <Show
        when={props.filters.length}
        fallback={
          <p class="mb-3 max-w-72 text-xs leading-relaxed text-ink-muted">
            Show only the records you need. Filters change this view, and keep
            your data intact.
          </p>
        }
      >
        <p class="mb-2 text-xs text-ink-muted">Match all of these conditions</p>
      </Show>
      <div class="flex max-h-72 flex-col gap-2 overflow-auto">
        <Index each={props.filters}>
          {(filter) => {
            const column = () =>
              props.columns.find((item) => item.id === filter().columnId);
            return (
              <div class="flex flex-wrap items-center gap-1.5">
                <select
                  aria-label="Filter property"
                  value={filter().columnId}
                  onChange={(event) => {
                    const next = props.columns.find(
                      (item) => item.id === event.currentTarget.value
                    );
                    if (next)
                      patch(filter().id, {
                        columnId: next.id,
                        operator: filterOperatorsFor(next)[0].value,
                        value: '',
                      });
                  }}
                  class="h-8 w-30 min-w-0 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none focus:border-ink/50"
                >
                  <For each={props.columns}>
                    {(item) => <option value={item.id}>{item.name}</option>}
                  </For>
                </select>
                <select
                  aria-label="Filter condition"
                  value={filter().operator}
                  onChange={(event) => {
                    const current = column();
                    const next =
                      current &&
                      filterOperatorsFor(current).find(
                        (option) => option.value === event.currentTarget.value
                      );
                    if (next) patch(filter().id, { operator: next.value });
                  }}
                  class="h-8 w-35 min-w-0 rounded-md border border-edge-muted bg-input px-2 text-xs outline-none focus:border-ink/50"
                >
                  <For each={column() ? filterOperatorsFor(column()!) : []}>
                    {(option) => (
                      <option value={option.value}>{option.label}</option>
                    )}
                  </For>
                </select>
                <Show when={filterNeedsValue(filter().operator)}>
                  <FilterValue
                    column={column()}
                    value={filter().value}
                    onChange={(value) => patch(filter().id, { value })}
                  />
                </Show>
                <button
                  type="button"
                  aria-label="Remove filter"
                  class="rounded-md p-1.5 text-ink-muted hover:bg-hover focus-visible:ring-2 focus-visible:ring-ink/50"
                  onClick={() =>
                    props.onChange(
                      props.filters.filter((item) => item.id !== filter().id)
                    )
                  }
                >
                  <XIcon class="size-3.5" />
                </button>
              </div>
            );
          }}
        </Index>
      </div>
      <div class="mt-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={!props.columns.length}
          onClick={add}
        >
          <PlusIcon class="size-3.5" /> Add condition
        </Button>
        <Show when={props.filters.length}>
          <Button variant="ghost" size="sm" onClick={() => props.onChange([])}>
            Clear filters
          </Button>
        </Show>
      </div>
    </div>
  );
}
