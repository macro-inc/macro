import { Button } from '@ui/components/Button';
import { DatePicker } from '@ui/components/DatePicker';
import { Dialog } from '@ui/components/Dialog';
import { createUniqueId } from 'solid-js';

export type TaskDateRangeDraft = { start: string; end: string };

export function TaskDueDateRangeDialog(props: {
  value: TaskDateRangeDraft | undefined;
  onChange(value: TaskDateRangeDraft | undefined): void;
  onApply(): void;
}) {
  const titleId = createUniqueId();
  const valid = () =>
    props.value &&
    Boolean(props.value.start || props.value.end) &&
    (!props.value.start ||
      !props.value.end ||
      props.value.start <= props.value.end);
  return (
    <Dialog
      open={!!props.value}
      onOpenChange={(open) => !open && props.onChange(undefined)}
      class="max-w-md"
      position="center"
    >
      <div class="flex flex-col gap-4 p-5">
        <Dialog.Title id={titleId} class="text-base font-medium">
          Due date range
        </Dialog.Title>
        <p class="text-sm text-ink-muted">
          Include tasks due on these dates. Leave either end empty for an
          open-ended range.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1 text-sm">
            From
            <DatePicker
              aria-label="Due date from"
              value={props.value?.start ?? ''}
              max={props.value?.end || undefined}
              onChange={(start) =>
                props.onChange({ start, end: props.value?.end ?? '' })
              }
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            Through
            <DatePicker
              aria-label="Due date through"
              value={props.value?.end ?? ''}
              min={props.value?.start || undefined}
              onChange={(end) =>
                props.onChange({ start: props.value?.start ?? '', end })
              }
            />
          </label>
        </div>
        <div class="flex justify-end gap-2">
          <Button onClick={() => props.onChange(undefined)}>Cancel</Button>
          <Button variant="accent" disabled={!valid()} onClick={props.onApply}>
            Apply
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
