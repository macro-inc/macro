import type { DropdownOptions } from '@macro-inc/spreadsheet/data-validation';
import { Button } from '@ui/components/Button';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { SpreadsheetDialog } from './SpreadsheetDialog';

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

function DropdownForm(props: {
  dialog: DropdownDialogState;
  error?: string;
  onSave: (options: DropdownOptions) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const id = createUniqueId();
  const current = props.dialog.current;
  const [mode, setMode] = createSignal<'items' | 'range'>(
    current && 'range' in current ? 'range' : 'items'
  );
  const [items, setItems] = createSignal(
    current && 'items' in current ? current.items.join('\n') : ''
  );
  const [range, setRange] = createSignal(
    current && 'range' in current ? current.range : ''
  );
  const [rejectInvalid, setRejectInvalid] = createSignal(
    current?.rejectInvalid ?? true
  );
  return (
    <form
      class="flex flex-col gap-3 p-5 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(
          mode() === 'items'
            ? {
                items: items()
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean),
                rejectInvalid: rejectInvalid(),
              }
            : { range: range().trim(), rejectInvalid: rejectInvalid() }
        );
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
          <input
            aria-label="Range of choices"
            required
            placeholder="A2:A10 or 'Sheet 2'!A2:A10"
            value={range()}
            onInput={(event) => setRange(event.currentTarget.value)}
            class="w-full rounded border border-edge-muted bg-input px-3 py-2 text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
          />
        }
      >
        <textarea
          aria-label="Choices, one per line"
          required
          rows={5}
          placeholder={'Not started\nIn progress\nDone'}
          value={items()}
          onInput={(event) => setItems(event.currentTarget.value)}
          class="w-full resize-y rounded border border-edge-muted bg-input px-3 py-2 text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
        />
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
