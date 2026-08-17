import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, cn, Layer } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  Show,
} from 'solid-js';
import { EventComposerDateTimeRangeFields } from './EventComposerDateTimeRangeFields';
import {
  EventComposerCalendarPill,
  EventComposerGuestsPill,
  EventComposerLocationPill,
  EventComposerRecurrencePill,
} from './EventComposerPropertyPills';
import {
  convertTimesForAllDay,
  createEventEditorState,
  defaultEditorInitialValues,
  type EventEditorCalendarOption,
  type EventEditorDisabledFields,
  type EventEditorGuestOption,
  type EventEditorInitialValues,
  type EventEditorSubmitValues,
  guestEmail,
  initialGuestOptions,
  moveAllDayRange,
  type SelectedEventEditorGuest,
} from './EventEditorForm';
import {
  type EventComposerFormSnapshot,
  isEventComposerFormDirty,
} from './event-composer-dirty';
import { RecurrenceBuilder } from './RecurrenceBuilder';

export interface EventComposerFormProps {
  initialValues?: EventEditorInitialValues;
  isEdit?: boolean;
  disabledFields?: EventEditorDisabledFields;
  calendarOptions: EventEditorCalendarOption[];
  guestOptions: Accessor<EventEditorGuestOption[]>;
  showRecurringEditNotice?: boolean;
  pending: boolean;
  class?: string;
  onCalendarChange?: (calendarId: string, color: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
  onSubmit: (values: EventEditorSubmitValues) => void;
}

/** Create/edit event form laid out like the standalone task composer. */
export function EventComposerForm(props: EventComposerFormProps) {
  const formId = createUniqueId();

  const dateRangeErrorId = `event-composer-date-range-error-${formId}`;

  const isEdit = () => props.isEdit ?? false;
  const initialValues =
    props.initialValues ?? defaultEditorInitialValues(new Date());
  const [state, setState] = createSignal<EventEditorInitialValues>({
    ...initialValues,
    recurrenceLines: [...initialValues.recurrenceLines],
  });

  const initialSelectedGuests = initialGuestOptions(
    initialValues.guests,
    props.guestOptions()
  );
  const initialGuestEmails = initialSelectedGuests.map(guestEmail);
  const [selectedGuests, setSelectedGuests] = createSignal<
    SelectedEventEditorGuest[]
  >(initialSelectedGuests);

  const fieldIsReadOnly = (field: keyof EventEditorDisabledFields) =>
    props.disabledFields?.[field] === true;
  const fieldIsDisabled = (field: keyof EventEditorDisabledFields) =>
    props.pending || fieldIsReadOnly(field);

  const {
    startForRecurrence,
    recurrenceChoice,
    recurrenceOptions,
    selectedRecurrenceOption,
    customConfig,
    setCustomConfig,
    changeRecurrenceChoice,
    recurrenceLines,
    dateRangeError,
    eventTime,
    canSave,
  } = createEventEditorState({ initialValues, state });

  const effectiveCalendarId = () =>
    state().calendarId ?? props.calendarOptions[0]?.id;

  const selectedCalendarOption = () =>
    props.calendarOptions.find(
      (option) => option.id === effectiveCalendarId()
    ) ?? props.calendarOptions[0];

  const initialSnapshot = (): EventComposerFormSnapshot => ({
    title: initialValues.title,
    allDay: initialValues.allDay,
    start: initialValues.start,
    end: initialValues.end,
    recurrenceLines: initialValues.recurrenceLines,
    calendarId: initialValues.calendarId ?? props.calendarOptions[0]?.id,
    guestEmails: initialGuestEmails,
    location: initialValues.location,
    description: initialValues.description,
  });
  const currentSnapshot = (): EventComposerFormSnapshot => {
    const current = state();
    return {
      title: current.title,
      allDay: current.allDay,
      start: current.start,
      end: current.end,
      recurrenceLines: recurrenceLines() ?? initialValues.recurrenceLines,
      calendarId: effectiveCalendarId(),
      guestEmails: selectedGuests().map(guestEmail),
      location: current.location,
      description: current.description,
    };
  };
  const isDirty = createMemo(() =>
    isEventComposerFormDirty(initialSnapshot(), currentSnapshot())
  );

  createEffect(() => {
    const option = selectedCalendarOption();
    if (option) props.onCalendarChange?.(option.id, option.color);
  });
  createEffect(() => props.onDirtyChange?.(isDirty()));

  const changeCalendar = (calendarId: string) =>
    setState({ ...state(), calendarId });

  const submit = () => {
    const time = eventTime();
    if (!time || !canSave() || props.pending) return;
    const current = state();
    props.onSubmit({
      title: current.title,
      time,
      recurrenceLines: recurrenceLines(),
      calendarId: effectiveCalendarId(),
      guestEmails: selectedGuests().map(guestEmail),
      location: current.location,
      description: current.description,
    });
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
            <div class="flex min-w-0 flex-col gap-0">
              <EventComposerDateTimeRangeFields
                start={state().start}
                end={state().end}
                allDay={state().allDay}
                onStartChange={(start) =>
                  setState(
                    state().allDay
                      ? moveAllDayRange(state(), start)
                      : { ...state(), start }
                  )
                }
                onEndChange={(end) => setState({ ...state(), end })}
                onAllDayChange={(allDay) =>
                  setState(convertTimesForAllDay(state(), allDay))
                }
                startDisabled={fieldIsDisabled('start')}
                endDisabled={fieldIsDisabled('end')}
                allDayDisabled={fieldIsDisabled('allDay')}
                invalid={dateRangeError() !== undefined}
                describedBy={dateRangeError() ? dateRangeErrorId : undefined}
              />
              <Show when={dateRangeError()}>
                {(error) => (
                  <p
                    id={dateRangeErrorId}
                    role="alert"
                    class="px-2 text-xs text-failure"
                  >
                    {error()}
                  </p>
                )}
              </Show>
            </div>

            <input
              type="text"
              value={state().title}
              onInput={(event) =>
                setState({ ...state(), title: event.currentTarget.value })
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
                  setState({
                    ...state(),
                    description: event.currentTarget.value.replaceAll(
                      /[\r\n]+/g,
                      ' '
                    ),
                  })
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
              options={props.calendarOptions}
              value={selectedCalendarOption()}
              onChange={changeCalendar}
              disabled={props.pending}
              readOnly={fieldIsReadOnly('calendar')}
            />
            <EventComposerRecurrencePill
              options={recurrenceOptions()}
              value={selectedRecurrenceOption()}
              onChange={changeRecurrenceChoice}
              disabled={props.pending}
              readOnly={fieldIsReadOnly('recurrence')}
            />
            <EventComposerGuestsPill
              options={props.guestOptions}
              selected={selectedGuests()}
              onChange={setSelectedGuests}
              disabled={props.pending}
              readOnly={fieldIsReadOnly('guests')}
            />
            <EventComposerLocationPill
              value={state().location}
              onChange={(location) => setState({ ...state(), location })}
              disabled={fieldIsDisabled('location')}
            />
          </div>
        </div>

        <Show when={recurrenceChoice() === 'custom'}>
          <Layer depth={3}>
            <div class="rounded-xl bg-surface p-4 text-ink">
              <RecurrenceBuilder
                value={customConfig()}
                start={startForRecurrence()}
                allDay={state().allDay}
                disabled={fieldIsDisabled('recurrence')}
                onChange={({
                  recurrenceDescription: _recurrenceDescription,
                  ...config
                }) => setCustomConfig(config)}
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
          disabled={props.pending}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={canSave() ? 'active' : 'ghost'}
          depth={3}
          class="rounded-lg border-0"
          disabled={!canSave() || props.pending}
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
