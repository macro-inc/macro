import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
} from '@app/features/calendar/components/composer/event-form-model';
import { useEventEditor } from '@app/features/calendar/hooks/use-event-editor';
import type { CalendarEvent } from '@app/features/calendar/types';
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { type Accessor, createMemo, onMount, Show } from 'solid-js';

/** Standalone create/edit event composer hosted in a popover split. */
type EventComposerSplitProps = {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveSuccess?: () => void;
};

export function EventComposerSplit(props: EventComposerSplitProps) {
  const quickCalls = useQuickCallsFlag();
  const ready = createMemo(
    (resolved) => resolved || !quickCalls().loading,
    false
  );
  return (
    <Show
      when={ready()}
      fallback={
        <p role="status" class="p-4">
          Loading event…
        </p>
      }
    >
      <EventComposerContent
        {...props}
        macroCallsEnabled={() => quickCalls().enabled && !quickCalls().loading}
      />
    </Show>
  );
}

function EventComposerContent(
  props: EventComposerSplitProps & {
    macroCallsEnabled: Accessor<boolean>;
  }
) {
  const panel = useSplitPanelOrThrow();
  const macroCallsEnabled = props.macroCallsEnabled;
  const [attachHotkeys] = useHotkeyDOMScope('event-composer', true);
  const close = () => panel.handle.close();
  const editor = useEventEditor({
    event: () => props.event,
    macroCallsEnabled,
    onSaved: () => {
      props.onSaveSuccess?.();
      close();
    },
  });
  const isEdit = () => props.event !== undefined;

  const initialValues =
    editor.initialValues() ??
    props.initialValues ??
    defaultEditorInitialValues(new Date(), macroCallsEnabled());
  const controller = createCalendarEventFormController({
    initialValue:
      !isEdit() && initialValues.conference === 'macro' && !macroCallsEnabled()
        ? { ...initialValues, conference: 'none' }
        : initialValues,
    isEdit: isEdit(),
    calendarOptions: editor.calendarOptions,
    guestOptions: editor.guestOptions,
  });

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
        macroCallsEnabled={macroCallsEnabled()}
        isEdit={isEdit() || editor.eventCreated()}
        saveError={editor.saveError()}
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
