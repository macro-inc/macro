import CheckIcon from '@phosphor/check.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { Key } from '@solid-primitives/keyed';
import {
  createMemo,
  createSignal,
  createUniqueId,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { OptionEditing } from '../context/option-editing';
import { inferDatabaseNumber } from '../core/column-inference';
import type { DatabaseOption, DatabaseViewColumn } from '../core/database-view';
import { OptionEditor } from './option-editor';
import { OptionPill } from './select-pill';

type PickerRow =
  | { kind: 'option'; option: DatabaseOption }
  | { kind: 'create'; label: string };

function optionOf(row: PickerRow): DatabaseOption | undefined {
  return row.kind === 'option' ? row.option : undefined;
}

function createdOf(row: PickerRow): string | undefined {
  return row.kind === 'create' ? row.label : undefined;
}

/** The label a typed name becomes: a numeric select's options are canonical numbers. */
function optionLabelFor(
  column: DatabaseViewColumn,
  typed: string
): string | undefined {
  const text = typed.trim();
  if (!text) return undefined;
  if (column.dataType !== 'SELECT_NUMBER') return text;
  const number = inferDatabaseNumber(text);
  return number === undefined ? undefined : String(number);
}

/**
 * A select's options as a searchable list: typing filters them, a row offers
 * to create the typed name, and each option has an editor. Focus stays in
 * the search field; the arrow keys move through the rows.
 */
export function OptionPicker(props: {
  column: DatabaseViewColumn;
  selected: readonly string[];
  search: string;
  onSearch: (search: string) => void;
  onPick: (label: string) => void;
  onClear: () => void;
  onCreate: (label: string) => void;
  /** Keys the list does not handle, with the option a Tab would choose. */
  onKeyDown?: (event: KeyboardEvent, chosen: string | undefined) => void;
  editing?: OptionEditing;
  inputRef?: (element: HTMLInputElement) => void;
  error?: string;
}) {
  const listId = createUniqueId();
  const [active, setActive] = createSignal(-1);
  let input: HTMLInputElement | undefined;
  let clearButton: HTMLButtonElement | undefined;
  const matches = () => {
    const term = props.search.trim().toLocaleLowerCase();
    return props.column.options.filter((option) =>
      option.label.toLocaleLowerCase().includes(term)
    );
  };
  const creatable = () => {
    const label = optionLabelFor(props.column, props.search);
    return label !== undefined &&
      !props.column.options.some(
        (option) =>
          option.label.toLocaleLowerCase() === label.toLocaleLowerCase()
      )
      ? label
      : undefined;
  };
  const rows = createMemo((): PickerRow[] => {
    const created = creatable();
    return [
      ...matches().map((option) => ({ kind: 'option', option }) as const),
      ...(created !== undefined
        ? [{ kind: 'create', label: created } as const]
        : []),
    ];
  });
  const rowId = (index: number) => `${listId}-${index}`;
  const isPicked = (row: PickerRow) => {
    const option = optionOf(row);
    return !!option && props.selected.includes(option.label);
  };
  const firstMatch = () =>
    props.search.trim() ? matches()[0]?.label : undefined;
  const chosen = () => {
    const row = rows()[active()];
    return row?.kind === 'option' ? row.option.label : firstMatch();
  };
  const activate = (row: PickerRow | undefined) =>
    match(row)
      .with(undefined, () => undefined)
      .with({ kind: 'option' }, ({ option }) => props.onPick(option.label))
      .with({ kind: 'create' }, ({ label }) => props.onCreate(label))
      .exhaustive();
  const move = (step: 1 | -1) => {
    const count = rows().length;
    if (
      step === 1 &&
      clearButton &&
      props.selected.length &&
      !props.search.trim() &&
      active() === count - 1
    ) {
      setActive(-1);
      clearButton.focus();
      return;
    }
    if (!count) return;
    setActive((current) =>
      current < 0
        ? step === 1
          ? 0
          : count - 1
        : (current + step + count) % count
    );
  };
  return (
    <div class="flex w-full min-w-56 flex-col">
      <div class="-mx-1.5 -mt-1.5 mb-1.5 border-b border-edge-divider">
        <input
          ref={(element) => {
            input = element;
            props.inputRef?.(element);
          }}
          role="combobox"
          aria-label={`Search ${props.column.name} options`}
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={active() >= 0 ? rowId(active()) : undefined}
          aria-autocomplete="list"
          placeholder="Search or create…"
          value={props.search}
          maxlength={200}
          class="h-9 w-full bg-transparent px-3.5 text-xs text-ink outline-none placeholder:text-ink-placeholder"
          onInput={(event) => {
            props.onSearch(event.currentTarget.value);
            setActive(event.currentTarget.value.trim() ? 0 : -1);
          }}
          onKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              activate(rows()[Math.max(active(), 0)]);
            } else props.onKeyDown?.(event, chosen());
          }}
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={`${props.column.name} options`}
        aria-multiselectable={props.column.isMultiSelect}
        class="flex max-h-64 flex-col overflow-y-auto"
      >
        <Key
          each={rows()}
          by={(row) => (row.kind === 'option' ? row.option.id : row.kind)}
        >
          {(row, index) => (
            <div
              id={rowId(index())}
              role="option"
              aria-selected={isPicked(row())}
              data-active={active() === index() ? '' : undefined}
              class="group/option flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs data-active:bg-hover hover:bg-hover"
              onPointerMove={() => setActive(index())}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => activate(row())}
            >
              <Switch>
                <Match when={createdOf(row())}>
                  {(label) => (
                    <>
                      <PlusIcon class="size-3.5 shrink-0 text-ink-muted" />
                      <span class="min-w-0 flex-1 truncate">
                        Create “{label()}”
                      </span>
                    </>
                  )}
                </Match>
                <Match when={optionOf(row())}>
                  {(option) => (
                    <>
                      <span class="min-w-0 flex-1">
                        <OptionPill
                          label={option().label}
                          color={option().color}
                          tag={props.column.dataType === 'TAG'}
                        />
                      </span>
                      <Show when={props.selected.includes(option().label)}>
                        <CheckIcon class="size-3.5 shrink-0 text-ink-muted" />
                      </Show>
                      <Show when={props.editing}>
                        {(editing) => (
                          <OptionEditor
                            column={props.column}
                            option={option()}
                            editing={editing()}
                            class="opacity-0 group-hover/option:opacity-100 group-data-active/option:opacity-100 focus-visible:opacity-100 data-expanded:opacity-100"
                          />
                        )}
                      </Show>
                    </>
                  )}
                </Match>
              </Switch>
            </div>
          )}
        </Key>
        <Show when={!rows().length}>
          <p class="px-2 py-1 text-xs text-ink-placeholder">No options</p>
        </Show>
      </div>
      <Show when={props.selected.length}>
        <div class="-mx-1.5 mt-1.5 border-t border-edge-divider px-1.5 pt-1.5">
          <button
            type="button"
            class="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink"
            ref={clearButton}
            onClick={props.onClear}
            onKeyDown={(event) => {
              if (event.isComposing || event.keyCode === 229) return;
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                setActive(
                  event.key === 'ArrowUp'
                    ? rows().length - 1
                    : rows().length
                      ? 0
                      : -1
                );
                input?.focus();
              } else props.onKeyDown?.(event, undefined);
            }}
          >
            <XIcon class="size-3.5 shrink-0" />
            Clear value
          </button>
        </div>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="px-2 pt-1 text-xs text-failure-ink">
          {props.error}
        </p>
      </Show>
    </div>
  );
}
