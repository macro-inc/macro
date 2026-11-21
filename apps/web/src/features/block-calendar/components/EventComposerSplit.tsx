import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { EventForm } from '@app/features/calendar/components/composer/EventForm';
import {
  defaultEditorInitialValues,
  type EventEditorInitialValues,
} from '@app/features/calendar/components/composer/event-form-model';
import type { EventFormProps } from '@app/features/calendar/components/composer/event-form-state';
import { MobileEventForm } from '@app/features/calendar/components/composer/MobileEventForm';
import { createGuestInviteController } from '@app/features/calendar/hooks/create-guest-invite-controller';
import {
  useCalendarGuestInvitesFlag,
  useCalendarInvitationForwardFlag,
} from '@app/features/calendar/hooks/use-calendar-ui-flag';
import {
  type CreatedCalendarEvent,
  useEventEditor,
} from '@app/features/calendar/hooks/use-event-editor';
import { useSyncedCalendarEvent } from '@app/features/calendar/hooks/use-synced-calendar-event';
import type { CalendarEvent } from '@app/features/calendar/types';
import { viewerReplacesGuests } from '@app/features/calendar/utils/event-guest-editing';
import { useCalendarPreferences } from '@app/features/calendar/utils/preferences';
import {
  EventReplacement,
  useEventReplacement,
} from '@app/features/calendar/views/event-replacement';
import { EventForwardInvitationAction } from '@app/features/calendar-view/components/EventGuests';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { Spinner } from '@ui';
import {
  type Accessor,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';

/**
 * Forward invitation beside a guest list the viewer cannot add to, as the
 * event details offer it there.
 */
function EditorForwardInvitation(props: {
  event: CalendarEvent;
  guestInvitesEnabled: Accessor<boolean>;
  forwardEnabled: Accessor<boolean>;
}) {
  const invites = createGuestInviteController(
    () => props.event,
    props.guestInvitesEnabled,
    props.forwardEnabled
  );
  return (
    <Show when={invites.canForward()}>
      <EventForwardInvitationAction event={props.event} invites={invites} />
    </Show>
  );
}

/** The touch sheet's layout wherever the panel offers the sheet's pinned chrome. */
function PanelEventForm(props: EventFormProps) {
  const panel = useSplitPanelOrThrow();
  return (
    <Show when={panel.drawerHeader?.()} fallback={<EventForm {...props} />}>
      {(headerMount) => (
        <MobileEventForm {...props} headerMount={headerMount()} />
      )}
    </Show>
  );
}

/** Standalone create/edit event composer hosted in a popover split. */
type EventComposerSplitProps = {
  event?: CalendarEvent;
  initialValues?: EventEditorInitialValues;
  /** Values that arrive after the composer opens, applied only to an untouched form. */
  suggestedValues?: Promise<Partial<EventEditorInitialValues>>;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSaveSuccess?: () => void;
  /** Called with a new event once it exists, before the composer closes. */
  onCreated?: (created: CreatedCalendarEvent) => void;
};

export function EventComposerSplit(props: EventComposerSplitProps) {
  return <EventComposerContent {...props} macroCallsEnabled={() => true} />;
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
  const guestInvitesEnabled = useCalendarGuestInvitesFlag();
  const invitationForwardEnabled = useCalendarInvitationForwardFlag();
  const [preferences] = useCalendarPreferences();
  const editor = useEventEditor({
    event: () => props.event,
    macroCallsEnabled,
    guestInvitesEnabled,
    invitationForwardEnabled,
    syncedEvent: useSyncedCalendarEvent(() => props.event),
    onDetailsLocked: () => controller.resetDetails(),
    onCreated: (created) => props.onCreated?.(created),
    onSaved: () => {
      props.onSaveSuccess?.();
      close();
    },
  });
  const isEdit = () => props.event !== undefined;
  // Only the organizer of an Outlook event replaces it; Teams stays locked
  // for everyone else.
  const replaceable = () => {
    const event = props.event;
    return (
      event?.calendar.provider === 'outlook' &&
      !event.isCancelled &&
      viewerReplacesGuests(event)
    );
  };
  const replacement = useEventReplacement(() => props.event?.eventId);

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

  const [suggesting, setSuggesting] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  // Once the user has changed anything, a late suggestion could overwrite
  // their edit or a repeat rule the form state does not hold, so it is dropped.
  const applySuggestions = async (
    pending: Promise<Partial<EventEditorInitialValues>>
  ) => {
    setSuggesting(true);
    try {
      const suggested = await pending;
      if (disposed || controller.isDirty()) return;
      controller.replaceFromExternal({ ...controller.state(), ...suggested });
    } finally {
      if (!disposed) setSuggesting(false);
    }
  };
  if (props.suggestedValues && !isEdit()) {
    fireAndForget(applySuggestions(props.suggestedValues), 'event-composer');
  }

  return (
    <div ref={attachHotkeys} class="flex h-full min-h-0 flex-col p-4 text-ink">
      <PanelEventForm
        controller={controller}
        status={
          <Show when={suggesting()}>
            <Spinner
              size="sm"
              label="Reading the email for a time and place"
              class="text-ink-extra-muted"
            />
          </Show>
        }
        macroCallsEnabled={macroCallsEnabled()}
        isEdit={isEdit()}
        saveError={editor.saveError()}
        disabledFields={editor.disabledFields()}
        addOnlyGuests={editor.addOnlyGuests()}
        guestsReadOnlyReason={editor.guestsReadOnlyReason()}
        guestsAction={
          <Show when={props.event}>
            {(event) => (
              <EditorForwardInvitation
                event={event()}
                guestInvitesEnabled={guestInvitesEnabled}
                forwardEnabled={invitationForwardEnabled}
              />
            )}
          </Show>
        }
        guestListHidden={editor.guestListHidden()}
        guestPolicyEditable={editor.guestPolicyEditable()}
        detailsReadOnlyReason={editor.detailsReadOnlyReason()}
        showRecurringEditNotice={editor.showRecurringEditNotice()}
        timeFormat={preferences.timeFormat}
        pending={editor.pending()}
        onCalendarChange={props.onCalendarChange}
        onDirtyChange={props.onDirtyChange}
        onCancel={close}
        onSubmit={editor.save}
        onReplace={
          replaceable()
            ? (values, scope) => {
                const request = editor.replacementRequest(values, scope);
                if (request)
                  fireAndForget(
                    replacement.start(request),
                    'calendar-replacement'
                  );
              }
            : undefined
        }
      />
      <EventReplacement
        controller={replacement}
        onDone={() => {
          props.onSaveSuccess?.();
          close();
        }}
      />
    </div>
  );
}
