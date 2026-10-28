import ArrowLeft from '@icon/system/regular/arrow-left.svg';
import Info from '@icon/system/regular/info.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function AvailabilityTopBar(props: {
  editing: boolean;
  creating: boolean;
  disabled: boolean;
  onBack: () => void;
}) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <Show when={props.editing}>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Back to availability"
          disabled={props.disabled}
          onClick={props.onBack}
        >
          <ArrowLeft class="size-4" />
        </Button>
      </Show>
      <div class="flex min-w-0 items-center gap-1">
        <h1 class="min-w-0 truncate pl-2 text-sm font-semibold">
          {props.editing
            ? props.creating
              ? 'Create schedule'
              : 'Edit schedule'
            : 'Availability'}
        </h1>
        <Show when={!props.editing}>
          <Button
            variant="ghost"
            size="icon-sm"
            label="About availability"
            tooltip="Set your available hours and make exceptions for specific dates."
          >
            <Info class="size-4 text-ink-muted" />
          </Button>
        </Show>
      </div>
    </div>
  );
}
