import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, cn, Layer } from '@ui';
import { createEffect, createUniqueId, Show } from 'solid-js';
import type { CalendarEventFormController } from './create-calendar-event-form-controller';
import { EventDateTimeRangeFields } from './EventDateTimeRangeFields';
import {
  EventComposerCalendarPill,
  EventComposerConferencePill,
  EventComposerGuestsPill,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
  EventComposerRemindersPill,
} from './EventPropertyPills';
import type {
  EventEditorDisabledFields,
  EventEditorSubmitValues,
} from './event-form-model';
import { RecurrenceBuilder } from './RecurrenceBuilder';

export interface EventFormProps {
  controller: CalendarEventFormController;
  isEdit?: boolean;
  disabledFields?: EventEditorDisabledFields;
  showRecurringEditNotice?: boolean;
  /** Disable interaction without presenting the form as an in-flight save. */
  disabled?: boolean;
  pending: boolean;
  class?: string;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (values: EventEditorSubmitValues) => void;
}

/** Create/edit event form laid out like the standalone task composer. */
export function EventForm(props: EventFormProps) {
  const formId = createUniqueId();

  const dateRangeErrorId = `event-composer-date-range-error-${formId}`;
  const pastEventWarningId = `event-composer-past-event-warning-${formId}`;

  const controller = props.controller;
  const state = controller.state;
  const isEdit = () => props.isEdit ?? false;
  const formIsDisabled = () => props.pending || props.disabled === true;

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

  createEffect(() => {
    const option = controller.selectedCalendarOption();
    if (option) props.onCalendarChange?.(option.id, option.color);
  });
  createEffect(() => props.onDirtyChange?.(controller.isDirty()));

  const submit = () => {
    const values = controller.submitValues();
    if (!values || formIsDisabled()) return;
    props.onSubmit(values);
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
              <EventDateTimeRangeFields
                start={state().start}
                end={state().end}
                allDay={state().allDay}
                onStartChange={controller.setStart}
                onEndChange={(end) => controller.setField('end', end)}
                onAllDayChange={controller.setAllDay}
                startDisabled={fieldIsDisabled('start')}
                endDisabled={fieldIsDisabled('end')}
                allDayDisabled={fieldIsDisabled('allDay')}
                invalid={controller.dateRangeError() !== undefined}
                describedBy={dateRangeDescribedBy()}
              />
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

            <input
              type="text"
              value={state().title}
              onInput={(event) =>
                controller.setField('title', event.currentTarget.value)
              }
              placeholder="New event"
              aria-label="Title"
              autofocus={!isEdit()}
              disabled={fieldIsDisabled('title')}
              class="h-9 w-full bg-transparent px-2 text-lg font-semibold leading-snug text-ink outline-none placeholder:text-ink-placeholder"
            />

            <div class="h-12">
              <textarea
                value={state().description}
                onInput={(event) =>
                  controller.setField(
                    'description',
                    event.currentTarget.value.replaceAll(/[\r\n]+/g, ' ')
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.preventDefault();
                }}
                placeholder="Add description..."
                aria-label="Description"
                rows={1}
                wrap="off"
                disabled={fieldIsDisabled('description')}
                class="h-full w-full resize-none overflow-x-auto bg-transparent px-2 text-sm text-ink outline-none placeholder:text-ink-placeholder"
              />
            </div>
          </div>

          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <EventComposerCalendarPill
              options={controller.calendarOptions()}
              value={controller.selectedCalendarOption()}
              onChange={(calendarId) =>
                controller.setField('calendarId', calendarId)
              }
              disabled={formIsDisabled()}
              readOnly={fieldIsReadOnly('calendar')}
            />
            <EventComposerRecurrencePill
              options={controller.recurrenceOptions()}
              value={controller.selectedRecurrenceOption()}
              onChange={controller.changeRecurrenceChoice}
              disabled={formIsDisabled()}
              readOnly={fieldIsReadOnly('recurrence')}
            />
            <EventComposerGuestsPill
              options={controller.guestOptions}
              selected={controller.selectedGuests()}
              onChange={controller.setSelectedGuests}
              disabled={formIsDisabled()}
              readOnly={fieldIsReadOnly('guests')}
            />
            <EventComposerConferencePill
              value={state().conference}
              canKeepExisting={
                controller.initialConferenceChoice() === 'existing'
              }
              onChange={(conference) =>
                controller.setField('conference', conference)
              }
              disabled={fieldIsDisabled('conference')}
            />
            <EventComposerLocationPill
              value={state().location}
              onChange={(location) => controller.setField('location', location)}
              disabled={fieldIsDisabled('location')}
            />
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
        </div>

        <Show when={controller.recurrenceChoice() === 'custom'}>
          <Layer depth={3}>
            <div class="rounded-xl bg-surface p-4 text-ink">
              <RecurrenceBuilder
                value={controller.customConfig()}
                start={controller.startForRecurrence()}
                allDay={state().allDay}
                disabled={fieldIsDisabled('recurrence')}
                onChange={controller.setCustomConfig}
              />
            </div>
          </Layer>
        </Show>
      </div>

      <div class="flex shrink-0 items-center justify-end gap-3">
        <Show when={props.showRecurringEditNotice}>
          <p class="mr-auto text-xs text-ink-extra-muted">
            Changes apply to all occurrences
          </p>
        </Show>
        <Button
          type="button"
          variant="ghost"
          class="rounded-lg"
          disabled={formIsDisabled()}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={controller.canSave() ? 'accent' : 'ghost'}
          depth={3}
          class="rounded-lg border-0"
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
