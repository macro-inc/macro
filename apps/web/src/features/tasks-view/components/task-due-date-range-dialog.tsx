import { Button } from '@ui/components/Button';
import { DatePicker } from '@ui/components/DatePicker';
import { Dialog } from '@ui/components/Dialog';
import { createUniqueId } from 'solid-js';

export type TaskDateRangeDraft = {
  field: 'due' | 'start';
  start: string;
  end: string;
};

const COPY = {
  due: {
    title: 'Due date range',
    description: 'Include tasks due on these dates.',
    name: 'Due date',
  },
  start: {
    title: 'Start date range',
    description: 'Include tasks starting on these dates.',
    name: 'Start date',
  },
};

export function TaskDueDateRangeDialog(props: {
  value: TaskDateRangeDraft | undefined;
  onChange(value: TaskDateRangeDraft | undefined): void;
  onApply(): void;
}) {
  const titleId = createUniqueId();
  const copy = () => COPY[props.value?.field ?? 'due'];
  const change = (range: { start: string; end: string }) =>
    props.onChange({ field: props.value?.field ?? 'due', ...range });
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
          {copy().title}
        </Dialog.Title>
        <p class="text-sm text-ink-muted">
          {copy().description} Leave either end empty for an open-ended range.
        </p>
        <div class="grid grid-cols-2 gap-3">
          <label class="flex flex-col gap-1 text-sm">
            From
            <DatePicker
              aria-label={`${copy().name} from`}
              value={props.value?.start ?? ''}
              max={props.value?.end || undefined}
              onChange={(start) =>
                change({ start, end: props.value?.end ?? '' })
              }
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            Through
            <DatePicker
              aria-label={`${copy().name} through`}
              value={props.value?.end ?? ''}
              min={props.value?.start || undefined}
              onChange={(end) =>
                change({ start: props.value?.start ?? '', end })
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
