import { Button } from '@ui/components/Button';
import { DatePicker } from '@ui/components/DatePicker';
import { Dialog } from '@ui/components/Dialog';
import { createUniqueId } from 'solid-js';

export function TaskDeadlineMoveDialog(props: {
  picker:
    | { label: string; value: string; min?: string; max?: string }
    | undefined;
  onChange(value: string): void;
  onApply(): void;
  onCancel(): void;
}) {
  const titleId = createUniqueId();
  return (
    <Dialog
      open={!!props.picker}
      onOpenChange={(open) => !open && props.onCancel()}
      class="max-w-sm"
      position="center"
    >
      <div class="flex flex-col gap-4 p-5">
        <Dialog.Title id={titleId} class="text-base font-medium">
          Reschedule task
        </Dialog.Title>
        <p class="text-sm text-ink-muted">
          Choose a due date in {props.picker?.label}.
        </p>
        <DatePicker
          aria-label="New task due date"
          required
          value={props.picker?.value ?? ''}
          min={props.picker?.min}
          max={props.picker?.max}
          onChange={props.onChange}
        />
        <div class="flex justify-end gap-2">
          <Button onClick={props.onCancel}>Cancel</Button>
          <Button
            variant="accent"
            disabled={!props.picker?.value}
            onClick={props.onApply}
          >
            Apply
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
