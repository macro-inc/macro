import type { CalendarUpdateScope } from '@service-email/client';
import { createEffect, createSignal, createUniqueId, on } from 'solid-js';
import type { EventEditorDisabledFields } from '../components/composer/event-form-model';
import { outOfOfficeNoticeFor } from '../components/composer/out-of-office';
import type { CalendarComposerOptions } from '../core/composer';

/** Conformance-backed behavior for the new UI; no component or service ownership. */
export function createCalendarComposer(options: CalendarComposerOptions) {
  const controller = options.controller;
  const state = controller.state;
  const id = createUniqueId();
  const ids = {
    form: `calendar-composer-${id}`,
    dateRangeError: `calendar-composer-range-${id}`,
    pastEventWarning: `calendar-composer-past-${id}`,
    recurrenceReason: `calendar-composer-repeat-${id}`,
  };
  const isEdit = () => options.isEdit ?? false;
  const formIsDisabled = () => options.pending || options.disabled === true;
  const fieldIsReadOnly = (field: keyof EventEditorDisabledFields) =>
    options.disabledFields?.[field] === true;
  const fieldIsDisabled = (field: keyof EventEditorDisabledFields) =>
    formIsDisabled() || fieldIsReadOnly(field);
  const [editScope, setEditScope] = createSignal<CalendarUpdateScope>('all');
  const changeEditScope = (scope: CalendarUpdateScope) => {
    setEditScope(scope);
    if (scope === 'this_event') controller.resetGuestPolicy();
  };
  const detailsLocked = () => options.detailsReadOnlyReason !== undefined;
  const pastEventWarning = () =>
    controller.dateRangeError() ? undefined : controller.pastEventWarning();
  const dateRangeDescribedBy = () => {
    if (controller.dateRangeError()) return ids.dateRangeError;
    return pastEventWarning() ? ids.pastEventWarning : undefined;
  };
  const recurrenceScopeReason = () => {
    if (editScope() !== 'this_event' || detailsLocked()) return undefined;
    return 'The repeat rule applies to all events. Choose All events to change it.';
  };
  const capabilities = () => controller.selectedCalendarOption()?.capabilities;
  const conferenceLocked = () => {
    if (!isEdit() || capabilities()?.removeConference !== false) return false;
    const original = controller.initialConferenceChoice();
    return original === 'microsoft_teams' || original === 'existing';
  };
  const isOutOfOffice = controller.isOutOfOffice;
  const outOfOfficeNotice = () => {
    const outOfOffice = state().outOfOffice;
    if (!isOutOfOffice() || !outOfOffice) return undefined;
    return outOfOfficeNoticeFor(
      outOfOffice.autoDeclineMode,
      outOfOffice.declineMessage
    );
  };
  const showsDeclineMessage = () => {
    const outOfOffice = state().outOfOffice;
    return (
      outOfOffice !== undefined &&
      outOfOffice.autoDeclineMode !== 'decline_none'
    );
  };
  const showsGuestPolicy = () => {
    if (!options.guestPolicyEditable || isOutOfOffice()) return false;
    return capabilities()?.guestPolicy !== false;
  };
  const range = {
    subject: 'event',
    get timeFormat() {
      return options.timeFormat;
    },
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
  const guests = {
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
      return options.guestsReadOnlyReason;
    },
    get guestListHidden() {
      return options.guestListHidden;
    },
    get currentGuests() {
      return options.addOnlyGuests ? controller.initialGuests() : undefined;
    },
  };
  const guestPolicy = {
    get value() {
      return controller.guestPolicy();
    },
    onChange: controller.setGuestPolicy,
    get disabled() {
      return formIsDisabled() || editScope() === 'this_event';
    },
    get disabledReason() {
      if (editScope() !== 'this_event') return undefined;
      return 'Guest permissions apply to all events. Choose All events to change them.';
    },
  };

  // Report model changes to the host's close guard and calendar selection owner.
  createEffect(
    on(controller.isDirty, (dirty) => options.onDirtyChange?.(dirty))
  );
  createEffect(
    on(controller.selectedCalendarOption, (calendar) => {
      if (calendar) options.onCalendarChange?.(calendar.id, calendar.color);
    })
  );

  const submit = () => {
    const values = controller.submitValues();
    if (!values || formIsDisabled()) return;
    options.onSubmit(
      values,
      options.showRecurringEditNotice ? editScope() : undefined
    );
  };

  return {
    options,
    controller,
    state,
    ids,
    isEdit,
    formIsDisabled,
    fieldIsReadOnly,
    fieldIsDisabled,
    editScope,
    changeEditScope,
    detailsLocked,
    pastEventWarning,
    recurrenceScopeReason,
    recurrenceDescribedBy: () =>
      recurrenceScopeReason() ? ids.recurrenceReason : undefined,
    capabilities,
    conferenceLocked,
    isOutOfOffice,
    outOfOfficeNotice,
    showsDeclineMessage,
    showsGuestPolicy,
    range,
    guests,
    guestPolicy,
    submit,
  };
}

export type CalendarComposerModel = ReturnType<typeof createCalendarComposer>;
