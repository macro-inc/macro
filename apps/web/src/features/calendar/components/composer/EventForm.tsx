import { DateTimeRangeFields } from '@app/components/date-time-range/date-time-range-fields';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { CalendarUpdateScope } from '@service-email/client';
import { Button, cn, Layer, RadioGroup, Tooltip } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  type ParentProps,
  Show,
} from 'solid-js';
import {
  calendarDescriptionToEditorHtml,
  exportCalendarDescription,
} from '../../utils/calendar-description';
import type { CalendarEventFormController } from './create-calendar-event-form-controller';
import { EventGuestPolicyRow } from './EventGuestPolicyRow';
import {
  EventComposerCalendarPill,
  EventComposerConferencePill,
  EventComposerDeclineMessagePill,
  EventComposerDeclinePill,
  EventComposerGuestsPill,
  EventComposerKindPill,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
  EventComposerRemindersPill,
} from './EventPropertyPills';
import { EventTitleInput } from './EventTitleInput';
import type {
  EventEditorDisabledFields,
  EventEditorSubmitValues,
} from './event-form-model';
import { outOfOfficeNoticeFor } from './out-of-office';
import { RecurrenceBuilder } from './RecurrenceBuilder';

export interface EventFormProps {
  controller: CalendarEventFormController;
  /** Whether this host can create and attach Macro call links. */
  macroCallsEnabled: boolean;
  isEdit?: boolean;
  disabledFields?: EventEditorDisabledFields;
  /** The viewer may add guests but not remove the event's current ones. */
  addOnlyGuests?: boolean;
  /** Why a read-only guest list cannot change. */
  guestsReadOnlyReason?: string;
  /** An action beside the guests, such as forwarding the invitation. */
  guestsAction?: JSX.Element;
  /** The organizer hides the guest list, so the seeded guests are not all of them. */
  guestListHidden?: boolean;
  /** Whether the viewer may set what guests may do, as the organizer. */
  guestPolicyEditable?: boolean;
  /**
   * Why the event's title, time, description, location, recurrence and
   * conferencing cannot change.
   */
  detailsReadOnlyReason?: string;
  showRecurringEditNotice?: boolean;
  /** Disable interaction without presenting the form as an in-flight save. */
  disabled?: boolean;
  pending: boolean;
  saveError?: string;
  class?: string;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (
    values: EventEditorSubmitValues,
    scope?: CalendarUpdateScope
  ) => void;
}

/** Whether edits to a recurring event patch one occurrence or the whole series. */
const RECURRING_EDIT_SCOPE_OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'all', label: 'All events' },
] as const satisfies readonly {
  scope: CalendarUpdateScope;
  label: string;
}[];

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

/** Create/edit event form laid out like the standalone task composer. */
export function EventForm(props: EventFormProps) {
  const formId = createUniqueId();
  const resolveAppLink = useMacroMentionLinkResolver();

  const dateRangeErrorId = `event-composer-date-range-error-${formId}`;
  const recurrenceReasonId = `event-composer-recurrence-reason-${formId}`;
  const pastEventWarningId = `event-composer-past-event-warning-${formId}`;

  const controller = props.controller;
  const state = controller.state;
  const isEdit = () => props.isEdit ?? false;
  const formIsDisabled = () => props.pending || props.disabled === true;

  // Recurring edits default to the whole series, matching the long-standing
  // behavior; "this event" writes a single-occurrence exception.
  const [editScope, setEditScope] = createSignal<CalendarUpdateScope>('all');
  // Guest permissions belong to the whole series, so an occurrence edit
  // returns them to what is stored rather than keep an edit it cannot save.
  const changeEditScope = (scope: CalendarUpdateScope) => {
    setEditScope(scope);
    if (scope === 'this_event') controller.resetGuestPolicy();
  };

  // An invalid range already speaks for itself; only one line shows at a time.
  const pastEventWarning = () =>
    controller.dateRangeError() ? undefined : controller.pastEventWarning();
  const dateRangeDescribedBy = () => {
    if (controller.dateRangeError()) return dateRangeErrorId;
    return pastEventWarning() ? pastEventWarningId : undefined;
  };

  const fieldIsReadOnly = (field: keyof EventEditorDisabledFields) =>
    props.disabledFields?.[field] === true;
  const fieldIsDisabled = (field: keyof EventEditorDisabledFields) =>
    formIsDisabled() || fieldIsReadOnly(field);
  const detailsLocked = () => props.detailsReadOnlyReason !== undefined;
  // A single occurrence has no repeat rule of its own; like the guest
  // permissions, the rule belongs to the whole series. A lock already says
  // why the rule cannot change.
  const recurrenceScopeReason = () =>
    editScope() === 'this_event' && !detailsLocked()
      ? 'The repeat rule applies to all events. Choose All events to change it.'
      : undefined;
  const recurrenceDescribedBy = () =>
    recurrenceScopeReason() ? recurrenceReasonId : undefined;

  const capabilities = () => controller.selectedCalendarOption()?.capabilities;
  const conferenceLocked = () =>
    isEdit() &&
    capabilities()?.removeConference === false &&
    ['microsoft_teams', 'existing'].includes(
      controller.initialConferenceChoice()
    );
  const isOutOfOffice = () => controller.isOutOfOffice();
  // The decline settings of an edited event are unknown until picked, and the
  // disclosure must not claim behavior nobody chose.
  const outOfOfficeNotice = () => {
    const outOfOffice = state().outOfOffice;
    if (!isOutOfOffice() || !outOfOffice) return undefined;
    return outOfOfficeNoticeFor(
      outOfOffice.autoDeclineMode,
      outOfOffice.declineMessage
    );
  };

  // The editor cannot hand the provider's string back: Lexical re-serializes
  // whatever it loads. Only content that exports differently from what was
  // loaded counts as an edit, so an untouched description stays byte-for-byte
  // what the event was opened with.
  const initialDescription = state().description;
  let loadedDescription: string | undefined;

  createEffect(() => {
    const option = controller.selectedCalendarOption();
    if (option) props.onCalendarChange?.(option.id, option.color);
  });
  createEffect(() => props.onDirtyChange?.(controller.isDirty()));

  const descriptionEditor = () => (
    <MarkdownTextarea
      resolveAppLink={resolveAppLink}
      type="calendar"
      initialHtml={calendarDescriptionToEditorHtml(initialDescription)}
      editable={() => !fieldIsDisabled('description')}
      onInitialized={(editor) => {
        loadedDescription = exportCalendarDescription(editor);
      }}
      onChange={(_markdown, editor) => {
        if (!editor) return;
        const next = exportCalendarDescription(editor);
        controller.setField(
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

  const submit = () => {
    const values = controller.submitValues();
    if (!values || formIsDisabled()) return;
    props.onSubmit(
      values,
      props.showRecurringEditNotice ? editScope() : undefined
    );
  };

  return (
    <form
      class={cn(
        'flex min-h-0 flex-1 flex-col gap-4 text-sm text-ink-muted [&_:disabled]:cursor-not-allowed',
        props.class
      )}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto scrollbar-hidden">
        <div class="flex min-w-0 flex-col gap-6 text-sm text-ink-muted">
          <div class="flex min-w-0 flex-col gap-1">
            <div class="flex min-w-0 flex-col gap-1">
              <LockedField
                reason={props.detailsReadOnlyReason}
                class="block min-w-0"
              >
                <DateTimeRangeFields
                  subject="event"
                  start={state().start}
                  end={state().end}
                  allDay={state().allDay}
                  onStartChange={controller.setStart}
                  onEndChange={controller.setEnd}
                  onAllDayChange={controller.setAllDay}
                  startDisabled={fieldIsDisabled('start')}
                  endDisabled={fieldIsDisabled('end')}
                  allDayDisabled={fieldIsDisabled('allDay')}
                  invalid={controller.dateRangeError() !== undefined}
                  describedBy={dateRangeDescribedBy()}
                />
              </LockedField>
              <Show when={controller.dateRangeError()}>
                {(error) => (
                  <p
                    id={dateRangeErrorId}
                    role="alert"
                    class="text-xs text-failure"
                  >
                    {error()}
                  </p>
                )}
              </Show>
              <Show when={pastEventWarning()}>
                {(warning) => (
                  <p
                    id={pastEventWarningId}
                    role="status"
                    class="text-xs text-warning"
                  >
                    {warning()}
                  </p>
                )}
              </Show>
            </div>

            <LockedField
              reason={props.detailsReadOnlyReason}
              class="flex w-full"
            >
              <EventTitleInput
                value={state().title}
                onChange={(value) => controller.setField('title', value)}
                autofocus={!isEdit()}
                disabled={fieldIsDisabled('title')}
              />
            </LockedField>

            {/* Google rejects a description on an out-of-office event. The
                editor re-initializes from the kind switch's reset state, so
                what it shows always matches what a save submits. */}
            <Show when={!isOutOfOffice()}>
              <LockedField
                reason={props.detailsReadOnlyReason}
                class="block w-full"
              >
                <div class="h-12 overflow-y-auto">
                  {/* The editor reads the description only when it mounts.
                      Details that lock after a refused save return to the
                      event's own, so the editor mounts again to show them. */}
                  <Show
                    when={fieldIsReadOnly('description')}
                    fallback={descriptionEditor()}
                  >
                    {descriptionEditor()}
                  </Show>
                </div>
              </LockedField>
            </Show>
          </div>

          <div class="flex min-w-0 flex-col gap-2">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              {/* Read-only on every edit, they open their one value as a list;
                  locked, they are as unavailable as the other details. */}
              <LockedField reason={props.detailsReadOnlyReason}>
                <EventComposerKindPill
                  eventType={state().eventType}
                  onChange={controller.setEventKind}
                  disabled={formIsDisabled() || detailsLocked()}
                  readOnly={isEdit()}
                />
              </LockedField>
              <LockedField reason={props.detailsReadOnlyReason}>
                <EventComposerCalendarPill
                  options={controller.calendarOptions()}
                  value={controller.selectedCalendarOption()}
                  onChange={(calendarId) =>
                    controller.setField('calendarId', calendarId)
                  }
                  disabled={formIsDisabled() || detailsLocked()}
                  readOnly={fieldIsReadOnly('calendar')}
                />
              </LockedField>
              <LockedField reason={props.detailsReadOnlyReason}>
                <EventComposerRecurrencePill
                  options={controller.recurrenceOptions()}
                  value={controller.selectedRecurrenceOption()}
                  onChange={controller.changeRecurrenceChoice}
                  disabled={fieldIsDisabled('recurrence')}
                  // A single occurrence has no recurrence rule of its own, so the
                  // recurrence cannot be edited while the scope is one event.
                  readOnly={editScope() === 'this_event'}
                  readOnlyReason={recurrenceScopeReason()}
                  describedBy={recurrenceDescribedBy()}
                />
              </LockedField>
              <Show when={!isOutOfOffice()}>
                <EventComposerGuestsPill
                  options={controller.guestOptions}
                  selected={controller.selectedGuests()}
                  onChange={controller.setSelectedGuests}
                  disabled={formIsDisabled()}
                  readOnly={fieldIsReadOnly('guests')}
                  readOnlyReason={props.guestsReadOnlyReason}
                  guestListHidden={props.guestListHidden}
                  currentGuests={
                    props.addOnlyGuests ? controller.initialGuests() : undefined
                  }
                />
                {props.guestsAction}
                <LockedField reason={props.detailsReadOnlyReason}>
                  <EventComposerConferencePill
                    value={state().conference}
                    provider={capabilities()?.conferenceProvider}
                    macroCallsEnabled={props.macroCallsEnabled}
                    canKeepExisting={
                      controller.initialConferenceChoice() === 'existing'
                    }
                    onChange={(conference) =>
                      controller.setField('conference', conference)
                    }
                    disabled={
                      fieldIsDisabled('conference') || conferenceLocked()
                    }
                  />
                </LockedField>
                <LockedField reason={props.detailsReadOnlyReason}>
                  <EventComposerLocationPill
                    value={state().location}
                    onChange={(location) =>
                      controller.setField('location', location)
                    }
                    disabled={fieldIsDisabled('location')}
                  />
                </LockedField>
              </Show>
              <Show when={isOutOfOffice()}>
                <Show
                  when={capabilities()?.autoDecline !== false}
                  fallback={
                    <span class="text-xs text-ink-muted">
                      Outlook blocks this time. Configure automatic declines in
                      Outlook.
                    </span>
                  }
                >
                  <EventComposerDeclinePill
                    value={state().outOfOffice}
                    onChange={controller.setOutOfOffice}
                    disabled={fieldIsDisabled('outOfOffice')}
                  />
                </Show>
                <Show
                  when={
                    state().outOfOffice &&
                    state().outOfOffice?.autoDeclineMode !== 'decline_none'
                  }
                >
                  <EventComposerDeclineMessagePill
                    value={state().outOfOffice?.declineMessage ?? ''}
                    onChange={(declineMessage) =>
                      controller.setOutOfOffice({
                        autoDeclineMode:
                          state().outOfOffice?.autoDeclineMode ??
                          'decline_none',
                        declineMessage,
                      })
                    }
                    disabled={fieldIsDisabled('outOfOffice')}
                  />
                </Show>
              </Show>
              <EventComposerRemindersPill
                minutes={controller.reminderMinutes()}
                usedSlots={
                  controller.reminderMinutes().length +
                  controller.preservedReminderCount()
                }
                canAdd={controller.canAddReminder()}
                onChange={controller.setReminderMinutes}
                disabled={fieldIsDisabled('reminders')}
              />
            </div>
            <Show when={recurrenceScopeReason()}>
              {(reason) => (
                <p id={recurrenceReasonId} class="text-xs text-ink-muted">
                  {reason()}
                </p>
              )}
            </Show>
          </div>

          {/* Outlook has no guest permissions, and an out-of-office event
              no guests. */}
          <Show
            when={
              props.guestPolicyEditable &&
              capabilities()?.guestPolicy !== false &&
              !isOutOfOffice()
            }
          >
            {/* The policy belongs to the whole series, like its recurrence. */}
            <EventGuestPolicyRow
              value={controller.guestPolicy()}
              onChange={controller.setGuestPolicy}
              disabled={formIsDisabled() || editScope() === 'this_event'}
              disabledReason={
                editScope() === 'this_event'
                  ? 'Guest permissions apply to all events. Choose All events to change them.'
                  : undefined
              }
            />
          </Show>
          <Show when={props.detailsReadOnlyReason}>
            {(reason) => <p class="text-xs text-ink-muted">{reason()}</p>}
          </Show>
          <Show when={conferenceLocked()}>
            <p class="text-xs text-ink-muted">
              Microsoft keeps the online meeting link on an existing event. To
              remove it, use “Replace event” after saving or discarding your
              edits without a meeting link.
            </p>
          </Show>
          <Show when={controller.conferenceError()}>
            {(error) => (
              <p role="alert" class="text-sm text-warning">
                {error()}
              </p>
            )}
          </Show>
          <Show when={outOfOfficeNotice()}>
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
                    controller.selectedCalendarOption()?.provider ===
                      'outlook' &&
                    state().outOfOffice?.autoDeclineMode !== 'decline_none'
                  }
                >
                  <span>
                    Macro checks for conflicts in the background while this
                    calendar is connected. Replies already sent cannot be undone
                    by changing this event.
                  </span>
                </Show>
                <Show when={notice().declineMessage}>
                  {(message) => (
                    <span class="italic">
                      Auto-decline reply: “{message()}”
                    </span>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </div>

        <Show when={controller.recurrenceChoice() === 'custom'}>
          <Layer depth={3}>
            <div class="rounded-xl bg-surface p-4 text-ink">
              <RecurrenceBuilder
                value={controller.customConfig()}
                start={controller.startForRecurrence()}
                allDay={state().allDay}
                disabled={
                  fieldIsDisabled('recurrence') || editScope() === 'this_event'
                }
                onChange={controller.setCustomConfig}
              />
            </div>
          </Layer>
        </Show>
      </div>

      <Show when={props.saveError}>
        <p role="alert" class="text-sm text-failure">
          {props.saveError}
        </p>
      </Show>
      <div class="flex shrink-0 items-center justify-end gap-3">
        <Show when={props.showRecurringEditNotice}>
          <RadioGroup
            value={editScope()}
            onChange={(value) => changeEditScope(value as CalendarUpdateScope)}
            disabled={formIsDisabled()}
            aria-label="Apply changes to"
            class="mr-auto flex-row items-center gap-3 text-xs text-ink-muted"
          >
            <For each={RECURRING_EDIT_SCOPE_OPTIONS}>
              {(option) => (
                <RadioGroup.Item value={option.scope} class="gap-1.5">
                  <RadioGroup.ItemControl class="size-3.5" />
                  <RadioGroup.ItemLabel>{option.label}</RadioGroup.ItemLabel>
                </RadioGroup.Item>
              )}
            </For>
          </RadioGroup>
        </Show>
        <Button
          type="button"
          variant="ghost"
          disabled={formIsDisabled()}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!controller.canSave() || formIsDisabled()}
          aria-label={isEdit() ? 'Save' : 'Create event'}
        >
          <Show
            when={props.pending}
            fallback={isEdit() ? 'Save' : 'Create event'}
          >
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </form>
  );
}
