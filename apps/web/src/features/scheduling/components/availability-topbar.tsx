import { ViewSidebar } from '@app/components/view-shell';
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
          aria-label="Back to availability"
          tooltip="Back to availability"
          variant="ghost"
          size="icon-sm"
          disabled={props.disabled}
          onClick={props.onBack}
        >
          <ArrowLeft class="size-4" />
        </Button>
      </Show>
      <div class="flex min-w-0 items-center gap-1">
        <ViewSidebar.Title caret={false} class="pl-2">
          {props.editing
            ? props.creating
              ? 'Create schedule'
              : 'Edit schedule'
            : 'Availability'}
        </ViewSidebar.Title>
        <Show when={!props.editing}>
          <Button
            aria-label="About availability"
            variant="ghost"
            size="icon-sm"
            tooltip="Set your available hours and make exceptions for specific dates."
          >
            <Info class="size-4 text-ink-muted" />
          </Button>
        </Show>
      </div>
    </div>
  );
}
