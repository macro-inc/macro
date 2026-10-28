import Check from '@icon/system/regular/check.svg';
import Plus from '@icon/system/regular/plus.svg';
import X from '@icon/system/regular/x.svg';
import {
  DROPDOWN_CHOICE_COLORS,
  type DropdownOptions,
} from '@macro-inc/spreadsheet/data-validation';
import type { DropdownColor } from '@macro-inc/spreadsheet/sheet-rules';
import { Button } from '@ui/components/Button';
import { Dropdown } from '@ui/components/Dropdown';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ChoiceChip } from './ChoiceChip';
import { SpreadsheetDialog } from './SpreadsheetDialog';

const PLACEHOLDERS = ['Not started', 'In progress', 'Done'];

export type DropdownDialogState = {
  /** The cells the dropdown applies to, such as B2:B20. */
  range: string;
  /** The rule already on the active cell, when it is a dropdown. */
  current?: DropdownOptions;
  /** Whether any of the cells has a validation rule to remove. */
  removable: boolean;
};

/** Adds, edits or removes the dropdown of the selected cells. */
export function DropdownDialog(props: {
  dialog: DropdownDialogState | undefined;
  error?: string;
  /** The choices a range offers, or undefined when it is not a range. */
  rangeChoices: (range: string) => string[] | undefined;
  onSave: (options: DropdownOptions) => void;
  onRemove: () => void;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  return (
    <SpreadsheetDialog
      open={!!props.dialog}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      onRestoreFocus={props.onRestoreFocus}
      position="center"
      class="w-96"
    >
      <Show when={props.dialog} keyed>
        {(dialog) => <DropdownForm {...props} dialog={dialog} />}
      </Show>
    </SpreadsheetDialog>
  );
}

/** One color per choice, the first one wins when choices repeat. */
function uniqueColors(
  entries: { item: string; color?: string }[]
): DropdownColor[] {
  const seen = new Set<string>();
  return entries.flatMap(({ item, color }) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return color ? [{ item, color }] : [];
  });
}

type Choice = { id: number; text: string; color?: string };

function DropdownForm(props: {
  dialog: DropdownDialogState;
  error?: string;
  rangeChoices: (range: string) => string[] | undefined;
  onSave: (options: DropdownOptions) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const id = createUniqueId();
  const current = props.dialog.current;
  const stored = new Map(
    current?.colors?.map(({ item, color }) => [item.toLowerCase(), color])
  );
  // A dropdown saved without colors keeps that look until a choice is colored.
  const colorful = (picked: boolean) => !current || stored.size > 0 || picked;
  const [mode, setMode] = createSignal<'items' | 'range'>(
    current && 'range' in current ? 'range' : 'items'
  );
  const [range, setRange] = createSignal(
    current && 'range' in current ? current.range : ''
  );
  const [rejectInvalid, setRejectInvalid] = createSignal(
    current?.rejectInvalid ?? true
  );

  let nextId = 0;
  const inputs = new Map<number, HTMLInputElement>();
  const [choices, setChoices] = createStore<Choice[]>([]);
  const newChoice = (text: string): Choice => {
    if (!colorful(choices.some((choice) => choice.color)))
      return { id: nextId++, text };
    const unused = DROPDOWN_CHOICE_COLORS.find(
      (color) => !choices.some((choice) => choice.color === color.value)
    );
    return {
      id: nextId++,
      text,
      color: (
        unused ??
        DROPDOWN_CHOICE_COLORS[choices.length % DROPDOWN_CHOICE_COLORS.length]
      ).value,
    };
  };
  setChoices(
    current && 'items' in current
      ? current.items.map((text) => ({
          id: nextId++,
          text,
          color: stored.get(text.toLowerCase()),
        }))
      : [newChoice('')]
  );
  function insert(at: number, texts = ['']) {
    let last: Choice | undefined;
    texts.forEach((text, offset) => {
      const choice = newChoice(text);
      setChoices((list) => [
        ...list.slice(0, at + offset),
        choice,
        ...list.slice(at + offset),
      ]);
      last = choice;
    });
    if (last) inputs.get(last.id)?.focus();
  }
  function remove(index: number) {
    const choice = choices[index];
    setChoices((list) => list.filter((entry) => entry.id !== choice.id));
    inputs.delete(choice.id);
    const neighbor = choices[Math.max(0, index - 1)];
    if (neighbor) inputs.get(neighbor.id)?.focus();
  }

  const rangeItems = createMemo(() =>
    mode() === 'range' ? (props.rangeChoices(range().trim()) ?? []) : []
  );
  const [rangePicks, setRangePicks] = createSignal(
    new Map<string, string | undefined>()
  );
  const rangeColor = (item: string, index: number) => {
    const key = item.toLowerCase();
    if (rangePicks().has(key)) return rangePicks().get(key);
    if (stored.has(key)) return stored.get(key);
    if (!colorful([...rangePicks().values()].some(Boolean))) return;
    return DROPDOWN_CHOICE_COLORS[index % DROPDOWN_CHOICE_COLORS.length].value;
  };

  return (
    <form
      class="flex flex-col gap-3 p-5 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (mode() === 'items') {
          const filled = choices
            .map((choice) => ({
              item: choice.text.trim(),
              color: choice.color,
            }))
            .filter((choice) => choice.item);
          props.onSave({
            items: filled.map((choice) => choice.item),
            rejectInvalid: rejectInvalid(),
            colors: uniqueColors(filled),
          });
          return;
        }
        // A value missing from the range for now, such as a cleared cell,
        // keeps its color while the dropdown reads the same range.
        const kept =
          current && 'range' in current && current.range === range().trim()
            ? (current.colors ?? [])
            : [];
        props.onSave({
          range: range().trim(),
          rejectInvalid: rejectInvalid(),
          colors: uniqueColors([
            ...rangeItems().map((item, index) => ({
              item,
              color: rangeColor(item, index),
            })),
            ...kept,
          ]),
        });
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SpreadsheetDialog.Title class="font-semibold">
        Dropdown
      </SpreadsheetDialog.Title>
      <SpreadsheetDialog.Description class="text-ink-muted">
        Cells {props.dialog.range} show an arrow that opens a list of choices.
      </SpreadsheetDialog.Description>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-xs font-medium text-ink-muted">Choices</legend>
        <label class="flex items-center gap-2 touch:min-h-[44px]">
          <input
            type="radio"
            name={`${id}-source`}
            class="touch:size-[20px]"
            checked={mode() === 'items'}
            onChange={() => setMode('items')}
          />
          Type the choices
        </label>
        <label class="flex items-center gap-2 touch:min-h-[44px]">
          <input
            type="radio"
            name={`${id}-source`}
            class="touch:size-[20px]"
            checked={mode() === 'range'}
            onChange={() => setMode('range')}
          />
          Use the values of a range
        </label>
      </fieldset>
      <Show
        when={mode() === 'items'}
        fallback={
          <>
            <input
              aria-label="Range of choices"
              required
              placeholder="A2:A10 or 'Sheet 2'!A2:A10"
              value={range()}
              onInput={(event) => setRange(event.currentTarget.value)}
              class="w-full rounded border border-edge-muted bg-input px-3 py-2 text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
            />
            <Show when={rangeItems().length}>
              <ul
                aria-label="Choices in the range"
                class="flex max-h-48 flex-col gap-1 overflow-y-auto"
              >
                <For each={rangeItems()}>
                  {(item, index) => (
                    <li class="flex min-w-0 items-center gap-2">
                      <ChoiceColorMenu
                        choice={item}
                        color={rangeColor(item, index())}
                        onChange={(color) =>
                          setRangePicks((picks) =>
                            new Map(picks).set(item.toLowerCase(), color)
                          )
                        }
                      />
                      <Show
                        when={rangeColor(item, index())}
                        fallback={<span class="truncate">{item}</span>}
                      >
                        {(color) => (
                          <ChoiceChip color={color()}>{item}</ChoiceChip>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </>
        }
      >
        <ul
          aria-label="Choices"
          class="flex max-h-60 flex-col gap-1.5 overflow-y-auto"
        >
          <For each={choices}>
            {(choice, index) => (
              <li class="flex items-center gap-2">
                <ChoiceColorMenu
                  choice={choice.text.trim() || `choice ${index() + 1}`}
                  color={choice.color}
                  onChange={(color) => setChoices(index(), 'color', color)}
                />
                <input
                  ref={(element) => inputs.set(choice.id, element)}
                  aria-label={`Choice ${index() + 1}`}
                  placeholder={PLACEHOLDERS[index()] ?? 'Choice'}
                  value={choice.text}
                  onInput={(event) =>
                    setChoices(index(), 'text', event.currentTarget.value)
                  }
                  onKeyDown={(event) => {
                    // Enter on a filled choice adds the next one; on an empty
                    // choice it saves the dropdown.
                    if (
                      event.key !== 'Enter' ||
                      event.isComposing ||
                      !choice.text.trim()
                    )
                      return;
                    event.preventDefault();
                    insert(index() + 1);
                  }}
                  onPaste={(event) => {
                    const lines = (
                      event.clipboardData?.getData('text/plain') ?? ''
                    )
                      .split(/\r?\n/)
                      .map((line) => line.trim())
                      .filter(Boolean);
                    if (lines.length < 2) return;
                    event.preventDefault();
                    const at = index();
                    if (!choice.text.trim())
                      setChoices(at, 'text', lines.shift()!);
                    insert(at + 1, lines);
                  }}
                  class="min-w-0 flex-1 rounded border border-edge-muted bg-input px-3 py-1.5 text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  label={`Remove choice ${index() + 1}`}
                  disabled={choices.length === 1}
                  onClick={() => remove(index())}
                >
                  <X />
                </Button>
              </li>
            )}
          </For>
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class="self-start"
          onClick={() => insert(choices.length)}
        >
          <Plus />
          Add choice
        </Button>
      </Show>
      <label class="flex items-center gap-2 text-xs text-ink-muted touch:min-h-[44px]">
        <input
          type="checkbox"
          class="touch:size-[20px]"
          checked={rejectInvalid()}
          onChange={(event) => setRejectInvalid(event.currentTarget.checked)}
        />
        Reject values that are not a choice
      </label>
      <Show when={props.error}>
        {(error) => (
          <p role="alert" class="text-xs text-failure">
            {error()}
          </p>
        )}
      </Show>
      <div class="mt-1 flex items-center gap-2">
        <Show when={props.dialog.removable}>
          <Button variant="ghost" type="button" onClick={props.onRemove}>
            Remove
          </Button>
        </Show>
        <div class="ml-auto flex gap-2">
          <Button variant="ghost" type="button" onClick={props.onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="strong">
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

function ChoiceColorMenu(props: {
  choice: string;
  color?: string;
  onChange: (color: string | undefined) => void;
}) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="ghost"
        size="icon-sm"
        label={`Color of ${props.choice}`}
        class="shrink-0"
      >
        <span
          data-choice-color={props.color ?? ''}
          class="size-4 rounded-full border border-edge-muted"
          style={{ 'background-color': props.color ?? 'transparent' }}
        />
      </Dropdown.Trigger>
      <Dropdown.Content class="text-sm">
        <Dropdown.Group>
          <Dropdown.Item
            closeOnSelect
            onSelect={() => props.onChange(undefined)}
            class="h-8 gap-2 touch:h-auto touch:min-h-[44px]"
          >
            <span class="flex size-3.5 items-center text-accent">
              <Show when={!props.color}>
                <Check class="size-3.5" />
              </Show>
            </span>
            No color
          </Dropdown.Item>
          <div class="grid grid-cols-5 gap-1 p-1.5">
            <For each={DROPDOWN_CHOICE_COLORS}>
              {(color) => (
                <Dropdown.Item
                  closeOnSelect
                  aria-label={color.name}
                  title={color.name}
                  textValue={color.name}
                  onSelect={() => props.onChange(color.value)}
                  class="size-6 justify-center rounded-full border border-edge-muted p-0 touch:size-[44px] data-highlighted:ring-2 data-highlighted:ring-accent"
                  style={{ 'background-color': color.value }}
                >
                  <Show when={props.color === color.value}>
                    <Check class="size-3.5 rounded-sm bg-menu text-ink" />
                  </Show>
                </Dropdown.Item>
              )}
            </For>
          </div>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
