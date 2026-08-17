import { RecipientSelector } from '@core/component/RecipientSelector';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CalendarDotsIcon from '@phosphor/calendar-dots.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import TextAlignLeftIcon from '@phosphor/text-align-left.svg';
import UsersIcon from '@phosphor/users.svg';
import { Button, Checkbox, cn, Select, Tooltip } from '@ui';
import { addMonths, format } from 'date-fns';
import {
  type Accessor,
  createSignal,
  createUniqueId,
  For,
  Show,
} from 'solid-js';
import { EventDateField, EventDateTimeField } from './EventDateTimeField';
import {
  convertTimesForAllDay,
  createEventEditorState,
  defaultEditorInitialValues,
  type EventEditorCalendarOption,
  type EventEditorDisabledFields,
  type EventEditorField,
  type EventEditorGuestKind,
  type EventEditorGuestOption,
  type EventEditorInitialValues,
  type EventEditorSubmitValues,
  guestEmail,
  initialGuestOptions,
  moveAllDayRange,
  type SelectedEventEditorGuest,
} from './event-form-model';
import {
  type RecurrenceConfig,
  WEEKDAY_CODES,
  type WeekdayCode,
} from './recurrence-editor';

/** `<input type="date">` value. */
const DATE_VALUE = 'yyyy-MM-dd';

type EditorSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
};

const REPEAT_FREQUENCY_OPTIONS: EditorSelectOption<
  RecurrenceConfig['frequency']
>[] = [
  { value: 'DAILY', label: 'day' },
  { value: 'WEEKLY', label: 'week' },
  { value: 'MONTHLY', label: 'month' },
  { value: 'YEARLY', label: 'year' },
];

const EDITOR_INPUT_CLASS =
  'rounded-none! border-x-0! border-t-0! border-b! px-0! sm:text-xs!';
const EDITOR_TITLE_INPUT_CLASS =
  'rounded-none! border-x-0! border-t-0! border-b! px-0!';

export interface EventEditorFormProps {
  initialValues?: EventEditorInitialValues;
  disabledFields?: EventEditorDisabledFields;
  calendarOptions: EventEditorCalendarOption[];
  guestOptions: Accessor<EventEditorGuestOption[]>;
  showRecurringEditNotice?: boolean;
  pending: boolean;
  class?: string;
  onCancel: () => void;
  onSubmit: (values: EventEditorSubmitValues) => void;
}

/** Shared create/edit event form, independent of its dialog or drawer shell. */
export function EventEditorForm(props: EventEditorFormProps) {
  const formId = createUniqueId();
  const recurrenceEndsName = `recurrence-ends-${formId}`;
  const guestInputId = `event-guests-${formId}`;
  const dateRangeErrorId = `event-date-range-error-${formId}`;

  const initialValues =
    props.initialValues ?? defaultEditorInitialValues(new Date());

  const [state, setState] = createSignal<EventEditorInitialValues>({
    ...initialValues,
    recurrenceLines: [...initialValues.recurrenceLines],
  });

  const [selectedGuests, setSelectedGuests] = createSignal<
    SelectedEventEditorGuest[]
  >(initialGuestOptions(initialValues.guests, props.guestOptions()));

  const fieldIsDisabled = (field: EventEditorField) =>
    props.disabledFields?.[field] === true;

  const inputIsDisabled = (field: EventEditorField) =>
    props.pending || fieldIsDisabled(field);

  const effectiveCalendarId = () =>
    state().calendarId ?? props.calendarOptions[0]?.id;

  const editorState = createEventEditorState({ initialValues, state });
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
  } = editorState;

  const selectedFrequencyOption = () =>
    REPEAT_FREQUENCY_OPTIONS.find(
      (option) => option.value === customConfig().frequency
    ) ?? REPEAT_FREQUENCY_OPTIONS[0];

  const selectedCalendarOption = () =>
    props.calendarOptions.find(
      (option) => option.id === effectiveCalendarId()
    ) ?? props.calendarOptions[0];

  const toggleWeekday = (code: WeekdayCode) => {
    setCustomConfig((config) => ({
      ...config,
      byDay: config.byDay.includes(code)
        ? config.byDay.filter((day) => day !== code)
        : [...config.byDay, code],
    }));
  };

  const setEnds = (ends: RecurrenceConfig['ends']) =>
    setCustomConfig((config) => ({ ...config, ends }));

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

  const AllDayCheckbox = () => (
    <Checkbox
      checked={state().allDay}
      disabled={inputIsDisabled('allDay')}
      onChange={(allDay) => setState(convertTimesForAllDay(state(), allDay))}
      class="shrink-0 text-xs text-ink-muted"
    >
      <Checkbox.Control />
      <Checkbox.Label>All day</Checkbox.Label>
    </Checkbox>
  );

  return (
    <form
      class={cn(
        'grid grid-cols-[1.25rem_minmax(0,1fr)] gap-4 px-4 pb-4 pt-1 text-sm text-ink-muted sm:grid-cols-[1rem_minmax(0,1fr)] sm:text-xs [&_:disabled]:cursor-not-allowed',
        props.class
      )}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <CalendarBlankIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <div class="flex min-w-0 flex-col gap-3">
        <input
          type="text"
          value={state().title}
          onInput={(event) =>
            setState({ ...state(), title: event.currentTarget.value })
          }
          placeholder="Add title"
          aria-label="Title"
          class={cn(
            'settings-input h-auto min-h-9 w-full text-lg! font-semibold! leading-snug text-ink sm:text-base!',
            EDITOR_TITLE_INPUT_CLASS
          )}
          disabled={inputIsDisabled('title')}
        />

        <div class="flex min-w-0 flex-col gap-1">
          <Show
            when={state().allDay}
            fallback={
              <div class="flex min-w-0 items-center gap-1.5">
                <EventDateTimeField
                  label="Start"
                  value={state().start}
                  onChange={(start) => setState({ ...state(), start })}
                  disabled={inputIsDisabled('start')}
                  portalScope="local"
                  class="min-w-0 max-w-40 flex-1 basis-0"
                />
                <span aria-hidden="true" class="shrink-0 text-ink-extra-muted">
                  –
                </span>
                <EventDateTimeField
                  label="End"
                  value={state().end}
                  onChange={(end) => setState({ ...state(), end })}
                  disabled={inputIsDisabled('end')}
                  invalid={dateRangeError() !== undefined}
                  describedBy={dateRangeError() ? dateRangeErrorId : undefined}
                  portalScope="local"
                  class="min-w-0 max-w-40 flex-1 basis-0"
                />
              </div>
            }
          >
            <div class="flex min-w-0 items-center gap-1.5">
              <EventDateField
                label="Start"
                value={state().start}
                onChange={(date) => setState(moveAllDayRange(state(), date))}
                disabled={inputIsDisabled('start')}
                portalScope="local"
                class="min-w-0 max-w-40 flex-1 basis-0"
              />
              <span aria-hidden="true" class="shrink-0 text-ink-extra-muted">
                –
              </span>
              <EventDateField
                label="End"
                value={state().end}
                onChange={(end) => setState({ ...state(), end })}
                disabled={inputIsDisabled('end')}
                invalid={dateRangeError() !== undefined}
                describedBy={dateRangeError() ? dateRangeErrorId : undefined}
                portalScope="local"
                class="min-w-0 max-w-40 flex-1 basis-0"
              />
            </div>
          </Show>

          <Show when={dateRangeError()}>
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
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex min-w-0 items-center gap-3">
            <AllDayCheckbox />
            <Select<EditorSelectOption>
              options={recurrenceOptions()}
              value={selectedRecurrenceOption()}
              onChange={(option) =>
                option && changeRecurrenceChoice(option.value)
              }
              optionValue="value"
              optionTextValue="label"
              disabled={inputIsDisabled('recurrence')}
              class="ml-auto w-40 min-w-40 max-w-40 shrink-0"
            >
              <Select.Trigger aria-label="Repeats" class={EDITOR_INPUT_CLASS}>
                <Select.Value<EditorSelectOption>>
                  {(selectState) => selectState.selectedOption().label}
                </Select.Value>
                <Select.Icon />
              </Select.Trigger>
              <Select.Content portalScope="local">
                <Select.Listbox />
              </Select.Content>
            </Select>
          </div>

          <Show when={recurrenceChoice() === 'custom'}>
            <div class="border-edge-muted flex flex-col gap-2.5 rounded-lg border p-2.5 text-xs text-ink-muted">
              <div class="flex items-center gap-2">
                <span>Repeat every</span>
                <input
                  type="number"
                  min="1"
                  value={customConfig().interval}
                  onInput={(event) =>
                    setCustomConfig((config) => ({
                      ...config,
                      interval: event.currentTarget.valueAsNumber,
                    }))
                  }
                  aria-label="Repeat interval"
                  class={cn('settings-input w-16', EDITOR_INPUT_CLASS)}
                  disabled={inputIsDisabled('recurrence')}
                />
                <Select<EditorSelectOption<RecurrenceConfig['frequency']>>
                  options={REPEAT_FREQUENCY_OPTIONS}
                  value={selectedFrequencyOption()}
                  onChange={(option) =>
                    option &&
                    setCustomConfig((config) => ({
                      ...config,
                      frequency: option.value,
                    }))
                  }
                  optionValue="value"
                  optionTextValue="label"
                  disabled={inputIsDisabled('recurrence')}
                >
                  <Select.Trigger
                    aria-label="Repeat unit"
                    class={cn('w-28', EDITOR_INPUT_CLASS)}
                  >
                    <Select.Value<
                      EditorSelectOption<RecurrenceConfig['frequency']>
                    >>
                      {(selectState) => selectState.selectedOption().label}
                    </Select.Value>
                    <Select.Icon />
                  </Select.Trigger>
                  <Select.Content portalScope="local">
                    <Select.Listbox />
                  </Select.Content>
                </Select>
              </div>

              <Show when={customConfig().frequency === 'WEEKLY'}>
                <div class="flex items-center gap-1.5">
                  <span class="mr-1">Repeat on</span>
                  <For each={WEEKDAY_CODES}>
                    {(code) => (
                      <Button
                        type="button"
                        variant={
                          customConfig().byDay.includes(code)
                            ? 'active'
                            : 'ghost'
                        }
                        size="icon-sm"
                        class="rounded-full text-xxs"
                        aria-label={code}
                        aria-pressed={customConfig().byDay.includes(code)}
                        disabled={inputIsDisabled('recurrence')}
                        onClick={() => toggleWeekday(code)}
                      >
                        {code[0]}
                      </Button>
                    )}
                  </For>
                </div>
              </Show>

              <div class="flex flex-col gap-1.5">
                <span>Ends</span>
                <label class="flex items-center gap-2">
                  <input
                    type="radio"
                    name={recurrenceEndsName}
                    checked={customConfig().ends.kind === 'never'}
                    onChange={() => setEnds({ kind: 'never' })}
                    disabled={inputIsDisabled('recurrence')}
                  />
                  Never
                </label>
                <div class="flex items-center gap-2">
                  <label class="flex items-center gap-2">
                    <input
                      type="radio"
                      name={recurrenceEndsName}
                      checked={customConfig().ends.kind === 'on'}
                      onChange={() =>
                        setEnds({
                          kind: 'on',
                          date: format(
                            addMonths(startForRecurrence(), 3),
                            DATE_VALUE
                          ),
                        })
                      }
                      disabled={inputIsDisabled('recurrence')}
                    />
                    On
                  </label>
                  <Show when={customConfig().ends.kind === 'on'}>
                    <input
                      type="date"
                      value={
                        customConfig().ends.kind === 'on'
                          ? (
                              customConfig().ends as {
                                kind: 'on';
                                date: string;
                              }
                            ).date
                          : ''
                      }
                      onInput={(event) =>
                        setEnds({
                          kind: 'on',
                          date: event.currentTarget.value,
                        })
                      }
                      aria-label="Ends on date"
                      class={cn('settings-input', EDITOR_INPUT_CLASS)}
                      disabled={inputIsDisabled('recurrence')}
                    />
                  </Show>
                </div>
                <div class="flex items-center gap-2">
                  <label class="flex items-center gap-2">
                    <input
                      type="radio"
                      name={recurrenceEndsName}
                      checked={customConfig().ends.kind === 'after'}
                      onChange={() => setEnds({ kind: 'after', count: 13 })}
                      disabled={inputIsDisabled('recurrence')}
                    />
                    After
                  </label>
                  <Show when={customConfig().ends.kind === 'after'}>
                    <input
                      type="number"
                      min="1"
                      value={
                        customConfig().ends.kind === 'after'
                          ? (
                              customConfig().ends as {
                                kind: 'after';
                                count: number;
                              }
                            ).count
                          : 13
                      }
                      onInput={(event) =>
                        setEnds({
                          kind: 'after',
                          count: event.currentTarget.valueAsNumber,
                        })
                      }
                      aria-label="Ends after occurrences"
                      class={cn('settings-input w-20', EDITOR_INPUT_CLASS)}
                      disabled={inputIsDisabled('recurrence')}
                    />
                    <span>occurrences</span>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <Show
        when={props.calendarOptions.length > 1 || fieldIsDisabled('calendar')}
      >
        <div class="contents">
          <CalendarDotsIcon
            aria-hidden="true"
            class="mt-2 size-5 text-ink-extra-muted sm:size-4"
          />
          <Tooltip
            label="Moving an existing event to another calendar is not currently supported"
            placement="bottom"
            disabled={!fieldIsDisabled('calendar')}
            class="w-full"
          >
            <div class="w-full">
              <Select<EventEditorCalendarOption>
                options={props.calendarOptions}
                value={selectedCalendarOption()}
                onChange={(option) =>
                  option && setState({ ...state(), calendarId: option.id })
                }
                optionValue="id"
                optionTextValue="label"
                disabled={inputIsDisabled('calendar')}
              >
                <Select.Trigger
                  aria-label="Calendar"
                  class={EDITOR_INPUT_CLASS}
                >
                  <Select.Value<EventEditorCalendarOption>>
                    {(selectState) => selectState.selectedOption().label}
                  </Select.Value>
                  <Select.Icon />
                </Select.Trigger>
                <Select.Content portalScope="local">
                  <Select.Listbox />
                </Select.Content>
              </Select>
            </div>
          </Tooltip>
        </div>
      </Show>

      <UsersIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <div class="min-w-0">
        <label for={guestInputId} class="sr-only">
          Guests
        </label>
        <Tooltip
          label="Adding guests to an existing event is not currently supported"
          placement="bottom"
          disabled={!fieldIsDisabled('guests')}
          class="w-full"
        >
          <div class="w-full">
            <RecipientSelector<EventEditorGuestKind>
              inputId={guestInputId}
              options={props.guestOptions}
              selectedOptions={selectedGuests()}
              setSelectedOptions={(next) => {
                if (!inputIsDisabled('guests')) setSelectedGuests(next);
              }}
              placeholder="Add guests"
              hideBorder
              noPadding
              disabled={inputIsDisabled('guests')}
              portalScope="local"
              class={cn(
                'min-h-9 border-edge-muted bg-transparent! py-1 text-sm focus-within:border-accent sm:text-xs [&_input]:sm:text-xs!',
                EDITOR_INPUT_CLASS,
                inputIsDisabled('guests') && 'opacity-70'
              )}
            />
          </div>
        </Tooltip>
      </div>

      <MapPinIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <input
        type="text"
        value={state().location}
        onInput={(event) =>
          setState({ ...state(), location: event.currentTarget.value })
        }
        placeholder="Add location"
        aria-label="Location"
        class={cn('settings-input w-full', EDITOR_INPUT_CLASS)}
        disabled={inputIsDisabled('location')}
      />

      <TextAlignLeftIcon
        aria-hidden="true"
        class="mt-2 size-5 text-ink-extra-muted sm:size-4"
      />

      <textarea
        value={state().description}
        onInput={(event) =>
          setState({ ...state(), description: event.currentTarget.value })
        }
        placeholder="Add description"
        aria-label="Description"
        rows={3}
        class={cn(
          'settings-input min-h-20 w-full resize-y py-2',
          EDITOR_INPUT_CLASS
        )}
        disabled={inputIsDisabled('description')}
      />

      <Show when={props.showRecurringEditNotice}>
        <span class="col-start-2 text-xs text-ink-extra-muted">
          Changes apply to all occurrences
        </span>
      </Show>

      <div class="border-edge-muted col-span-2 -mx-4 -mb-4 flex items-center justify-end gap-1 border-t bg-active px-4 py-2.5">
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
          variant="cta"
          class="rounded-lg"
          disabled={!canSave() || props.pending}
          aria-label="Save"
        >
          <Show when={props.pending} fallback="Save">
            <SpinnerIcon class="size-4 animate-spin" />
          </Show>
        </Button>
      </div>
    </form>
  );
}
