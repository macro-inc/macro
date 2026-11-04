import {
  DateTimeRange,
  DateTimeRangeFields,
} from '@app/components/date-time-range/date-time-range-fields';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { CalendarUpdateScope } from '@service-email/client';
import { Button, cn, Input, Layer, RadioGroup, Tooltip } from '@ui';
import {
  createContext,
  For,
  type JSX,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import {
  calendarDescriptionToEditorHtml,
  exportCalendarDescription,
} from '../../utils/calendar-description';
import {
  EventGuestPolicyRow,
  EventGuestPolicyRows,
} from './EventGuestPolicyRow';
import {
  EventComposerCalendarPill,
  EventComposerConferencePill,
  EventComposerDeclineMessagePill,
  EventComposerDeclinePill,
  EventComposerGuestsPill,
  EventComposerGuestsSheetPill,
  EventComposerKindPill,
  EventComposerKindTabs,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
  EventComposerRemindersPill,
} from './EventPropertyPills';
import { EventTitleInput } from './EventTitleInput';
import type { EventFormState } from './event-form-state';
import { RecurrenceBuilder } from './RecurrenceBuilder';

/** Whether edits to a recurring event patch one occurrence or the whole series. */
const RECURRING_EDIT_SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarUpdateScope;
  label: string;
}[];

const EventFormPartsContext = createContext<EventFormState>();

function useEventForm() {
  const form = useContext(EventFormPartsContext);
  if (!form) throw new Error('EventFormParts must be rendered inside Root');
  return form;
}

/** Explains a locked field on hover and keyboard focus. */
function LockedField(props: ParentProps<{ reason?: string; class?: string }>) {
  return (
    <Show when={props.reason} fallback={props.children}>
      {(reason) => (
        <Tooltip as="span" label={reason()} tabIndex={0} class={props.class}>
          {props.children}
        </Tooltip>
      )}
    </Show>
  );
}

function Root(props: {
  form: EventFormState;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <EventFormPartsContext.Provider value={props.form}>
      <form
        id={props.form.ids.form}
        class={cn(
          'flex min-h-0 flex-1 flex-col gap-4 text-sm text-ink-muted [&_:disabled]:cursor-not-allowed',
          props.class
        )}
        onSubmit={(event) => {
          event.preventDefault();
          props.form.submit();
        }}
      >
        {props.children}
      </form>
    </EventFormPartsContext.Provider>
  );
}

/** The start and end inline, with the range's error or past-event warning. */
function When() {
  const form = useEventForm();
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <LockedField
        reason={form.props.detailsReadOnlyReason}
        class="block min-w-0"
      >
        <DateTimeRangeFields
          {...form.range}
          onAllDayChange={form.controller.setAllDay}
          allDayDisabled={form.fieldIsDisabled('allDay')}
        />
      </LockedField>
      <RangeMessages />
    </div>
  );
}

/** The event's start and end for a layout that places `DateTimeRange` parts itself. */
function Range(props: { children: JSX.Element }) {
  const form = useEventForm();
  return (
    <DateTimeRange.Root {...form.range}>{props.children}</DateTimeRange.Root>
  );
}

/** The range's error, or else a warning that the event is in the past. */
function RangeMessages() {
  const form = useEventForm();
  return (
    <>
      <Show when={form.controller.dateRangeError()}>
        {(error) => (
          <p
            id={form.ids.dateRangeError}
            role="alert"
            class="text-xs text-failure"
          >
            {error()}
          </p>
        )}
      </Show>
      <Show when={form.pastEventWarning()}>
        {(warning) => (
          <p
            id={form.ids.pastEventWarning}
            role="status"
            class="text-xs text-warning"
          >
            {warning()}
          </p>
        )}
      </Show>
    </>
  );
}

function Title() {
  const form = useEventForm();
  return (
    <LockedField reason={form.props.detailsReadOnlyReason} class="flex w-full">
      <EventTitleInput
        value={form.state().title}
        onChange={(value) => form.controller.setField('title', value)}
        autofocus={!form.isEdit()}
        disabled={form.fieldIsDisabled('title')}
      />
    </LockedField>
  );
}

function Description() {
  const form = useEventForm();
  // The editor cannot hand the provider's string back: Lexical re-serializes
  // whatever it loads. Only content that exports differently from what was
  // loaded counts as an edit, so an untouched description stays byte-for-byte
  // what the event was opened with.
  const initialDescription = form.state().description;
  let loadedDescription: string | undefined;

  const descriptionEditor = () => (
    <MarkdownTextarea
      resolveAppLink={form.resolveAppLink}
      type="calendar"
      initialHtml={calendarDescriptionToEditorHtml(initialDescription)}
      editable={() => !form.fieldIsDisabled('description')}
      onInitialized={(editor) => {
        loadedDescription = exportCalendarDescription(editor);
      }}
      onChange={(_markdown, editor) => {
        if (!editor) return;
        const next = exportCalendarDescription(editor);
        form.controller.setField(
          'description',
          next === loadedDescription ? initialDescription : next
        );
      }}
      placeholder="Add description..."
      portalScope="local"
      domRef={(element) => element.setAttribute('aria-label', 'Description')}
      class="h-full w-full bg-transparent px-2 text-sm text-ink outline-none"
    />
  );

  return (
    // Google rejects a description on an out-of-office event. The editor
    // re-initializes from the kind switch's reset state, so what it shows
    // always matches what a save submits.
    <Show when={!form.isOutOfOffice()}>
      <LockedField
        reason={form.props.detailsReadOnlyReason}
        class="block w-full"
      >
        <div class="h-12 overflow-y-auto">
          {/* The editor reads the description only when it mounts. Details
              that lock after a refused save return to the event's own, so
              the editor mounts again to show them. */}
          <Show
            when={form.fieldIsReadOnly('description')}
            fallback={descriptionEditor()}
          >
            {descriptionEditor()}
          </Show>
        </div>
      </LockedField>
    </Show>
  );
}

function KindPill() {
  const form = useEventForm();
  return (
    // Read-only on every edit, it opens its one value as a list; locked, it
    // is as unavailable as the other details.
    <LockedField reason={form.props.detailsReadOnlyReason}>
      <EventComposerKindPill
        eventType={form.state().eventType}
        onChange={form.controller.setEventKind}
        disabled={form.formIsDisabled() || form.detailsLocked()}
        readOnly={form.isEdit()}
      />
    </LockedField>
  );
}

/** The kinds of event as selectable labels, in place of `KindPill`. */
function KindTabs() {
  const form = useEventForm();
  return (
    <EventComposerKindTabs
      eventType={form.state().eventType}
      onChange={form.controller.setEventKind}
      disabled={form.formIsDisabled() || form.detailsLocked()}
      readOnly={form.isEdit()}
    />
  );
}

function CalendarPill() {
  const form = useEventForm();
  return (
    <LockedField reason={form.props.detailsReadOnlyReason}>
      <EventComposerCalendarPill
        options={form.controller.calendarOptions()}
        value={form.controller.selectedCalendarOption()}
        onChange={(calendarId) =>
          form.controller.setField('calendarId', calendarId)
        }
        disabled={form.formIsDisabled() || form.detailsLocked()}
        readOnly={form.fieldIsReadOnly('calendar')}
      />
    </LockedField>
  );
}

function RecurrencePill() {
  const form = useEventForm();
  return (
    <LockedField reason={form.props.detailsReadOnlyReason}>
      <EventComposerRecurrencePill
        options={form.controller.recurrenceOptions()}
        value={form.controller.selectedRecurrenceOption()}
        onChange={form.controller.changeRecurrenceChoice}
        disabled={form.fieldIsDisabled('recurrence')}
        // A single occurrence has no recurrence rule of its own, so the
        // recurrence cannot be edited while the scope is one event.
        readOnly={form.editScope() === 'this_event'}
        readOnlyReason={form.recurrenceScopeReason()}
        describedBy={form.recurrenceDescribedBy()}
      />
    </LockedField>
  );
}

/** The guests, then the host's action beside them, such as forwarding. */
function GuestsPill() {
  const form = useEventForm();
  return (
    <>
      <EventComposerGuestsPill {...form.guests} />
      {form.props.guestsAction}
    </>
  );
}

/** `GuestsPill` for a touch sheet, editing the guests in a sheet of their own. */
function GuestsSheetPill() {
  const form = useEventForm();
  return (
    <>
      <EventComposerGuestsSheetPill {...form.guests} />
      {form.props.guestsAction}
    </>
  );
}

function ConferencePill() {
  const form = useEventForm();
  return (
    <LockedField reason={form.props.detailsReadOnlyReason}>
      <EventComposerConferencePill
        value={form.state().conference}
        provider={form.capabilities()?.conferenceProvider}
        macroCallsEnabled={form.props.macroCallsEnabled}
        canKeepExisting={
          form.controller.initialConferenceChoice() === 'existing'
        }
        onChange={(conference) =>
          form.controller.setField('conference', conference)
        }
        disabled={form.fieldIsDisabled('conference') || form.conferenceLocked()}
      />
    </LockedField>
  );
}

function LocationPill() {
  const form = useEventForm();
  return (
    <LockedField reason={form.props.detailsReadOnlyReason}>
      <EventComposerLocationPill
        value={form.state().location}
        onChange={(location) => form.controller.setField('location', location)}
        disabled={form.fieldIsDisabled('location')}
      />
    </LockedField>
  );
}

/**
 * The location as a text field, for a sheet row: inside the sheet's scroll it
 * stays above the keyboard, where a popover would float off with its pill.
 */
function LocationInput() {
  const form = useEventForm();
  return (
    <Input
      size="sm"
      class="w-full"
      value={form.state().location}
      onInput={(event) =>
        form.controller.setField('location', event.currentTarget.value)
      }
      placeholder="Add location"
      aria-label="Location"
      disabled={form.fieldIsDisabled('location')}
    />
  );
}

/** How an out-of-office event declines meetings, where the calendar can. */
function DeclinePill() {
  const form = useEventForm();
  return (
    <Show
      when={form.capabilities()?.autoDecline !== false}
      fallback={
        <span class="text-xs text-ink-muted">
          Outlook blocks this time. Configure automatic declines in Outlook.
        </span>
      }
    >
      <EventComposerDeclinePill
        value={form.state().outOfOffice}
        onChange={form.controller.setOutOfOffice}
        disabled={form.fieldIsDisabled('outOfOffice')}
      />
    </Show>
  );
}

/** The reply to declined meetings; shown while `showsDeclineMessage`. */
function DeclineMessagePill() {
  const form = useEventForm();
  const state = form.state;
  return (
    <EventComposerDeclineMessagePill
      value={state().outOfOffice?.declineMessage ?? ''}
      onChange={(declineMessage) =>
        form.controller.setOutOfOffice({
          autoDeclineMode:
            state().outOfOffice?.autoDeclineMode ?? 'decline_none',
          declineMessage,
        })
      }
      disabled={form.fieldIsDisabled('outOfOffice')}
    />
  );
}

function RemindersPill() {
  const form = useEventForm();
  const controller = form.controller;
  return (
    <EventComposerRemindersPill
      minutes={controller.reminderMinutes()}
      usedSlots={
        controller.reminderMinutes().length +
        controller.preservedReminderCount()
      }
      canAdd={controller.canAddReminder()}
      onChange={controller.setReminderMinutes}
      disabled={form.fieldIsDisabled('reminders')}
    />
  );
}

/** Every event pill on one wrapping line. */
function Properties() {
  const form = useEventForm();
  return (
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <KindPill />
      <CalendarPill />
      <RecurrencePill />
      <Show when={!form.isOutOfOffice()}>
        <GuestsPill />
        <ConferencePill />
        <LocationPill />
      </Show>
      <Show when={form.isOutOfOffice()}>
        <DeclinePill />
        <Show when={form.showsDeclineMessage()}>
          <DeclineMessagePill />
        </Show>
      </Show>
      <RemindersPill />
    </div>
  );
}

function RecurrenceScopeReason() {
  const form = useEventForm();
  return (
    <Show when={form.recurrenceScopeReason()}>
      {(reason) => (
        <p id={form.ids.recurrenceReason} class="text-xs text-ink-muted">
          {reason()}
        </p>
      )}
    </Show>
  );
}

function GuestPolicy() {
  const form = useEventForm();
  return (
    <Show when={form.showsGuestPolicy()}>
      {/* The policy belongs to the whole series, like its recurrence. */}
      <EventGuestPolicyRow {...form.guestPolicy} />
    </Show>
  );
}

/** Guest permissions one per row, in place of `GuestPolicy`. */
function GuestPolicyRows() {
  const form = useEventForm();
  return (
    <Show when={form.showsGuestPolicy()}>
      <EventGuestPolicyRows {...form.guestPolicy} />
    </Show>
  );
}

/** Why details are locked, conferencing limits, and the out-of-office disclosure. */
function Notices() {
  const form = useEventForm();
  const state = form.state;
  return (
    <>
      <Show when={form.props.detailsReadOnlyReason}>
        {(reason) => <p class="text-xs text-ink-muted">{reason()}</p>}
      </Show>
      <Show when={form.conferenceLocked()}>
        <p class="text-xs text-ink-muted">
          Microsoft keeps the online meeting link on an existing event. To
          remove it, use “Replace event” after saving or discarding your edits
          without a meeting link.
        </p>
      </Show>
      <Show when={form.controller.conferenceError()}>
        {(error) => (
          <p role="alert" class="text-sm text-warning">
            {error()}
          </p>
        )}
      </Show>
      <Show when={form.outOfOfficeNotice()}>
        {(notice) => (
          <div
            role="note"
            aria-label="Out-of-office event"
            class="flex min-w-0 flex-col gap-1 rounded-lg border border-warning/40 bg-warning-bg p-3 text-xs text-warning-ink"
          >
            <span class="font-medium">Out-of-office event</span>
            <span>{notice().effect}</span>
            <Show
              when={
                form.controller.selectedCalendarOption()?.provider ===
                  'outlook' &&
                state().outOfOffice?.autoDeclineMode !== 'decline_none'
              }
            >
              <span>
                Macro checks for conflicts in the background while this calendar
                is connected. Replies already sent cannot be undone by changing
                this event.
              </span>
            </Show>
            <Show when={notice().declineMessage}>
              {(message) => (
                <span class="italic">Auto-decline reply: “{message()}”</span>
              )}
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

function CustomRecurrence() {
  const form = useEventForm();
  return (
    <Show when={form.controller.recurrenceChoice() === 'custom'}>
      <Layer depth={3}>
        <div class="rounded-xl bg-surface p-4 text-ink">
          <RecurrenceBuilder
            value={form.controller.customConfig()}
            start={form.controller.startForRecurrence()}
            allDay={form.state().allDay}
            disabled={
              form.fieldIsDisabled('recurrence') ||
              form.editScope() === 'this_event'
            }
            onChange={form.controller.setCustomConfig}
          />
        </div>
      </Layer>
    </Show>
  );
}

/** Why the last save failed; `class` places it. */
function SaveError(props: { class?: string }) {
  const form = useEventForm();
  return (
    <Show when={form.props.saveError}>
      <p role="alert" class={cn('text-sm text-failure', props.class)}>
        {form.props.saveError}
      </p>
    </Show>
  );
}

/** Whether a recurring edit applies to one event or the series; `class` places it. */
function EditScope(props: { class?: string }) {
  const form = useEventForm();
  return (
    <Show when={form.props.showRecurringEditNotice}>
      <RadioGroup
        size="sm"
        value={form.editScope()}
        onChange={(value) => form.changeEditScope(value as CalendarUpdateScope)}
        disabled={form.formIsDisabled()}
        aria-label="Apply changes to"
        class={cn(
          'flex-row items-center gap-3 text-xs text-ink-muted',
          props.class
        )}
      >
        <For each={RECURRING_EDIT_SCOPE_OPTIONS}>
          {(option) => (
            <RadioGroup.Item value={option.scope} class="gap-1.5">
              <RadioGroup.ItemControl />
              <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
            </RadioGroup.Item>
          )}
        </For>
      </RadioGroup>
    </Show>
  );
}

function Cancel() {
  const form = useEventForm();
  return (
    <Button
      type="button"
      variant="ghost"
      disabled={form.formIsDisabled()}
      onClick={form.props.onCancel}
    >
      Cancel
    </Button>
  );
}

function Submit() {
  const form = useEventForm();
  const label = () => (form.isEdit() ? 'Save' : 'Create event');
  return (
    <Button
      type="submit"
      // Names the form so the action submits it from pinned sheet chrome too.
      form={form.ids.form}
      variant="primary"
      disabled={!form.controller.canSave() || form.formIsDisabled()}
      aria-label={label()}
    >
      <Show when={form.props.pending} fallback={label()}>
        <SpinnerIcon class="size-4 animate-spin" />
      </Show>
    </Button>
  );
}

/**
 * Parts of the event form. A layout creates the state with `createEventForm`,
 * hands it to `Root`, and arranges the parts it shows.
 */
export const EventFormParts = {
  Root,
  When,
  Range,
  RangeMessages,
  Title,
  Description,
  Properties,
  KindPill,
  KindTabs,
  CalendarPill,
  RecurrencePill,
  GuestsPill,
  GuestsSheetPill,
  ConferencePill,
  LocationPill,
  LocationInput,
  DeclinePill,
  DeclineMessagePill,
  RemindersPill,
  RecurrenceScopeReason,
  GuestPolicy,
  GuestPolicyRows,
  Notices,
  CustomRecurrence,
  SaveError,
  EditScope,
  Cancel,
  Submit,
};
