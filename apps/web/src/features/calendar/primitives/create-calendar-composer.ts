import { t } from '@app/lib/i18n';
import type { EventTransparency } from '@service-calendar/generated/schemas/eventTransparency';
import type { EventVisibility } from '@service-calendar/generated/schemas/eventVisibility';
import type { CalendarUpdateScope } from '@service-email/client';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  on,
  onCleanup,
} from 'solid-js';
import type { EventEditorDisabledFields } from '../components/composer/event-form-model';
import { outOfOfficeNoticeFor } from '../components/composer/out-of-office';
import type { CalendarComposerOptions } from '../core/composer';
import { DEFAULT_CALENDAR_SOURCE } from '../types';
import { isTimedPointEvent } from '../utils/calendar-date';
import { rezoneRecurrenceUntil } from '../utils/recurrence';
import { createComposerMetadata } from './create-composer-metadata';
import { createComposerWhen } from './create-composer-when';

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
    if (scope === 'this_event') {
      controller.resetGuestPolicy();
      metadata.resetVisibility();
    }
  };
  const detailsLocked = () => options.detailsReadOnlyReason !== undefined;
  const pastEventWarning = () =>
    controller.dateRangeError() || timeZoneRangeInvalid()
      ? undefined
      : controller.pastEventWarning();
  const dateRangeDescribedBy = () => {
    if (controller.dateRangeError() || timeZoneRangeInvalid())
      return ids.dateRangeError;
    return pastEventWarning() ? ids.pastEventWarning : undefined;
  };
  const recurrenceScopeReason = () => {
    if (editScope() !== 'this_event' || detailsLocked()) return undefined;
    return t('calendar.recurrenceScopeReason');
  };
  const capabilities = () => controller.selectedCalendarOption()?.capabilities;
  const conferenceLocked = () => {
    if (!isEdit() || capabilities()?.removeConference !== false) return false;
    const original = controller.initialConferenceChoice();
    return original === 'microsoft_teams' || original === 'existing';
  };
  const isOutOfOffice = controller.isOutOfOffice;
  const timeZoneRelevant = () => !state().allDay || isOutOfOffice();
  const metadata = createComposerMetadata({
    initial: options.initialMetadata,
    isEdit: isEdit(),
    timeZoneRelevant,
  });
  const isDirty = createMemo(() => controller.isDirty() || metadata.isDirty());
  const preparedSubmission = createMemo(() => {
    const values = controller.submitValues();
    return values ? metadata.submission(values, state()) : undefined;
  });
  const timeZoneRangeInvalid = () =>
    controller.canSave() && !preparedSubmission();
  const canSave = () => controller.canSave() && !timeZoneRangeInvalid();
  const metadataIsDisabled = () => {
    if (formIsDisabled() || detailsLocked()) return true;
    return fieldIsReadOnly('title');
  };
  const timeZoneIsDisabled = () => {
    if (metadataIsDisabled() || !timeZoneRelevant()) return true;
    if (isTimedPointEvent(state())) return true;
    return fieldIsReadOnly('start') || fieldIsReadOnly('end');
  };
  const setTimeZone = (zone: string) => {
    if (timeZoneIsDisabled()) return false;
    return metadata.setTimeZone(zone);
  };
  // Occurrence readbacks omit visibility overrides, so do not expose a write-only choice.
  const visibilityIsDisabled = () =>
    metadataIsDisabled() ||
    editScope() === 'this_event' ||
    options.visibilityReadOnlyReason !== undefined;
  const setVisibility = (visibility: EventVisibility) => {
    if (!visibilityIsDisabled()) metadata.setVisibility(visibility);
  };
  const transparencyIsDisabled = () =>
    metadataIsDisabled() ||
    isOutOfOffice() ||
    (isEdit() && metadata.state.transparency === undefined);
  const setTransparency = (value: EventTransparency) => {
    if (!transparencyIsDisabled()) metadata.setTransparency(value);
  };
  const resetDetails = () =>
    batch(() => {
      metadata.reset();
      controller.resetDetails();
    });
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
      return (
        controller.dateRangeError() !== undefined || timeZoneRangeInvalid()
      );
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
      return t('calendar.guestPolicyScopeReason');
    },
  };

  // Report model changes to the host's close guard and calendar selection owner.
  createEffect(on(isDirty, (dirty) => options.onDirtyChange?.(dirty)));
  createEffect(
    on(controller.selectedCalendarOption, (calendar) => {
      if (calendar) options.onCalendarChange?.(calendar.id, calendar.color);
    })
  );

  const submission = () => {
    const submission = preparedSubmission();
    if (!submission) return;
    const customRuleInNewZone =
      submission.changes.timeZoneChanged &&
      controller.recurrenceChoice() === 'custom';
    const ends = controller.customConfig().ends;
    let values = submission.values;
    // A zone change only reinterprets the inclusive end date. The editable
    // config omits fields such as WKST, so rebuilding the rule changes its meaning.
    if (customRuleInNewZone && ends.kind === 'on' && values.recurrenceLines) {
      values = {
        ...values,
        recurrenceLines: rezoneRecurrenceUntil(
          values.recurrenceLines,
          ends.date,
          values.time.kind === 'allDay',
          metadata.state.timeZone
        ),
      };
    }
    const scope = options.showRecurringEditNotice ? editScope() : undefined;
    return { values, scope, changes: submission.changes };
  };
  const submit = () => {
    const prepared = submission();
    if (!prepared || formIsDisabled()) return;
    if (Object.keys(prepared.changes).length > 0) {
      options.onSubmit(prepared.values, prepared.scope, prepared.changes);
    } else {
      options.onSubmit(prepared.values, prepared.scope);
    }
  };

  const when = createComposerWhen({
    range,
    setRange: controller.setRange,
    setAllDay: controller.setAllDay,
    detailsRevision: controller.detailsRevision,
  });
  onCleanup(() => when.close());
  return {
    when,
    options,
    controller,
    state,
    ids,
    isDirty,
    canSave,
    timeZoneRangeInvalid,
    metadataIsDisabled,
    visibilityIsDisabled,
    timeZoneIsDisabled,
    timeZone: () => metadata.state.timeZone,
    visibility: () => metadata.state.visibility,
    transparency: () =>
      metadata.state.transparency ?? (isEdit() ? undefined : 'opaque'),
    transparencyIsDisabled,
    setTransparency,
    setTimeZone,
    setVisibility,
    resetDetails,
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
    calendarColor: () =>
      controller.selectedCalendarOption()?.color ??
      DEFAULT_CALENDAR_SOURCE.color,
    conferenceLocked,
    isOutOfOffice,
    outOfOfficeNotice,
    showsDeclineMessage,
    showsGuestPolicy,
    range,
    guests,
    guestPolicy,
    submission,
    submit,
  };
}

export type CalendarComposerModel = ReturnType<typeof createCalendarComposer>;
