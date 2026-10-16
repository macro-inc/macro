import { Button } from '@ui/components/Button';
import { Result } from 'neverthrow';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { format as formatExcelNumber } from 'ssf';
import { dateFormatStyle } from '../core/cell-dates';
import type { SpreadsheetCellStyle } from '../core/spreadsheet-document';
import { SpreadsheetDialog } from './SpreadsheetDialog';

/** Thursday, 17 September 2026, 2:30 PM. */
const SAMPLE_DATE = 46_282 + 14.5 / 24;
const formatSample = Result.fromThrowable(
  (code: string, sample: number) => formatExcelNumber(code, sample),
  () => 'unsupported format' as const
);

const CODES = [
  ['d  dd', 'Day: 7, 07'],
  ['ddd  dddd', 'Weekday: Thu, Thursday'],
  ['m  mm  mmm  mmmm', 'Month: 9, 09, Sep, September'],
  ['yy  yyyy', 'Year: 26, 2026'],
  ['h  hh', 'Hour'],
  ['mm  ss', 'Minutes (after h), seconds'],
  ['AM/PM', '12-hour clock'],
  ['"text"', 'Text shown as written'],
] as const;

export type DateFormatDialogState = {
  /** The cells the format applies to, such as B2:B20. */
  range: string;
  /** The format code the dialog starts with. */
  numberFormat: string;
  /** The active cell's number, which the preview shows. */
  sample?: number;
};

/** Applies a custom Excel date or time format code to the selected cells. */
export function DateFormatDialog(props: {
  dialog: DateFormatDialogState | undefined;
  onSave: (style: SpreadsheetCellStyle) => void;
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
        {(dialog) => <DateFormatForm {...props} dialog={dialog} />}
      </Show>
    </SpreadsheetDialog>
  );
}

function DateFormatForm(props: {
  dialog: DateFormatDialogState;
  onSave: (style: SpreadsheetCellStyle) => void;
  onClose: () => void;
}) {
  const [code, setCode] = createSignal(props.dialog.numberFormat);
  const style = createMemo(() => dateFormatStyle(code().trim()));
  const preview = createMemo(() =>
    style()
      ? formatSample(
          code().trim(),
          props.dialog.sample ?? SAMPLE_DATE
        ).unwrapOr(undefined)
      : undefined
  );
  return (
    <form
      class="flex flex-col gap-3 p-5 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const chosen = style();
        if (chosen && preview()) props.onSave(chosen);
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SpreadsheetDialog.Title class="font-semibold">
        Custom date and time format
      </SpreadsheetDialog.Title>
      <SpreadsheetDialog.Description class="text-ink-muted">
        Cells {props.dialog.range} show their dates and times with this Excel
        format code.
      </SpreadsheetDialog.Description>
      <input
        aria-label="Format code"
        required
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        value={code()}
        onInput={(event) => setCode(event.currentTarget.value)}
        class="w-full rounded border border-edge-muted bg-input px-3 py-2 font-mono text-ink outline-none focus:border-accent touch:text-[max(16px,1rem)]"
      />
      <p role="status" class="min-h-5 text-xs">
        <Show
          when={preview()}
          fallback={
            <span class="text-failure">
              Use date or time codes, such as mmm d, yyyy or h:mm AM/PM.
            </span>
          }
        >
          {(shown) => (
            <span class="text-ink-muted">
              Preview: <span class="text-ink">{shown()}</span>
            </span>
          )}
        </Show>
      </p>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-ink-muted">
        <For each={CODES}>
          {([codes, meaning]) => (
            <>
              <dt class="whitespace-pre font-mono text-ink">{codes}</dt>
              <dd>{meaning}</dd>
            </>
          )}
        </For>
      </dl>
      <div class="mt-1 flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={props.onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="strong" disabled={!preview()}>
          Apply
        </Button>
      </div>
    </form>
  );
}
