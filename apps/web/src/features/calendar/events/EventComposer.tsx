import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import XIcon from '@phosphor/x.svg';
import { Button } from '@ui';
import { onMount } from 'solid-js';
import { EventComposerForm } from './EventComposerForm';
import type { CalendarEvent } from './types';
import { useEventEditor } from './useEventEditor';

/** Standalone create/edit event composer hosted in a popover split. */
export function EventComposer(props: { event?: CalendarEvent }) {
  const panel = useSplitPanelOrThrow();
  const close = () => panel.handle.close();
  const editor = useEventEditor({
    event: () => props.event,
    onSaved: close,
  });

  const isEdit = () => props.event !== undefined;

  onMount(() =>
    panel.handle.setDisplayName(isEdit() ? 'Edit event' : 'New event')
  );

  return (
    <div class="portal-scope flex h-full min-h-0 flex-col gap-4 p-4 text-ink">
      <div class="flex shrink-0 items-center justify-end">
        <Button
          aria-label={
            isEdit() ? 'Close event editor' : 'Close new event composer'
          }
          variant="ghost"
          size="icon-sm"
          disabled={editor.pending()}
          onClick={close}
        >
          <XIcon />
        </Button>
      </div>

      <EventComposerForm
        initialValues={editor.initialValues()}
        disabledFields={editor.disabledFields}
        calendarOptions={editor.calendarOptions()}
        guestOptions={editor.guestOptions}
        showRecurringEditNotice={editor.showRecurringEditNotice()}
        attendees={props.event?.attendees}
        pending={editor.pending()}
        onCancel={close}
        onSubmit={editor.save}
      />
    </div>
  );
}
