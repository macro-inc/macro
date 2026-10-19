import { Button } from '@ui/components/Button';
import { createSignal, Show } from 'solid-js';
import type { TableDialogInput, TableDialogState } from '../core/table-types';
import { SpreadsheetDialog } from './SpreadsheetDialog';

/** Renames a table, or changes the cells it covers. */
export function TableDialog(props: {
  dialog: TableDialogState | undefined;
  error?: string;
  onSave: (input: TableDialogInput) => void;
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
        {(dialog) => <TableForm {...props} dialog={dialog} />}
      </Show>
    </SpreadsheetDialog>
  );
}

function TableForm(props: {
  dialog: TableDialogState;
  error?: string;
  onSave: (input: TableDialogInput) => void;
  onClose: () => void;
}) {
  const dialog = props.dialog;
  const [text, setText] = createSignal(
    dialog.kind === 'rename' ? dialog.name : dialog.range
  );
  return (
    <form
      class="flex flex-col gap-3 p-5 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(
          dialog.kind === 'rename'
            ? { kind: 'rename', name: text() }
            : { kind: 'range', range: text().trim() }
        );
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SpreadsheetDialog.Title class="font-semibold">
        {dialog.kind === 'rename' ? 'Rename table' : 'Adjust table range'}
      </SpreadsheetDialog.Title>
      <SpreadsheetDialog.Description class="text-ink-muted">
        {dialog.kind === 'rename'
          ? 'Formulas that use the table follow its new name. Spaces become underscores.'
          : 'The first row of the range is the header row. Filters and column types follow their columns.'}
      </SpreadsheetDialog.Description>
      <label class="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        {dialog.kind === 'rename' ? 'Table name' : 'Range'}
        <input
          required
          value={text()}
          placeholder={dialog.kind === 'rename' ? 'Table1' : 'A1:D20'}
          aria-invalid={!!props.error}
          onInput={(event) => setText(event.currentTarget.value)}
          class="w-full rounded border border-edge-muted bg-input px-3 py-2 text-sm font-normal text-ink outline-none placeholder:text-ink-placeholder focus:border-accent aria-invalid:border-failure"
        />
      </label>
      <Show when={props.error}>
        {(error) => (
          <p role="alert" class="text-xs text-failure">
            {error()}
          </p>
        )}
      </Show>
      <div class="mt-1 flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={props.onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="strong">
          Save
        </Button>
      </div>
    </form>
  );
}
