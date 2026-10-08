import type { GoalSeekSolution } from '@macro-inc/spreadsheet/goal-seek';
import X from '@phosphor/x.svg';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';
import { SpreadsheetDialog as Dialog } from './SpreadsheetDialog';

function formatGoalNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: 12,
  }).format(value);
}

export function SpreadsheetGoalSeekDialog(props: {
  open: boolean;
  onClose: () => void;
  onRestoreFocus?: () => void;
  setCell: string;
  onSetCell: (value: string) => void;
  goal: string;
  onGoal: (value: string) => void;
  changingCell: string;
  onChangingCell: (value: string) => void;
  seeking: boolean;
  solution: GoalSeekSolution | undefined;
  message: string;
  onSeek: () => void;
  onApply: () => void;
  onEdit: () => void;
}) {
  const locked = () => props.seeking || !!props.solution;
  return (
    <Dialog
      onRestoreFocus={props.onRestoreFocus}
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-108"
    >
      <form
        class="p-5 text-ink"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.solution) props.onApply();
          else if (!props.seeking) props.onSeek();
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div class="mb-4 flex items-center justify-between">
          <Dialog.Title class="text-sm font-semibold">Goal Seek</Dialog.Title>
          <Button
            type="button"
            label="Close Goal Seek"
            size="icon-sm"
            class="order-last text-ink-muted"
            tabIndex={-1}
            onClick={props.onClose}
          >
            <X class="size-4" />
          </Button>
        </div>
        <Dialog.Description class="mb-4 text-xs text-ink-muted">
          Finds the number in one cell that makes a formula cell reach a value.
        </Dialog.Description>
        <label class="mb-3 block text-xs">
          <span class="mb-1.5 block">Set cell</span>
          <input
            aria-label="Set cell"
            value={props.setCell}
            disabled={locked()}
            onInput={(event) => props.onSetCell(event.currentTarget.value)}
            class="h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent disabled:opacity-40"
          />
        </label>
        <label class="mb-3 block text-xs">
          <span class="mb-1.5 block">To value</span>
          <input
            aria-label="To value"
            value={props.goal}
            disabled={locked()}
            onInput={(event) => props.onGoal(event.currentTarget.value)}
            class="h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent disabled:opacity-40"
          />
        </label>
        <label class="mb-4 block text-xs">
          <span class="mb-1.5 block">By changing cell</span>
          <input
            aria-label="By changing cell"
            value={props.changingCell}
            disabled={locked()}
            onInput={(event) => props.onChangingCell(event.currentTarget.value)}
            class="h-9 w-full touch:h-[44px] touch:text-[max(16px,1rem)] rounded-md border border-edge-muted bg-input px-3 text-sm outline-none focus:border-accent disabled:opacity-40"
          />
        </label>
        <p role="status" class="min-h-10 py-3 text-xs text-ink-muted">
          <Show when={props.seeking}>Seeking a solution…</Show>
          <Show when={props.solution} keyed>
            {(found) =>
              found.status === 'found'
                ? `Goal Seek found a solution. ${found.changeAddress} becomes ${formatGoalNumber(found.value)}, and ${found.setAddress} equals ${formatGoalNumber(found.result)}.`
                : `Goal Seek could not reach the goal. The closest result is ${formatGoalNumber(found.result)} when ${found.changeAddress} is ${formatGoalNumber(found.value)}.`
            }
          </Show>
          <Show when={props.message}>
            {props.seeking || props.solution
              ? ` ${props.message}`
              : props.message}
          </Show>
        </p>
        <div class="flex flex-wrap justify-end gap-2 border-t border-edge-muted pt-3">
          <Show
            when={props.solution}
            fallback={
              <Button
                type="submit"
                size="sm"
                variant="strong"
                disabled={props.seeking}
              >
                {props.seeking ? 'Seeking…' : 'OK'}
              </Button>
            }
          >
            <Button type="button" size="sm" onClick={props.onEdit}>
              Change cells
            </Button>
            <Button type="submit" size="sm" variant="strong">
              {props.solution?.status === 'found' ? 'OK' : 'Use closest value'}
            </Button>
          </Show>
        </div>
      </form>
    </Dialog>
  );
}
