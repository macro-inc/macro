import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, cn, Select } from '@ui';
import { addMonths, format, parseISO } from 'date-fns';
import {
  type Accessor,
  createMemo,
  createSignal,
  createUniqueId,
  For,
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
  buildEventTime,
  convertTimesForAllDay,
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
  buildRecurrenceLines,
  defaultCustomConfig,
  parseRecurrenceConfig,
  type RecurrenceConfig,
  recurrenceConfigsEqual,
  recurrencePresetsFor,
  WEEKDAY_CODES,
  type WeekdayCode,
} from './recurrence-editor';
import { formatRecurrenceDescription } from './recurrence-description';

const DATE_VALUE = 'yyyy-MM-dd';
type ComposerSelectOption<Value extends string = string> = {
  value: Value;
  label: string;
};

const REPEAT_FREQUENCY_OPTIONS: ComposerSelectOption<
  RecurrenceConfig['frequency']
>[] = [
  { value: 'DAILY', label: 'day' },
  { value: 'WEEKLY', label: 'week' },
  { value: 'MONTHLY', label: 'month' },
  { value: 'YEARLY', label: 'year' },
];

export interface EventComposerFormProps {
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

/** Create/edit event form laid out like the standalone task composer. */
export function EventComposerForm(props: EventComposerFormProps) {
  const formId = createUniqueId();

  const recurrenceEndsName = `event-composer-recurrence-ends-${formId}`;
  const dateRangeErrorId = `event-composer-date-range-error-${formId}`;

  const isEdit = () => props.initialValues !== undefined;
  const initialValues =
    props.initialValues ?? defaultEditorInitialValues(new Date());
  const initialLines = [...initialValues.recurrenceLines];
  const initialConfig =
    initialLines.length > 0 ? parseRecurrenceConfig(initialLines) : undefined;
  const hasUnrepresentableRule = initialLines.length > 0 && !initialConfig;

  const [state, setState] = createSignal<EventEditorInitialValues>({
    ...initialValues,
    recurrenceLines: [...initialLines],
  });

  const [selectedGuests, setSelectedGuests] = createSignal<
    SelectedEventEditorGuest[]
  >(initialGuestOptions(initialValues.guests, props.guestOptions()));

  const fieldIsReadOnly = (field: keyof EventEditorDisabledFields) =>
    props.disabledFields?.[field] === true;
  const fieldIsDisabled = (field: keyof EventEditorDisabledFields) =>
    props.pending || fieldIsReadOnly(field);

  const startForRecurrence = createMemo(() => {
    const start = state().start;
    const parsed = state().allDay ? parseISO(start) : new Date(start);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });

  const presets = createMemo(() => recurrencePresetsFor(startForRecurrence()));

  const initialChoice = () => {
    if (initialLines.length === 0) return 'none';
    if (!initialConfig) return 'existing';
    const initialStart = initialValues.allDay
      ? parseISO(initialValues.start)
      : new Date(initialValues.start);
    const preset = recurrencePresetsFor(initialStart).find((candidate) =>
      recurrenceConfigsEqual(candidate.config, initialConfig)
    );
    return preset?.id ?? 'custom';
  };

  const [recurrenceChoice, setRecurrenceChoice] = createSignal(initialChoice());

  const recurrenceOptions = createMemo<ComposerSelectOption[]>(() => {
    const options = [
      { value: 'none', label: 'Does not repeat' },
      ...presets().map((preset) => ({
        value: preset.id,
        label: preset.label,
      })),
    ];
    if (hasUnrepresentableRule) {
      options.push({
        value: 'existing',
        label: `Custom: ${
          formatRecurrenceDescription(initialLines) ?? 'existing rule'
        } (unchanged)`,
      });
    }
    options.push({ value: 'custom', label: 'Custom' });
    return options;
  });

  const selectedRecurrenceOption = () =>
    recurrenceOptions().find((option) => option.value === recurrenceChoice()) ??
    recurrenceOptions()[0];

  const [customConfig, setCustomConfig] = createSignal<RecurrenceConfig>(
    initialConfig ?? defaultCustomConfig(startForRecurrence())
  );

  const selectedFrequencyOption = () =>
    REPEAT_FREQUENCY_OPTIONS.find(
      (option) => option.value === customConfig().frequency
    ) ?? REPEAT_FREQUENCY_OPTIONS[0];

  const effectiveCalendarId = () =>
    state().calendarId ?? props.calendarOptions[0]?.id;

  const selectedCalendarOption = () =>
    props.calendarOptions.find(
      (option) => option.id === effectiveCalendarId()
    ) ?? props.calendarOptions[0];

  const changeRecurrenceChoice = (choice: string) => {
    if (choice === 'custom') {
      const seed =
        presets().find((preset) => preset.id === recurrenceChoice())?.config ??
        initialConfig ??
        defaultCustomConfig(startForRecurrence());
      setCustomConfig(seed);
    }
    setRecurrenceChoice(choice);
  };

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

  const customValid = createMemo(() => {
    if (recurrenceChoice() !== 'custom') return true;
    const config = customConfig();
    if (!Number.isInteger(config.interval) || config.interval < 1) return false;
    if (config.frequency === 'WEEKLY' && config.byDay.length === 0) {
      return false;
    }
    if (config.ends.kind === 'on') return config.ends.date !== '';
    if (config.ends.kind === 'after') {
      return Number.isInteger(config.ends.count) && config.ends.count >= 1;
    }
    return true;
  });

  const recurrenceLines = (): string[] | undefined => {
    const choice = recurrenceChoice();
    if (choice === 'existing') return undefined;
    if (choice === 'none') return [];
    if (choice === 'custom') {
      return buildRecurrenceLines(customConfig(), state().allDay);
    }
    const preset = presets().find((candidate) => candidate.id === choice);
    return preset
      ? buildRecurrenceLines(preset.config, state().allDay)
      : undefined;
  };

  const dateRangeError = createMemo(() => {
    const current = state();
    if (!current.start || !current.end) return undefined;
    if (current.allDay) {
      return current.end < current.start
        ? 'End date cannot be before the start date.'
        : undefined;
    }
    const start = new Date(current.start);
    const end = new Date(current.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return undefined;
    }
    return end <= start ? 'End time must be after the start time.' : undefined;
  });

  const eventTime = createMemo(() => buildEventTime(state()));
  const canSave = () =>
    state().title.trim() !== '' && eventTime() !== undefined && customValid();

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
              onChange={(calendarId) => setState({ ...state(), calendarId })}
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
          <div class="flex flex-col gap-2.5 rounded-lg border border-edge-muted p-3 text-xs text-ink-muted">
            <div class="flex flex-wrap items-center gap-2">
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
                class="settings-input h-7 w-16"
                disabled={fieldIsDisabled('recurrence')}
              />
              <Select<ComposerSelectOption<RecurrenceConfig['frequency']>>
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
                disabled={fieldIsDisabled('recurrence')}
              >
                <Select.Trigger
                  aria-label="Repeat unit"
                  class="settings-input h-7 w-28"
                >
                  <Select.Value<
                    ComposerSelectOption<RecurrenceConfig['frequency']>
                  >>
                    {(selectState) => selectState.selectedOption().label}
                  </Select.Value>
                  <Select.Icon />
                </Select.Trigger>
                <Select.Content>
                  <Select.Listbox />
                </Select.Content>
              </Select>
            </div>

            <Show when={customConfig().frequency === 'WEEKLY'}>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="mr-1">Repeat on</span>
                <For each={WEEKDAY_CODES}>
                  {(code) => (
                    <Button
                      type="button"
                      variant={
                        customConfig().byDay.includes(code) ? 'active' : 'ghost'
                      }
                      size="icon-sm"
                      class="rounded-full text-xxs"
                      aria-label={code}
                      aria-pressed={customConfig().byDay.includes(code)}
                      disabled={fieldIsDisabled('recurrence')}
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
                  disabled={fieldIsDisabled('recurrence')}
                />
                Never
              </label>
              <label class="flex flex-wrap items-center gap-2">
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
                  disabled={fieldIsDisabled('recurrence')}
                />
                On
                <Show when={customConfig().ends.kind === 'on'}>
                  <input
                    type="date"
                    value={
                      customConfig().ends.kind === 'on'
                        ? customConfig().ends.date
                        : ''
                    }
                    onInput={(event) =>
                      setEnds({
                        kind: 'on',
                        date: event.currentTarget.value,
                      })
                    }
                    aria-label="Ends on date"
                    class="settings-input h-7"
                    disabled={fieldIsDisabled('recurrence')}
                  />
                </Show>
              </label>
              <label class="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={recurrenceEndsName}
                  checked={customConfig().ends.kind === 'after'}
                  onChange={() => setEnds({ kind: 'after', count: 13 })}
                  disabled={fieldIsDisabled('recurrence')}
                />
                After
                <Show when={customConfig().ends.kind === 'after'}>
                  <input
                    type="number"
                    min="1"
                    value={
                      customConfig().ends.kind === 'after'
                        ? customConfig().ends.count
                        : 13
                    }
                    onInput={(event) =>
                      setEnds({
                        kind: 'after',
                        count: event.currentTarget.valueAsNumber,
                      })
                    }
                    aria-label="Ends after occurrences"
                    class="settings-input h-7 w-20"
                    disabled={fieldIsDisabled('recurrence')}
                  />
                  occurrences
                </Show>
              </label>
            </div>
          </div>
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
          label="Cancel"
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
          label={isEdit() ? 'Save' : 'Create event'}
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
