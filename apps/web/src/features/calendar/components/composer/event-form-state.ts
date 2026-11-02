import type { DateTimeRangeProps } from '@app/components/date-time-range/date-time-range-fields';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import type { CalendarUpdateScope } from '@service-email/client';
import type { JSX } from 'solid-js';
import { createEffect, createSignal, createUniqueId } from 'solid-js';
import type { CalendarEventFormController } from './create-calendar-event-form-controller';
import type { EventGuestPolicyRowProps } from './EventGuestPolicyRow';
import type { EventComposerGuestsPillProps } from './EventPropertyPills';
import type {
  EventEditorDisabledFields,
  EventEditorSubmitValues,
} from './event-form-model';
import { outOfOfficeNoticeFor } from './out-of-office';

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

/**
 * Field locks, edit scope, and submission for one event form, shared by the
 * desktop and mobile layouts through the `EventFormParts`.
 */
export function createEventForm(props: EventFormProps) {
  const formId = createUniqueId();
  const ids = {
    form: `event-composer-${formId}`,
    dateRangeError: `event-composer-date-range-error-${formId}`,
    recurrenceReason: `event-composer-recurrence-reason-${formId}`,
    pastEventWarning: `event-composer-past-event-warning-${formId}`,
  };

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
    if (controller.dateRangeError()) return ids.dateRangeError;
    return pastEventWarning() ? ids.pastEventWarning : undefined;
  };

  const fieldIsReadOnly = (field: keyof EventEditorDisabledFields) =>
    props.disabledFields?.[field] === true;
  const fieldIsDisabled = (field: keyof EventEditorDisabledFields) =>
    formIsDisabled() || fieldIsReadOnly(field);
  /** The event's start and end, bound for either range layout. */
  const range: DateTimeRangeProps = {
    subject: 'event',
    get start() {
      return state().start;
    },
    get end() {
      return state().end;
    },
    get allDay() {
      return state().allDay;
    },
    onStartChange: controller.setStart,
    onEndChange: controller.setEnd,
    get startDisabled() {
      return fieldIsDisabled('start');
    },
    get endDisabled() {
      return fieldIsDisabled('end');
    },
    get invalid() {
      return controller.dateRangeError() !== undefined;
    },
    get describedBy() {
      return dateRangeDescribedBy();
    },
  };
  const detailsLocked = () => props.detailsReadOnlyReason !== undefined;
  // A single occurrence has no repeat rule of its own; like the guest
  // permissions, the rule belongs to the whole series. A lock already says
  // why the rule cannot change.
  const recurrenceScopeReason = () =>
    editScope() === 'this_event' && !detailsLocked()
      ? 'The repeat rule applies to all events. Choose All events to change it.'
      : undefined;
  const recurrenceDescribedBy = () =>
    recurrenceScopeReason() ? ids.recurrenceReason : undefined;

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

  const showsDeclineMessage = () =>
    !!state().outOfOffice &&
    state().outOfOffice?.autoDeclineMode !== 'decline_none';
  // Outlook has no guest permissions, and an out-of-office event no guests.
  const showsGuestPolicy = () =>
    props.guestPolicyEditable === true &&
    capabilities()?.guestPolicy !== false &&
    !isOutOfOffice();
  /** The guests, bound for either guest pill. */
  const guests: EventComposerGuestsPillProps = {
    options: controller.guestOptions,
    get selected() {
      return controller.selectedGuests();
    },
    onChange: controller.setSelectedGuests,
    get disabled() {
      return formIsDisabled();
    },
    get readOnly() {
      return fieldIsReadOnly('guests');
    },
    get readOnlyReason() {
      return props.guestsReadOnlyReason;
    },
    get guestListHidden() {
      return props.guestListHidden;
    },
    get currentGuests() {
      return props.addOnlyGuests ? controller.initialGuests() : undefined;
    },
  };
  const guestPolicy: EventGuestPolicyRowProps = {
    get value() {
      return controller.guestPolicy();
    },
    onChange: controller.setGuestPolicy,
    get disabled() {
      return formIsDisabled() || editScope() === 'this_event';
    },
    get disabledReason() {
      return editScope() === 'this_event'
        ? 'Guest permissions apply to all events. Choose All events to change them.'
        : undefined;
    },
  };

  createEffect(() => {
    const option = controller.selectedCalendarOption();
    if (option) props.onCalendarChange?.(option.id, option.color);
  });
  createEffect(() => props.onDirtyChange?.(controller.isDirty()));

  const submit = () => {
    const values = controller.submitValues();
    if (!values || formIsDisabled()) return;
    props.onSubmit(
      values,
      props.showRecurringEditNotice ? editScope() : undefined
    );
  };

  return {
    props,
    ids,
    controller,
    state,
    resolveAppLink: useMacroMentionLinkResolver(),
    isEdit,
    formIsDisabled,
    editScope,
    changeEditScope,
    pastEventWarning,
    range,
    fieldIsReadOnly,
    fieldIsDisabled,
    detailsLocked,
    recurrenceScopeReason,
    recurrenceDescribedBy,
    capabilities,
    conferenceLocked,
    isOutOfOffice,
    outOfOfficeNotice,
    showsDeclineMessage,
    showsGuestPolicy,
    guests,
    guestPolicy,
    submit,
  };
}

export type EventFormState = ReturnType<typeof createEventForm>;
