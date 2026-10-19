import ArrowLeft from '@phosphor/arrow-left.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';

export function ScheduleEditorForm(props: {
  saving: boolean;
  editingRange: boolean;
  error: string;
  topBarOwned?: boolean;
  creating?: boolean;
  children: JSX.Element;
  onSubmit: (event: SubmitEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form class="flex min-h-0 flex-1 flex-col gap-4" onSubmit={props.onSubmit}>
      <Show when={!props.topBarOwned}>
        <header class="flex shrink-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon-md"
            label="Back to availability"
            disabled={props.saving}
            onClick={props.onCancel}
          >
            <ArrowLeft class="size-5" />
          </Button>
          <h1 class="text-lg font-semibold">
            {props.creating ? 'Create schedule' : 'Edit schedule'}
          </h1>
        </header>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="text-sm text-failure">
          {props.error}
        </p>
      </Show>
      {props.children}
      <footer class="flex shrink-0 items-center justify-end gap-3 border-t border-edge-muted bg-panel py-3">
        <Button
          variant="ghost"
          disabled={props.saving}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          data-save-schedule
          type="submit"
          variant="cta"
          disabled={props.saving || props.editingRange}
        >
          {props.saving ? 'Saving…' : 'Save schedule'}
        </Button>
      </footer>
    </form>
  );
}
