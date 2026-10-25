import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
} from '@app/features/calendar/components/composer/event-form-model';
import { useCalendarGuestInvitesFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { useEventEditor } from '@app/features/calendar/hooks/use-event-editor';
import { useSyncedCalendarEvent } from '@app/features/calendar/hooks/use-synced-calendar-event';
import type { CalendarEvent } from '@app/features/calendar/types';
import { viewerReplacesGuests } from '@app/features/calendar/utils/event-guest-editing';
import { EventReplacementAction } from '@app/features/calendar/views/event-replacement';
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
    guestInvitesEnabled: useCalendarGuestInvitesFlag(),
    syncedEvent: useSyncedCalendarEvent(() => props.event),
    onDetailsLocked: () => controller.resetDetails(),
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
    <div ref={attachHotkeys} class="flex h-full min-h-0 flex-col p-4 text-ink">
      <EventForm
        controller={controller}
        macroCallsEnabled={macroCallsEnabled()}
        isEdit={isEdit()}
        saveError={editor.saveError()}
        disabledFields={editor.disabledFields()}
        addOnlyGuests={editor.addOnlyGuests()}
        guestsReadOnlyReason={editor.guestsReadOnlyReason()}
        guestListHidden={editor.guestListHidden()}
        guestPolicyEditable={editor.guestPolicyEditable()}
        detailsReadOnlyReason={editor.detailsReadOnlyReason()}
        showRecurringEditNotice={editor.showRecurringEditNotice()}
        pending={editor.pending()}
        onCalendarChange={props.onCalendarChange}
        onDirtyChange={props.onDirtyChange}
        onCancel={close}
        onSubmit={editor.save}
      />
      <Show
        when={
          props.event?.calendar.provider === 'outlook' &&
          props.event &&
          !props.event.isCancelled &&
          viewerReplacesGuests(props.event)
            ? props.event
            : undefined
        }
      >
        {(event) => (
          <EventReplacementAction
            target={{
              eventId: event().eventId,
              calendarId: event().calendarId,
              recurrenceId: event().recurrenceId,
            }}
            hasConference={
              event().conferenceUrl !== undefined &&
              event().conferenceProvider !== undefined
            }
            recurring={
              event().recurrenceLines.length > 0 ||
              event().recurrenceId !== undefined
            }
            disabled={controller.isDirty() || editor.pending()}
            onDone={() => {
              props.onSaveSuccess?.();
              close();
            }}
          />
        )}
      </Show>
    </div>
  );
}
