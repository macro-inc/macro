import { toast } from '@core/component/Toast/Toast';
import CaretDownIcon from '@phosphor/caret-down.svg';
import PlusIcon from '@phosphor/plus.svg';
import { Property } from '@property';
import type { PropertyApiValues, Property as PropertyT } from '@property/types';
import { addDatabaseColumnOptions } from '@queries/storage/databases';
import type {
  DatabaseColumnDetail,
  SqlValue,
} from '@service-storage/databases';
import { cn, Dropdown } from '@ui';
import { createSignal, For, onMount, Show } from 'solid-js';
import {
  apiValuesToSqlValue,
  cellToProperty,
  displayCellValue,
  isSelectColumn,
  optionLabel,
} from '../cell';

type GridCellProps = {
  column: DatabaseColumnDetail;
  rowId: string;
  value: SqlValue;
  canEdit: boolean;
  onWrite: (value: SqlValue) => void;
  /** Database the cell's table belongs to, for widening a select column. */
  databaseId: string;
  tableId: string;
};

/**
 * One grid cell.
 *
 * Text, number, boolean, link and date columns edit through the shared
 * `@property` editors. Select columns use the dropdown below, because SQL
 * carries the option's display label while the property editors carry option
 * ids — the schema response already ships the labels, so no second fetch.
 * Entity, tag and multi-valued columns render read-only for now.
 */
export function GridCell(props: GridCellProps) {
  const property = (): PropertyT | undefined =>
    props.canEdit
      ? cellToProperty(props.column, props.rowId, props.value)
      : undefined;

  const save = async (_property: PropertyT, values: PropertyApiValues) => {
    props.onWrite(apiValuesToSqlValue(values));
  };

  return (
    <Show
      when={property()}
      fallback={
        <Show
          when={props.canEdit && isSelectColumn(props.column)}
          fallback={
            <div class="truncate px-2 py-1 text-ink-muted text-xs">
              {displayCellValue(props.column, props.value)}
            </div>
          }
        >
          <SelectCell
            column={props.column}
            value={props.value}
            onWrite={props.onWrite}
            databaseId={props.databaseId}
            tableId={props.tableId}
          />
        </Show>
      }
    >
      {(cellProperty) => (
        <Property.Root
          property={cellProperty()}
          canEdit={props.canEdit}
          onSave={save}
          class="min-w-0 text-xs"
        >
          <Property.Display />
        </Property.Root>
      )}
    </Show>
  );
}

/**
 * The inline field "Add option…" reveals.
 *
 * It takes focus itself on mount rather than through `autofocus`, and only
 * treats a blur as a cancel once it has actually held focus — the dropdown it
 * replaces restores focus as it closes, and an unguarded blur handler would
 * read that as the user giving up.
 */
function NewOptionInput(props: {
  value: string;
  /** True while the option is being registered — read-only, not disabled, so
   * the field keeps focus and a blur is not mistaken for a cancel. */
  pending: boolean;
  onInput: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  let inputRef: HTMLInputElement | undefined;
  const [focused, setFocused] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus());
  });

  return (
    <input
      ref={inputRef}
      type="text"
      value={props.value}
      readOnly={props.pending}
      aria-label="New option"
      placeholder="New option"
      onInput={(event) => props.onInput(event.currentTarget.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        if (focused()) props.onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          props.onCommit();
        }
        if (event.key === 'Escape') props.onCancel();
      }}
      class="w-full min-w-0 rounded-md border border-accent bg-surface px-2 py-1 text-ink text-xs outline-none placeholder:text-ink-placeholder"
    />
  );
}

/**
 * A select cell: a dropdown over the column's options, plus a way to widen
 * the column.
 *
 * "Add option…" closes the menu and swaps the trigger for an input rather
 * than nesting the input in the menu, because a menu's typeahead swallows
 * printable keys. The new label is registered on the column first — the
 * materialized table CHECKs writes against the option list, so writing the
 * cell before the option exists would be refused.
 */
function SelectCell(props: {
  column: DatabaseColumnDetail;
  value: SqlValue;
  onWrite: (value: SqlValue) => void;
  databaseId: string;
  tableId: string;
}) {
  const [adding, setAdding] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [pending, setPending] = createSignal(false);

  const options = () => props.column.definition.property_options;
  const label = () => (props.value === null ? '' : String(props.value));

  const startAdding = () => {
    setDraft('');
    setAdding(true);
  };

  const commitOption = async () => {
    const newLabel = draft().trim();
    if (!newLabel || pending()) return;

    const existing = options().find(
      (option) => optionLabel(option) === newLabel
    );
    if (!existing) {
      setPending(true);
      const updated = await addDatabaseColumnOptions({
        databaseId: props.databaseId,
        tableId: props.tableId,
        columnId: props.column.column.id,
        labels: [newLabel],
      });
      setPending(false);
      if (!updated) {
        toast.failure('Could not add that option');
        return;
      }
    }

    setAdding(false);
    props.onWrite(newLabel);
  };

  return (
    <Show
      when={!adding()}
      fallback={
        <NewOptionInput
          value={draft()}
          pending={pending()}
          onInput={setDraft}
          onCommit={commitOption}
          onCancel={() => setAdding(false)}
        />
      }
    >
      <Dropdown>
        <Dropdown.Trigger
          variant="ghost"
          size="sm"
          class="w-full justify-between px-2 text-xs"
        >
          <span class={cn('truncate', !label() && 'text-ink-extra-muted')}>
            {label() || 'Empty'}
          </span>
          <CaretDownIcon class="size-3 shrink-0 text-ink-extra-muted" />
        </Dropdown.Trigger>
        <Dropdown.Content>
          <Dropdown.Item onSelect={() => props.onWrite(null)}>
            Empty
          </Dropdown.Item>
          <For each={options()}>
            {(option) => (
              <Dropdown.Item
                onSelect={() => props.onWrite(optionLabel(option))}
              >
                {optionLabel(option)}
              </Dropdown.Item>
            )}
          </For>
          <Dropdown.Item
            class="text-ink-muted"
            onSelect={() => queueMicrotask(startAdding)}
          >
            <PlusIcon class="size-3 shrink-0" />
            Add option…
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown>
    </Show>
  );
}
