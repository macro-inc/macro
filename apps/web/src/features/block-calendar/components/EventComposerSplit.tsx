import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
} from '@app/features/calendar/components/composer/event-form-model';
import { useEventEditor } from '@app/features/calendar/hooks/use-event-editor';
import type { CalendarEvent } from '@app/features/calendar/types';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { onMount } from 'solid-js';

/** Standalone create/edit event composer hosted in a popover split. */
export function EventComposerSplit(props: {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveSuccess?: () => void;
}) {
  const panel = useSplitPanelOrThrow();
  const [attachHotkeys] = useHotkeyDOMScope('event-composer', true);
  const close = () => panel.handle.close();
  const editor = useEventEditor({
    event: () => props.event,
    onSaved: () => {
      props.onSaveSuccess?.();
      close();
    },
  });
  const controller = createCalendarEventFormController({
    initialValue:
      editor.initialValues() ??
      props.initialValues ??
      defaultEditorInitialValues(),
    calendarOptions: editor.calendarOptions,
    guestOptions: editor.guestOptions,
  });

  const isEdit = () => props.event !== undefined;

  onMount(() =>
    panel.handle.setDisplayName(isEdit() ? 'Edit event' : 'New event')
  );

  return (
    <div
      ref={attachHotkeys}
      class="portal-scope flex h-full min-h-0 flex-col p-4 text-ink"
    >
      <EventForm
        controller={controller}
        isEdit={isEdit()}
        disabledFields={editor.disabledFields()}
        showRecurringEditNotice={editor.showRecurringEditNotice()}
        pending={editor.pending()}
        onCalendarChange={props.onCalendarChange}
        onDirtyChange={props.onDirtyChange}
        onCancel={close}
        onSubmit={editor.save}
      />
    </div>
  );
}
