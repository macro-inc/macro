import { Button } from '@ui/components/Button';
import { createUniqueId, For, Show } from 'solid-js';
import type { WorkbookFileData } from '../core/workbook-file-types';
import { SpreadsheetDialog as Dialog } from './SpreadsheetDialog';

export function SpreadsheetSheetDialog(props: {
  dialog: { kind: 'rename' | 'delete'; name: string } | undefined;
  name: string;
  onName: (name: string) => void;
  error: string;
  readonly: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  const errorId = createUniqueId();
  const canConfirm = () =>
    !props.readonly &&
    !!props.dialog &&
    (props.dialog.kind === 'delete' || !!props.name.trim());
  return (
    <Dialog
      onRestoreFocus={props.onRestoreFocus}
      open={!!props.dialog}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-96"
    >
      <form
        class="p-5 text-ink"
        onKeyDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (canConfirm()) props.onConfirm();
        }}
      >
        <Dialog.Title class="mb-2 text-sm font-semibold">
          {props.dialog?.kind === 'delete' ? 'Delete sheet?' : 'Rename sheet'}
        </Dialog.Title>
        <Dialog.Description class="mb-4 text-sm text-ink-muted">
          {props.dialog?.kind === 'delete'
            ? `Delete “${props.dialog.name}” and its contents? You can undo this change.`
            : 'Choose a unique name for this sheet.'}
        </Dialog.Description>
        <Show when={props.dialog?.kind === 'rename'}>
          <input
            aria-label="Sheet name"
            aria-invalid={!!props.error}
            aria-describedby={props.error ? errorId : undefined}
            class="h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent"
            value={props.name}
            maxLength={31}
            disabled={props.readonly}
            onInput={(event) => props.onName(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Show>
        <Show when={props.error}>
          <p id={errorId} role="alert" class="mt-3 text-xs text-failure">
            {props.error}
          </p>
        </Show>
        <div class="mt-5 flex justify-end gap-2">
          <Button size="sm" type="button" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={props.dialog?.kind === 'delete' ? 'danger' : 'accent'}
            type="submit"
            disabled={!canConfirm()}
          >
            {props.dialog?.kind === 'delete' ? 'Delete sheet' : 'Save name'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function SpreadsheetImportDialog(props: {
  preview: { name: string; data: WorkbookFileData } | undefined;
  mode: 'append' | 'replace';
  onMode: (mode: 'append' | 'replace') => void;
  error: string;
  readonly: boolean;
  onConfirm: () => void;
  onClose: () => void;
  onRestoreFocus?: () => void;
}) {
  const modeName = createUniqueId();
  const errorId = createUniqueId();
  return (
    <Dialog
      onRestoreFocus={props.onRestoreFocus}
      open={!!props.preview}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-120 max-w-[calc(100vw-2rem)]"
    >
      <div class="p-5 text-ink" onKeyDown={(event) => event.stopPropagation()}>
        <Dialog.Title class="mb-2 text-sm font-semibold">
          Import Excel workbook
        </Dialog.Title>
        <Dialog.Description class="mb-4 break-words text-sm text-ink-muted">
          {props.preview?.name}
        </Dialog.Description>
        <div class="mb-4 max-h-36 overflow-y-auto rounded-md border border-edge-muted">
          <For each={props.preview?.data.sheets}>
            {(sheet) => (
              <div class="flex justify-between gap-4 border-b border-edge-muted px-3 py-2 text-xs last:border-0">
                <span class="min-w-0 break-all font-medium">{sheet.name}</span>
                <span class="shrink-0 text-ink-muted">
                  {Object.keys(sheet.cells).length.toLocaleString()} cells
                </span>
              </div>
            )}
          </For>
        </div>
        <Show when={props.preview?.data.warnings.length}>
          <div class="mb-4 max-h-40 overflow-y-auto rounded-md bg-panel p-3 text-xs text-ink-muted">
            <p class="mb-2 font-medium text-ink">Review before importing</p>
            <ul class="list-disc space-y-1 break-words pl-4">
              <For each={props.preview?.data.warnings}>
                {(warning) => <li>{warning}</li>}
              </For>
            </ul>
          </div>
        </Show>
        <fieldset
          class="space-y-3 text-sm"
          disabled={props.readonly}
          aria-describedby={props.error ? errorId : undefined}
        >
          <legend class="mb-3 text-xs font-medium text-ink-muted">
            Import location
          </legend>
          <label class="flex items-start gap-2 touch:min-h-[44px]">
            <input
              type="radio"
              name={modeName}
              class="mt-1 touch:size-[20px] touch:shrink-0"
              checked={props.mode === 'append'}
              onChange={() => props.onMode('append')}
            />
            <span>
              Insert new sheets
              <span class="mt-0.5 block text-xs text-ink-muted">
                Keep existing sheets. Imported sheet names must be unique.
              </span>
            </span>
          </label>
          <label class="flex items-start gap-2 touch:min-h-[44px]">
            <input
              type="radio"
              name={modeName}
              class="mt-1 touch:size-[20px] touch:shrink-0"
              checked={props.mode === 'replace'}
              onChange={() => props.onMode('replace')}
            />
            <span>
              Replace workbook
              <span class="mt-0.5 block text-xs text-ink-muted">
                Replace all existing sheets. You can undo the import.
              </span>
            </span>
          </label>
        </fieldset>
        <Show when={props.error}>
          <p id={errorId} role="alert" class="mt-3 text-xs text-failure">
            {props.error}
          </p>
        </Show>
        <div class="mt-5 flex justify-end gap-2">
          <Button size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="accent"
            disabled={props.readonly}
            onClick={props.onConfirm}
          >
            Import workbook
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
