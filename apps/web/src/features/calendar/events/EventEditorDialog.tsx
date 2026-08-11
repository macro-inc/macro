import { toast } from '@core/component/Toast/Toast';
import SpinnerIcon from '@phosphor/spinner.svg';
import XIcon from '@phosphor/x.svg';
import { useVisibleCalendarsQuery } from '@queries/calendar/calendars';
import {
  useCreateCalendarEventMutation,
  useUpdateCalendarEventMutation,
} from '@queries/calendar/mutations';
import type { EventTime } from '@service-email/generated/schemas/eventTime';
import { Button, Dialog, Panel, ToggleSwitch } from '@ui';
import {
  addDays,
  addHours,
  addMonths,
  format,
  isMatch,
  parseISO,
  startOfHour,
} from 'date-fns';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { calendarDisplayLabel, spansMultipleInboxes } from '../calendar-label';
import { formatRecurrenceDescription } from './recurrence-description';
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
import type { CalendarEvent } from './types';

/** `<input type="date">` value. */
const DATE_VALUE = 'yyyy-MM-dd';
/** `<input type="datetime-local">` value. */
const DATETIME_VALUE = "yyyy-MM-dd'T'HH:mm";

const isDateOnly = (value: string) => isMatch(value, DATE_VALUE);

function shiftDateValue(value: string, days: number) {
  return format(addDays(parseISO(value), days), DATE_VALUE);
}

/** Default editor slot: the next full hour, one hour long. */
function defaultEditorTimes(reference: Date) {
  const start = addHours(startOfHour(reference), 1);
  return { start, end: addHours(start, 1) };
}

interface EditorState {
  title: string;
  allDay: boolean;
  /** `datetime-local` value, or `date` value in all-day mode. */
  start: string;
  /** Inclusive end shown to the user; all-day submissions add the exclusive day. */
  end: string;
  location: string;
  description: string;
  guests: string;
}

function initialEditorState(event: CalendarEvent | undefined): EditorState {
  if (!event) {
    const { start, end } = defaultEditorTimes(new Date());
    return {
      title: '',
      allDay: false,
      start: format(start, DATETIME_VALUE),
      end: format(end, DATETIME_VALUE),
      location: '',
      description: '',
      guests: '',
    };
  }
  if (event.allDay) {
    const start = isDateOnly(event.start)
      ? event.start
      : format(new Date(event.start), DATE_VALUE);
    const exclusiveEnd = isDateOnly(event.end)
      ? event.end
      : format(new Date(event.end), DATE_VALUE);
    return {
      title: event.title,
      allDay: true,
      start,
      end: shiftDateValue(exclusiveEnd, -1),
      location: event.location ?? '',
      description: event.description ?? '',
      guests: '',
    };
  }
  return {
    title: event.title,
    allDay: false,
    start: format(new Date(event.start), DATETIME_VALUE),
    end: format(new Date(event.end), DATETIME_VALUE),
    location: event.location ?? '',
    description: event.description ?? '',
    guests: '',
  };
}

function buildEventTime(state: EditorState): EventTime | undefined {
  if (state.allDay) {
    if (!state.start || !state.end || state.end < state.start) {
      return undefined;
    }
    return {
      kind: 'allDay',
      startDate: state.start,
      endDate: shiftDateValue(state.end, 1),
    };
  }
  const start = new Date(state.start);
  const end = new Date(state.end);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return undefined;
  }
  return {
    kind: 'timed',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function parseGuestEmails(value: string) {
  return [...new Set(value.split(/[\s,;]+/).filter((email) => email !== ''))];
}

/** Both editor times switch representation when all-day toggles. */
function convertTimesForAllDay(state: EditorState, allDay: boolean) {
  if (allDay === state.allDay) return state;
  if (allDay) {
    return {
      ...state,
      allDay,
      start: state.start.slice(0, 10),
      end: state.end.slice(0, 10),
    };
  }
  const { start, end } = defaultEditorTimes(parseISO(state.start));
  return {
    ...state,
    allDay,
    start: format(start, DATETIME_VALUE),
    end: format(end, DATETIME_VALUE),
  };
}

/**
 * Create/edit form for a calendar event. Editing a recurring event changes
 * the entire series; guests can only be invited at creation, because a
 * patch replaces the whole attendee list and would reset RSVPs.
 */
export function EventEditorDialog(props: {
  open: boolean;
  /** Present when editing; absent when creating. */
  event?: CalendarEvent;
  onClose: () => void;
}) {
  const [state, setState] = createSignal(initialEditorState(props.event));
  const isEdit = () => props.event !== undefined;
  const [calendarId, setCalendarId] = createSignal<string>();
  const calendarsQuery = useVisibleCalendarsQuery(() => ({
    enabled: !isEdit(),
  }));
  const writableCalendars = createMemo(
    () => calendarsQuery.data?.filter((calendar) => calendar.isWritable) ?? []
  );
  // The select displays the first writable calendar until touched, so submit
  // must resolve the same fallback rather than let the server pick its own.
  const effectiveCalendarId = () => calendarId() ?? writableCalendars()[0]?.id;
  const spansInboxes = createMemo(() =>
    spansMultipleInboxes(writableCalendars())
  );
  const calendarLabel = (calendar: {
    name: string;
    emailAddress: string;
    isPrimary: boolean;
  }) => calendarDisplayLabel(calendar, spansInboxes());

  const initialLines = props.event?.recurrenceLines ?? [];
  const initialConfig =
    initialLines.length > 0 ? parseRecurrenceConfig(initialLines) : undefined;
  const hasUnrepresentableRule = initialLines.length > 0 && !initialConfig;
  const startForRecurrence = createMemo(() => {
    const start = state().start;
    const parsed = state().allDay ? parseISO(start) : new Date(start);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  });
  const presets = createMemo(() => recurrencePresetsFor(startForRecurrence()));
  const initialChoice = () => {
    if (initialLines.length === 0) return 'none';
    if (!initialConfig) return 'existing';
    const preset = recurrencePresetsFor(
      props.event?.allDay
        ? parseISO(props.event.start)
        : new Date(props.event?.start ?? Date.now())
    ).find((candidate) =>
      recurrenceConfigsEqual(candidate.config, initialConfig)
    );
    return preset?.id ?? 'custom';
  };
  const [recurrenceChoice, setRecurrenceChoice] = createSignal(initialChoice());
  const [customConfig, setCustomConfig] = createSignal<RecurrenceConfig>(
    initialConfig ?? defaultCustomConfig(startForRecurrence())
  );
  const customValid = createMemo(() => {
    if (recurrenceChoice() !== 'custom') return true;
    const config = customConfig();
    if (!Number.isInteger(config.interval) || config.interval < 1) {
      return false;
    }
    if (config.frequency === 'WEEKLY' && config.byDay.length === 0) {
      return false;
    }
    if (config.ends.kind === 'on') return config.ends.date !== '';
    if (config.ends.kind === 'after') {
      return Number.isInteger(config.ends.count) && config.ends.count >= 1;
    }
    return true;
  });
  /** `undefined` leaves the stored rule untouched. */
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
  const isRecurring = () =>
    (props.event?.recurrenceLines.length ?? 0) > 0 ||
    props.event?.recurrenceId !== undefined;

  const invalidGuests = createMemo(() =>
    parseGuestEmails(state().guests).filter((email) => !email.includes('@'))
  );
  const eventTime = createMemo(() => buildEventTime(state()));
  const canSave = () =>
    eventTime() !== undefined && invalidGuests().length === 0 && customValid();

  const create = useCreateCalendarEventMutation({
    onSuccess: () => props.onClose(),
    onError: (error) => {
      toast.failure('Failed to create event', { subtext: error.message });
    },
  });
  const update = useUpdateCalendarEventMutation({
    onSuccess: () => props.onClose(),
    onError: (error) => {
      toast.failure('Failed to update event', { subtext: error.message });
    },
  });
  const pending = () => create.isPending || update.isPending;

  const save = () => {
    const time = eventTime();
    if (!time || pending()) return;

    const current = state();
    const event = props.event;
    const lines = recurrenceLines();
    if (event) {
      const recurrenceChanged =
        lines !== undefined && lines.join('\n') !== initialLines.join('\n');
      update.mutate({
        eventId: event.eventId,
        patch: {
          title: current.title,
          time,
          location: current.location,
          description: current.description,
          ...(recurrenceChanged ? { recurrenceLines: lines } : {}),
        },
      });
      return;
    }
    create.mutate({
      title: current.title,
      time,
      calendarId: effectiveCalendarId(),
      recurrenceLines: lines ?? [],
      location: current.location === '' ? undefined : current.location,
      description: current.description === '' ? undefined : current.description,
      attendees: parseGuestEmails(current.guests).map((email) => ({ email })),
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => !open && !pending() && props.onClose()}
    >
      <Panel
        depth={2}
        class="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl text-ink"
      >
        <Panel.Header class="gap-1 px-2">
          <Dialog.CloseButton
            as={Button}
            variant="ghost"
            size="icon-sm"
            disabled={pending()}
          >
            <XIcon />
          </Dialog.CloseButton>
          <Dialog.Title as="span" class="m-0 p-0 text-sm font-medium">
            {isEdit() ? 'Edit event' : 'New event'}
          </Dialog.Title>
        </Panel.Header>
        <Panel.Body class="flex flex-col gap-3 p-3">
          <input
            type="text"
            value={state().title}
            onInput={(e) =>
              setState({ ...state(), title: e.currentTarget.value })
            }
            placeholder="Add title"
            class="settings-input w-full"
          />
          <div class="flex items-center justify-between gap-2 text-xs text-ink-muted">
            <ToggleSwitch
              label="All day"
              checked={state().allDay}
              onChange={(allDay) =>
                setState(convertTimesForAllDay(state(), allDay))
              }
            />
            <Show when={isRecurring()}>
              <span class="text-ink-extra-muted">
                Changes apply to all occurrences
              </span>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <input
              type={state().allDay ? 'date' : 'datetime-local'}
              value={state().start}
              onInput={(e) =>
                setState({ ...state(), start: e.currentTarget.value })
              }
              aria-label="Start"
              class="settings-input min-w-0 flex-1"
            />
            <span class="shrink-0 text-xs text-ink-extra-muted">to</span>
            <input
              type={state().allDay ? 'date' : 'datetime-local'}
              value={state().end}
              onInput={(e) =>
                setState({ ...state(), end: e.currentTarget.value })
              }
              aria-label="End"
              class="settings-input min-w-0 flex-1"
            />
          </div>
          <div class="flex flex-col gap-2">
            <select
              value={recurrenceChoice()}
              onChange={(e) => {
                const choice = e.currentTarget.value;
                if (choice === 'custom') {
                  const seed =
                    presets().find((preset) => preset.id === recurrenceChoice())
                      ?.config ??
                    initialConfig ??
                    defaultCustomConfig(startForRecurrence());
                  setCustomConfig(seed);
                }
                setRecurrenceChoice(choice);
              }}
              aria-label="Repeats"
              class="settings-input w-full"
            >
              <option value="none">Does not repeat</option>
              <For each={presets()}>
                {(preset) => <option value={preset.id}>{preset.label}</option>}
              </For>
              <Show when={hasUnrepresentableRule}>
                <option value="existing">
                  {`Custom: ${
                    formatRecurrenceDescription(initialLines) ?? 'existing rule'
                  } (unchanged)`}
                </option>
              </Show>
              <option value="custom">Custom…</option>
            </select>
            <Show when={recurrenceChoice() === 'custom'}>
              <div class="border-edge-muted flex flex-col gap-2.5 rounded-lg border p-2.5 text-xs text-ink-muted">
                <div class="flex items-center gap-2">
                  <span>Repeat every</span>
                  <input
                    type="number"
                    min="1"
                    value={customConfig().interval}
                    onInput={(e) =>
                      setCustomConfig((config) => ({
                        ...config,
                        interval: e.currentTarget.valueAsNumber,
                      }))
                    }
                    aria-label="Repeat interval"
                    class="settings-input w-16"
                  />
                  <select
                    value={customConfig().frequency}
                    onChange={(e) =>
                      setCustomConfig((config) => ({
                        ...config,
                        frequency: e.currentTarget
                          .value as RecurrenceConfig['frequency'],
                      }))
                    }
                    aria-label="Repeat unit"
                    class="settings-input"
                  >
                    <option value="DAILY">day</option>
                    <option value="WEEKLY">week</option>
                    <option value="MONTHLY">month</option>
                    <option value="YEARLY">year</option>
                  </select>
                </div>
                <Show when={customConfig().frequency === 'WEEKLY'}>
                  <div class="flex items-center gap-1.5">
                    <span class="mr-1">Repeat on</span>
                    <For each={WEEKDAY_CODES}>
                      {(code) => (
                        <Button
                          variant={
                            customConfig().byDay.includes(code)
                              ? 'active'
                              : 'ghost'
                          }
                          size="icon-sm"
                          class="rounded-full text-xxs"
                          aria-label={code}
                          aria-pressed={customConfig().byDay.includes(code)}
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
                      name="recurrence-ends"
                      checked={customConfig().ends.kind === 'never'}
                      onChange={() => setEnds({ kind: 'never' })}
                    />
                    Never
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="radio"
                      name="recurrence-ends"
                      checked={customConfig().ends.kind === 'on'}
                      onChange={() =>
                        setEnds({
                          kind: 'on',
                          date: format(
                            addMonths(startForRecurrence(), 3),
                            'yyyy-MM-dd'
                          ),
                        })
                      }
                    />
                    On
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
                        onInput={(e) =>
                          setEnds({ kind: 'on', date: e.currentTarget.value })
                        }
                        aria-label="Ends on date"
                        class="settings-input"
                      />
                    </Show>
                  </label>
                  <label class="flex items-center gap-2">
                    <input
                      type="radio"
                      name="recurrence-ends"
                      checked={customConfig().ends.kind === 'after'}
                      onChange={() => setEnds({ kind: 'after', count: 13 })}
                    />
                    After
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
                        onInput={(e) =>
                          setEnds({
                            kind: 'after',
                            count: e.currentTarget.valueAsNumber,
                          })
                        }
                        aria-label="Ends after occurrences"
                        class="settings-input w-20"
                      />
                      occurrences
                    </Show>
                  </label>
                </div>
              </div>
            </Show>
          </div>
          <Show when={!isEdit() && writableCalendars().length > 1}>
            <select
              value={effectiveCalendarId()}
              onChange={(e) => setCalendarId(e.currentTarget.value)}
              aria-label="Calendar"
              class="settings-input w-full"
            >
              <For each={writableCalendars()}>
                {(calendar) => (
                  <option value={calendar.id}>{calendarLabel(calendar)}</option>
                )}
              </For>
            </select>
          </Show>
          <Show when={!isEdit()}>
            <div class="flex flex-col gap-1">
              <input
                type="text"
                value={state().guests}
                onInput={(e) =>
                  setState({ ...state(), guests: e.currentTarget.value })
                }
                placeholder="Add guests (comma-separated emails)"
                class="settings-input w-full"
                aria-invalid={invalidGuests().length > 0}
              />
              <Show when={invalidGuests().length > 0}>
                <span class="text-xs text-failure">
                  Invalid email: {invalidGuests().join(', ')}
                </span>
              </Show>
            </div>
          </Show>
          <input
            type="text"
            value={state().location}
            onInput={(e) =>
              setState({ ...state(), location: e.currentTarget.value })
            }
            placeholder="Add location"
            class="settings-input w-full"
          />
          <textarea
            value={state().description}
            onInput={(e) =>
              setState({ ...state(), description: e.currentTarget.value })
            }
            placeholder="Add description"
            rows={3}
            class="settings-input min-h-20 w-full resize-y py-2"
          />
          <div class="flex justify-end gap-1 pt-1">
            <Button
              variant="ghost"
              class="rounded-lg"
              disabled={pending()}
              label="Cancel"
              onClick={props.onClose}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              class="rounded-lg"
              disabled={!canSave() || pending()}
              label="Save"
              onClick={save}
            >
              <Show when={pending()} fallback="Save">
                <SpinnerIcon class="size-4 animate-spin" />
              </Show>
            </Button>
          </div>
        </Panel.Body>
      </Panel>
    </Dialog>
  );
}
