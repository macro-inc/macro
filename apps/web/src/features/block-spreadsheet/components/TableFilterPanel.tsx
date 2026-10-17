import type { CollectionNode } from '@kobalte/core';
import { Popover } from '@kobalte/core/popover';
import {
  TABLE_FILTER_OPERATORS,
  type TableColumnFilter,
  type TableFilterOperator,
} from '@macro-inc/spreadsheet/sheet-tables';
import { TABLE_FILTER_LABELS } from '@macro-inc/spreadsheet/table-filters';
import CaretDown from '@phosphor/caret-down.svg';
import Check from '@phosphor/check.svg';
import { Button } from '@ui/components/Button';
import { Checkbox } from '@ui/components/Checkbox';
import { Input } from '@ui/components/Input';
import { Select } from '@ui/components/Select';
import { createMemo, createSignal, For, Show } from 'solid-js';
import type { TableFilterChoice } from '../core/table-types';

/** Values listed at once; a column with more lists the first that match. */
const MAX_CHOICES = 500;

type ConditionOption = { value: TableFilterOperator | 'none'; label: string };
const CONDITIONS: ConditionOption[] = [
  { value: 'none', label: 'None' },
  ...TABLE_FILTER_OPERATORS.map((value) => ({
    value,
    label: TABLE_FILTER_LABELS[value],
  })),
];

/**
 * A column's filter, as Google Sheets edits it: by condition, by values, or
 * both. Changes apply with OK.
 */
export function TableFilterPanel(props: {
  open: boolean;
  anchor: HTMLElement;
  column: string;
  filter: TableColumnFilter | undefined;
  choices: () => TableFilterChoice[];
  onApply: (filter: TableColumnFilter | undefined) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <Popover
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      anchorRef={() => props.anchor}
      placement="bottom-end"
      gutter={4}
    >
      <Popover.Portal>
        <Popover.Content
          aria-label={`Filter ${props.column}`}
          onFocusOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            props.onRestoreFocus();
          }}
          onKeyDown={(event) => event.stopPropagation()}
          class="menu-surface z-action-menu flex w-72 flex-col text-xs outline-none touch:w-80 touch:text-[max(14px,0.875rem)]"
        >
          <Show when={props.open}>
            <FilterForm {...props} />
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

function FilterForm(props: {
  column: string;
  filter: TableColumnFilter | undefined;
  choices: () => TableFilterChoice[];
  onApply: (filter: TableColumnFilter | undefined) => void;
  onClose: () => void;
}) {
  const choices = props.choices();
  const condition = props.filter?.condition;
  const [operator, setOperator] = createSignal<TableFilterOperator | 'none'>(
    condition?.operator ?? 'none'
  );
  const [value, setValue] = createSignal(condition?.value ?? '');
  const [value2, setValue2] = createSignal(condition?.value2 ?? '');
  const [search, setSearch] = createSignal('');
  const [shown, setShown] = createSignal(
    new Set(
      choices
        .filter((choice) => choice.shown)
        .map((choice) => choice.value.toLowerCase())
    )
  );
  const matches = createMemo(() => {
    const query = search().trim().toLowerCase();
    return choices.filter(
      (choice) =>
        !query || (choice.value || '(Blanks)').toLowerCase().includes(query)
    );
  });
  const toggle = (choice: string, on: boolean) => {
    const next = new Set(shown());
    if (on) next.add(choice.toLowerCase());
    else next.delete(choice.toLowerCase());
    setShown(next);
  };
  const setMatches = (on: boolean) => {
    const next = new Set(shown());
    for (const choice of matches())
      if (on) next.add(choice.value.toLowerCase());
      else next.delete(choice.value.toLowerCase());
    setShown(next);
  };
  const needsValue = () => !['none', 'empty', 'notEmpty'].includes(operator());
  const needsRange = () =>
    operator() === 'between' || operator() === 'notBetween';

  function apply() {
    const filter: TableColumnFilter = {};
    const op = operator();
    if (op !== 'none')
      filter.condition = {
        operator: op,
        ...(needsValue() && { value: value() }),
        ...(needsRange() && { value2: value2() }),
      };
    const selected = choices.filter((choice) =>
      shown().has(choice.value.toLowerCase())
    );
    if (selected.length < choices.length) {
      filter.values = selected
        .map((choice) => choice.value)
        .filter((choice) => choice !== '');
      if (selected.some((choice) => choice.value === '')) filter.blanks = true;
    }
    props.onApply(filter.condition || filter.values ? filter : undefined);
  }

  return (
    <form
      class="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <Popover.Title class="px-3 pt-3 pb-1 font-medium text-ink">
        Filter “{props.column}”
      </Popover.Title>
      <fieldset class="flex flex-col gap-1.5 px-3 py-2">
        <legend class="mb-1.5 text-ink-extra-muted">By condition</legend>
        <Select<ConditionOption>
          options={CONDITIONS}
          value={CONDITIONS.find((item) => item.value === operator())}
          onChange={(option) => option && setOperator(option.value)}
          optionValue="value"
          optionTextValue="label"
          itemComponent={(item: { item: CollectionNode<ConditionOption> }) => (
            <Select.Item
              item={item.item}
              class="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs outline-none data-highlighted:bg-hover"
            >
              <Select.ItemLabel>{item.item.rawValue.label}</Select.ItemLabel>
              <Select.ItemIndicator>
                <Check class="size-3" />
              </Select.ItemIndicator>
            </Select.Item>
          )}
        >
          <Select.Trigger
            aria-label="Condition"
            class="flex h-7 w-full items-center justify-between rounded-md border border-edge-muted px-2 text-xs text-ink"
          >
            <Select.Value<ConditionOption>>
              {(state) => state.selectedOption().label}
            </Select.Value>
            <CaretDown class="size-3 shrink-0 text-ink-muted" />
          </Select.Trigger>
          <Select.Content class="max-h-72" portalScope="local">
            <Select.Listbox />
          </Select.Content>
        </Select>
        <Show when={needsValue()}>
          <Input
            size="sm"
            aria-label={needsRange() ? 'From' : 'Value'}
            placeholder={needsRange() ? 'From' : 'Value'}
            value={value()}
            onInput={(event) => setValue(event.currentTarget.value)}
          />
        </Show>
        <Show when={needsRange()}>
          <Input
            size="sm"
            aria-label="To"
            placeholder="To"
            value={value2()}
            onInput={(event) => setValue2(event.currentTarget.value)}
          />
        </Show>
      </fieldset>
      <fieldset class="flex min-h-0 flex-col gap-1.5 border-t border-edge-divider px-3 py-2">
        <legend class="sr-only">By values</legend>
        <div class="flex items-center justify-between text-ink-extra-muted">
          <span>By values</span>
          <span class="flex gap-2">
            <button
              type="button"
              class="text-accent hover:underline"
              onClick={() => setMatches(true)}
            >
              Select all
            </button>
            <button
              type="button"
              class="text-accent hover:underline"
              onClick={() => setMatches(false)}
            >
              Clear
            </button>
          </span>
        </div>
        <Input
          size="sm"
          type="search"
          aria-label="Search values"
          placeholder="Search"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
        <div
          role="group"
          aria-label="Values"
          class="flex max-h-52 flex-col overflow-y-auto overscroll-contain"
        >
          <For each={matches().slice(0, MAX_CHOICES)}>
            {(choice) => (
              <Checkbox
                class="flex items-center gap-2 rounded px-1 py-1 hover:bg-hover touch:min-h-[44px]"
                checked={shown().has(choice.value.toLowerCase())}
                onChange={(on) => toggle(choice.value, on)}
              >
                <Checkbox.Control />
                <Checkbox.Label class="truncate">
                  {choice.value || '(Blanks)'}
                </Checkbox.Label>
              </Checkbox>
            )}
          </For>
          <Show when={matches().length > MAX_CHOICES}>
            <p class="px-1 py-1 text-ink-extra-muted">
              Showing the first {MAX_CHOICES} of {matches().length} values.
            </p>
          </Show>
          <Show when={!matches().length}>
            <p class="px-1 py-1 text-ink-extra-muted">No matching values.</p>
          </Show>
        </div>
      </fieldset>
      <div class="flex items-center gap-2 border-t border-edge-divider px-3 py-2">
        <Show when={props.filter}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => props.onApply(undefined)}
          >
            Clear filter
          </Button>
        </Show>
        <div class="ml-auto flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onClose}
          >
            Cancel
          </Button>
          <Button type="submit" variant="strong" size="sm">
            OK
          </Button>
        </div>
      </div>
    </form>
  );
}
