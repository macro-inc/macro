import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { onMount } from 'solid-js';
import { EventComposerForm } from './EventComposerForm';
import { useEventEditor } from './useEventEditor';

/** Standalone create-event composer hosted in a popover split. */
export function EventComposer() {
  const panel = useSplitPanelOrThrow();
  const close = () => panel.handle.close();
  const editor = useEventEditor({
    event: () => undefined,
    onSaved: close,
  });

  onMount(() => panel.handle.setDisplayName('New event'));

  return (
    <div class="portal-scope flex h-full min-h-0 flex-col gap-3 p-4 text-ink">
      <div class="flex shrink-0 items-center justify-end">
        <Button
          aria-label="Close new event composer"
          variant="ghost"
          size="icon-sm"
          disabled={editor.pending()}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>

      <EventComposerForm
        calendarOptions={editor.calendarOptions()}
        guestOptions={editor.guestOptions}
        pending={editor.pending()}
        onCancel={close}
        onSubmit={editor.save}
      />
    </div>
  );
}
