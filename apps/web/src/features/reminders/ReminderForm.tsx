import { toast } from '@core/component/Toast/Toast';
import {
  type CronParts,
  DEFAULT_WEEKDAYS,
  describeCron,
  getDefaultTimezone,
  isCronRepresentable,
  isValidCronParts,
  type ScheduleFrequency,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';
import { parseTime, useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { TZDateMini } from '@date-fns/tz';
import CaretDownIcon from '@phosphor/caret-down.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { ActionDialogShell, Button, Input } from '@ui';
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import {
  formatReminderInstant,
  isRecurring,
  onceSchedule,
  parseLocalReminderDateTime,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  recurringSchedule,
  reminderQuickPresets,
  repeatPartsFromDate,
  repeatPartsFromSchedule,
} from './reminder-schedule';
import { TimezoneSelect } from './TimezoneSelect';

/** How a reminder repeats: not at all (a one-shot), or on a weekly/monthly cron. */
type RepeatKind = 'once' | ScheduleFrequency;

/** What the form hands back on submit: the raw title and the chosen schedule. */
export interface ReminderFormValues {
  /** The raw title input; the caller resolves and clamps it per its mode. */
  description: string;
  /**
   * The schedule to store. On an unchanged edit this is the reminder's original
   * schedule verbatim, so the caller's diff omits it — which is what lets an
   * overdue reminder be renamed without being rejected as in the past.
   */
  schedule: ReminderSchedule;
}

export interface ReminderFormProps {
  /** Prefilled title. Absent when creating. */
  initialDescription?: string;
  /**
   * The reminder's current schedule, when editing one. Its presence marks the
   * form as an edit: only then can an untouched schedule be sent back unchanged.
   */
  initialSchedule?: ReminderSchedule;
  /**
   * The reminder's next firing, when editing one. Seeds the one-shot date/time
   * so switching a recurring reminder to "Does not repeat" defaults to its next
   * occurrence rather than a generic tomorrow-morning slot.
   */
  initialRemindAt?: Date | string;
  placeholder: string;
  /** A standalone reminder has no entity to name it after, so it needs a title. */
  descriptionRequired?: boolean;
  /** A card or chip for the entity this reminder is about, shown above the title. */
  reference?: JSX.Element;
  submitLabel: string;
  pending?: boolean;
  error?: string;
  /** Dialog hosts provide their heading and use a padded body with a fixed footer. */
  header?: JSX.Element;
  layout?: 'dialog' | 'inline';
  autofocus?: boolean;
  onCancel: () => void;
  onSubmit: (values: ReminderFormValues) => void;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for a date in local time — the value a `<input type="date">` takes. */
function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM` for a date in local time — the value a `<input type="time">` takes. */
function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whether two picker recurrences say the same thing, ignoring day order. */
function samePartsShape(a: CronParts, b: CronParts): boolean {
  return (
    a.frequency === b.frequency &&
    a.time === b.time &&
    a.dayOfMonth === b.dayOfMonth &&
    a.daysOfWeek.length === b.daysOfWeek.length &&
    a.daysOfWeek.every((day) => b.daysOfWeek.includes(day))
  );
}

/** The same instant, at `REMINDER_DEFAULT_TIME`, one day out — the create default. */
function atDefault(now: Date): Date {
  const result = new Date(now);
  result.setDate(result.getDate() + 1);
  result.setHours(
    REMINDER_DEFAULT_TIME.hours,
    REMINDER_DEFAULT_TIME.minutes,
    0,
    0
  );
  return result;
}

const ALL_WEEKDAYS = WEEKDAY_OPTIONS.map((option) => option.value);

function sameDays(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((day) => b.includes(day));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** The control values to open with, derived from the reminder (or the defaults). */
function deriveSeed(
  description: string | undefined,
  schedule: ReminderSchedule | undefined,
  remindAt: Date | string | undefined
) {
  const now = new Date();
  const recurring = schedule !== undefined && isRecurring(schedule);
  // The reminder's next firing seeds the one-shot fields — for a recurring
  // reminder that is its next occurrence, so switching to "Does not repeat"
  // lands there rather than on a generic tomorrow-morning slot.
  const onceSeedDate = remindAt ? new Date(remindAt) : atDefault(now);
  const parts = recurring
    ? repeatPartsFromSchedule(schedule)
    : repeatPartsFromDate(onceSeedDate);
  const kind: RepeatKind = recurring ? parts.frequency : 'once';

  return {
    description: description ?? '',
    repeat: kind,
    onceDate: toDateInput(onceSeedDate),
    onceTime: toTimeInput(onceSeedDate),
    parts,
    // The zone a recurring reminder was built in, so re-sending an edited
    // recurrence keeps firing at the same wall-clock time even when the editor
    // sits in a different timezone. Absent for a one-shot or a new recurrence.
    recurringTimezone: recurring ? schedule.timezone : undefined,
    // What an untouched edit sends back unchanged. For a create the controls
    // are always rebuilt (and past-checked), so this is only read on edit.
    originalSchedule: schedule ?? onceSchedule(onceSeedDate),
  };
}

/** The zone's offset from UTC at `instant`, as sortable minutes and a ±HH:MM tag. */
function gmtOffset(
  zone: string,
  instant: Date
): { minutes: number; text: string } {
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return { minutes: 0, text: '+00:00' };
  const sign = match[1] === '-' ? -1 : 1;
  const minutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  return { minutes, text: `${match[1]}${match[2]}:${match[3]}` };
}

/** A short zone tag ("EDT", "GMT+5:30") for the schedule summary and once view. */
function shortZone(zone: string, instant = new Date()): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')?.value ?? zone
  );
}

/**
 * Every IANA zone the runtime lists, labelled with its current GMT offset and
 * ordered by that offset so the list reads west-to-east. Built once — the set
 * does not change within a session.
 */
const TIMEZONE_OPTIONS: { value: string; label: string }[] = (() => {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [getDefaultTimezone()];
  const now = new Date();
  return zones
    .map((zone) => {
      const offset = gmtOffset(zone, now);
      return {
        value: zone,
        label: `(GMT${offset.text}) ${zone.replace(/_/g, ' ')}`,
        order: offset.minutes,
      };
    })
    .sort((a, b) => a.order - b.order || a.value.localeCompare(b.value))
    .map(({ value, label }) => ({ value, label }));
})();

/**
 * The reminder editor's fields — title, how it repeats, and when — shared by the
 * create modal and the edit split.
 *
 * It owns the controls and their validity and hands back the resolved
 * `{ description, schedule }` on submit; the caller decides whether that is a
 * create or an update. The title and schedule sit together, laid out like the
 * calendar event editor, so either can be changed in one pass.
 */
export function ReminderForm(props: ReminderFormProps) {
  const seed = deriveSeed(
    props.initialDescription,
    props.initialSchedule,
    props.initialRemindAt
  );
  const isEdit = props.initialSchedule !== undefined;

  const localZone = getDefaultTimezone();
  const openedAt = new Date();
  const [description, setDescription] = createSignal(seed.description);
  const [repeat, setRepeat] = createSignal<RepeatKind>(seed.repeat);
  const [onceDate, setOnceDate] = createSignal(seed.onceDate);
  const [onceTime, setOnceTime] = createSignal(seed.onceTime);
  // Presets and parsed durations carry an instant as well as wall-clock fields.
  // Keep it so the repeated hour at DST fall-back does not collapse to the
  // browser's first interpretation of an ambiguous `YYYY-MM-DDTHH:MM` value.
  // Existing one-shots need the same treatment: their ISO timestamp says
  // which copy of a repeated wall time they use, while the native fields do not.
  const [selectedOnceInstant, setSelectedOnceInstant] = createSignal<
    Date | undefined
  >(
    isEdit
      ? seed.originalSchedule.type === 'once'
        ? new Date(seed.originalSchedule.remindAt)
        : props.initialRemindAt
          ? new Date(props.initialRemindAt)
          : undefined
      : undefined
  );
  const [repeatParts, setRepeatParts] = createSignal<CronParts>(seed.parts);
  // A recurring cron fires at a wall-clock time in this zone. It defaults to the
  // reminder's stored zone (or the viewer's, for a new recurrence) and is
  // editable, so a reminder can fire in a zone other than the one editing it.
  const [timezone, setTimezone] = createSignal(
    seed.recurringTimezone ?? localZone
  );
  const [whenQuery, setWhenQuery] = createSignal('');
  const [showCustomTime, setShowCustomTime] = createSignal(false);
  const storedCronIsCustom =
    isEdit &&
    props.initialSchedule !== undefined &&
    isRecurring(props.initialSchedule) &&
    !isCronRepresentable(props.initialSchedule.cron);
  const [customScheduleReplaced, setCustomScheduleReplaced] =
    createSignal(false);
  // Week and month have different editable day shapes. Remember each shape
  // once it is intentional so crossing cadences can seed a missing shape from
  // the selected occurrence without throwing away edits when switching back.
  const [savedWeeklyDays, setSavedWeeklyDays] = createSignal<
    string[] | undefined
  >(
    !storedCronIsCustom &&
      seed.repeat === 'week' &&
      !sameDays(seed.parts.daysOfWeek, ALL_WEEKDAYS) &&
      !sameDays(seed.parts.daysOfWeek, DEFAULT_WEEKDAYS)
      ? [...seed.parts.daysOfWeek]
      : undefined
  );
  const [savedMonthlyDay, setSavedMonthlyDay] = createSignal<
    string | undefined
  >(
    !storedCronIsCustom && seed.repeat === 'month'
      ? seed.parts.dayOfMonth
      : undefined
  );
  const quickPresets = reminderQuickPresets(openedAt);

  const dateOptions = useDateSearch({
    query: whenQuery,
    baseDate: openedAt,
    defaultTime: REMINDER_DEFAULT_TIME,
    maxItems: 4,
  });

  // What the schedule controls were seeded to, so an untouched edit can be told
  // from a real change without depending on second-level precision the pickers
  // do not carry.
  const initialRepeat = seed.repeat;
  const initialOnceDate = seed.onceDate;
  const initialOnceTime = seed.onceTime;
  const initialOnceInstant =
    seed.originalSchedule.type === 'once'
      ? new Date(seed.originalSchedule.remindAt)
      : new Date(`${initialOnceDate}T${initialOnceTime}`);
  const initialParts = seed.parts;
  const initialTimezone = seed.recurringTimezone ?? localZone;

  const formId = createUniqueId();
  const descriptionId = createUniqueId();
  const whenLabelId = createUniqueId();
  const whenInputId = createUniqueId();
  const whenOptionsId = createUniqueId();
  let titleRef: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autofocus) titleRef?.focus();
  });

  const pickedOnceDateTime = () =>
    selectedOnceInstant() ?? parseLocalReminderDateTime(onceDate(), onceTime());
  const typedTime = () => parseTime(whenQuery())?.time;
  const typedWallTimeIsInvalid = () => {
    const time = typedTime();
    const option = dateOptions()[0];
    return (
      time !== undefined &&
      option !== undefined &&
      (option.date.getHours() !== time.hours ||
        option.date.getMinutes() !== time.minutes)
    );
  };
  const typedOnceDateTime = () => {
    if (!whenQuery().trim()) return undefined;
    if (typedWallTimeIsInvalid()) return undefined;
    const option = dateOptions()[0];
    if (!option) return undefined;
    return new Date(option.date);
  };
  const onceDateTime = () => typedOnceDateTime() ?? pickedOnceDateTime();
  const typedWhenIsValid = () =>
    !whenQuery().trim() || typedOnceDateTime() !== undefined;
  const customWallTimeIsInvalid = () =>
    showCustomTime() &&
    !whenQuery().trim() &&
    selectedOnceInstant() === undefined &&
    onceDate() !== '' &&
    onceTime() !== '' &&
    parseLocalReminderDateTime(onceDate(), onceTime()) === undefined;

  /** Whether the schedule controls still hold exactly what they were seeded to. */
  const scheduleUntouched = () => {
    if (storedCronIsCustom && customScheduleReplaced()) return false;
    if (repeat() !== initialRepeat) return false;
    if (repeat() === 'once') {
      const date = onceDateTime();
      return (
        typedWhenIsValid() &&
        date !== undefined &&
        Math.trunc(date.getTime() / 60_000) ===
          Math.trunc(initialOnceInstant.getTime() / 60_000)
      );
    }
    return (
      samePartsShape(repeatParts(), initialParts) &&
      timezone() === initialTimezone
    );
  };

  /**
   * Whether saving would actually change anything — kept in step with what
   * `reminderEditPatch` treats as a change, so the "Unsaved changes" hint and
   * the Save button never light up for an edit that no-ops. A blank title keeps
   * the current description and surrounding whitespace clamps away, so only a
   * different non-blank title counts.
   */
  const isDirty = () => {
    const trimmed = description().trim();
    const titleChanged = trimmed !== '' && trimmed !== seed.description.trim();
    return titleChanged || !scheduleUntouched();
  };

  const seedRepeatParts = (kind: ScheduleFrequency) => {
    const from = onceDateTime();
    if (from) {
      const inZone = TZDateMini.tz(timezone(), from.getTime());
      return repeatPartsFromDate(inZone, kind);
    }
    return { ...repeatParts(), frequency: kind };
  };

  const selectRepeat = (
    option: 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
  ) => {
    if (option === 'once') {
      setCustomScheduleReplaced(true);
      setRepeat('once');
      return;
    }

    const frequency: ScheduleFrequency =
      option === 'monthly' ? 'month' : 'week';
    const seeded = seedRepeatParts(frequency);
    const canPreserveEditedTime =
      repeat() !== 'once' && (!storedCronIsCustom || customScheduleReplaced());
    const parts: CronParts = {
      ...repeatParts(),
      frequency,
      time: canPreserveEditedTime ? repeatParts().time : seeded.time,
    };
    if (option === 'weekly') {
      const days = savedWeeklyDays() ?? seeded.daysOfWeek;
      parts.daysOfWeek = [...days];
      setSavedWeeklyDays([...days]);
    }
    if (option === 'monthly') {
      const day = savedMonthlyDay() ?? seeded.dayOfMonth;
      parts.dayOfMonth = day;
      setSavedMonthlyDay(day);
    }
    setRepeat(frequency);
    setRepeatParts({
      ...parts,
      ...(option === 'daily' ? { daysOfWeek: [...ALL_WEEKDAYS] } : {}),
      ...(option === 'weekdays' ? { daysOfWeek: [...DEFAULT_WEEKDAYS] } : {}),
    });
    setCustomScheduleReplaced(true);
  };

  const updateParts = (patch: Partial<CronParts>) => {
    setCustomScheduleReplaced(true);
    if (patch.dayOfMonth !== undefined && repeat() === 'month') {
      setSavedMonthlyDay(patch.dayOfMonth);
    }
    setRepeatParts((parts) => ({ ...parts, ...patch }));
  };

  const toggleDay = (value: string) => {
    const days = repeatParts().daysOfWeek;
    // Never empty: an empty selection builds an every-day cron, which is not
    // what unticking your last day is asking for.
    const next = days.includes(value)
      ? days.filter((day) => day !== value)
      : [...days, value];
    if (next.length > 0) {
      setSavedWeeklyDays([...next]);
      updateParts({ daysOfWeek: next });
    }
  };

  const selectOnceDate = (date: Date) => {
    setWhenQuery('');
    setSelectedOnceInstant(new Date(date));
    setOnceDate(toDateInput(date));
    setOnceTime(toTimeInput(date));
  };

  const toggleCustomTime = () => {
    const opening = !showCustomTime();
    if (opening && whenQuery().trim()) {
      const option = dateOptions()[0];
      const intendedTime = typedTime();
      if (typedWallTimeIsInvalid() && option && intendedTime) {
        // Carry the requested wall time into Custom so its existing DST-gap
        // validation can explain the problem instead of silently discarding it.
        setSelectedOnceInstant(undefined);
        setOnceDate(toDateInput(option.date));
        setOnceTime(`${pad(intendedTime.hours)}:${pad(intendedTime.minutes)}`);
        setWhenQuery('');
      } else {
        const typed = typedOnceDateTime();
        if (typed) selectOnceDate(typed);
        else setWhenQuery('');
      }
    }
    setShowCustomTime(opening);
  };

  const repeatChoice = () => {
    if (storedCronIsCustom && !customScheduleReplaced()) return 'custom';
    if (repeat() === 'once') return 'once';
    if (repeat() === 'month') return 'monthly';
    if (sameDays(repeatParts().daysOfWeek, ALL_WEEKDAYS)) return 'daily';
    if (sameDays(repeatParts().daysOfWeek, DEFAULT_WEEKDAYS)) return 'weekdays';
    return 'weekly';
  };

  const schedulePreview = createMemo(() => {
    if (repeat() === 'once') {
      if (!typedWhenIsValid()) return;
      const date = onceDateTime();
      return date
        ? formatReminderInstant(date, localZone, openedAt)
        : undefined;
    }
    if (storedCronIsCustom && !customScheduleReplaced()) {
      return `Custom repeating schedule · ${timezone().replace(/_/g, ' ')} (${shortZone(timezone())})`;
    }
    return `${capitalize(describeCron(repeatParts()))} · ${timezone().replace(/_/g, ' ')} (${shortZone(timezone())})`;
  });

  const submit = () => {
    // Editing without touching the schedule keeps the stored one verbatim, so
    // the caller's diff omits it — which is what lets an overdue reminder be
    // renamed, and keeps a description-only edit from clearing its done flag.
    // A create always rebuilds (and past-checks) its schedule.
    if (isEdit && scheduleUntouched()) {
      props.onSubmit({
        description: description(),
        schedule: seed.originalSchedule,
      });
      return;
    }

    if (repeat() === 'once') {
      const date = onceDateTime();
      if (!date) return;
      // The controls can sit open long enough for a picked time to slip into the
      // past; re-check rather than let the API reject it with an opaque failure.
      if (date.getTime() <= Date.now()) {
        toast.failure('That time has already passed — pick another');
        return;
      }
      props.onSubmit({
        description: description(),
        schedule: onceSchedule(date),
      });
      return;
    }

    const parts = repeatParts();
    // No past-date check: a recurrence has no single instant to have passed, and
    // the backend derives its first firing from the cron itself. The zone comes
    // from the picker, seeded from the reminder's own zone (or the viewer's).
    if (!isValidCronParts(parts)) return;
    props.onSubmit({
      description: description(),
      schedule: recurringSchedule(parts, timezone()),
    });
  };

  /**
   * Whether Save may fire. A standalone reminder needs a description; every
   * schedule needs to be one the backend will accept. The past-date check lives
   * in `submit` (as a toast) rather than here, so the button reads as an
   * affordance rather than blinking disabled as the clock passes a chosen time.
   */
  const canSubmit = () => {
    if (props.descriptionRequired && !description().trim()) return false;
    if (props.pending) return false;
    return repeat() === 'once'
      ? typedWhenIsValid() && onceDateTime() !== undefined
      : isValidCronParts(repeatParts());
  };

  return (
    <div class="flex min-h-0 flex-col text-sm">
      <Dynamic
        component={props.layout === 'dialog' ? ActionDialogShell.Body : 'div'}
        class={
          props.layout === 'dialog'
            ? undefined
            : 'min-h-0 space-y-5 overflow-y-auto'
        }
      >
        {props.header}
        {/* Outside the <form> on purpose: the reference card carries its own
          buttons (Copy Link, etc.), and a button inside a form submits it —
          which here would save-and-close the panel on a stray click. */}
        <Show when={props.reference}>{(node) => node()}</Show>

        <form
          id={formId}
          class="flex flex-col gap-4"
          aria-busy={props.pending}
          inert={props.pending}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset
            class="flex min-w-0 flex-col gap-4"
            disabled={props.pending}
          >
            <div class="flex flex-col gap-2">
              <label
                for={descriptionId}
                class="text-xs font-medium text-ink-muted"
              >
                Reminder
              </label>
              <Input
                id={descriptionId}
                ref={titleRef}
                type="text"
                value={description()}
                onInput={(event) => setDescription(event.currentTarget.value)}
                placeholder={props.placeholder}
                aria-label="Reminder description"
                // Counts UTF-16 code units where the service counts characters, so this
                // only ever stops short of the real limit, never past it. The
                // description resolvers apply the exact cap.
                maxLength={REMINDER_DESCRIPTION_MAX_LENGTH}
                size="lg"
              />
            </div>

            <Show when={repeat() === 'once'}>
              <section
                class="flex flex-col gap-2"
                aria-labelledby={whenLabelId}
              >
                <label
                  id={whenLabelId}
                  for={whenInputId}
                  class="text-xs font-medium text-ink-muted"
                >
                  When
                </label>
                <Input
                  id={whenInputId}
                  type="text"
                  value={whenQuery()}
                  onInput={(event) => setWhenQuery(event.currentTarget.value)}
                  placeholder="Try “tomorrow 9am” or “in 30 minutes”"
                  autocomplete="off"
                  aria-controls={whenOptionsId}
                  aria-expanded={whenQuery().trim().length > 0}
                  aria-invalid={!typedWhenIsValid()}
                  size="lg"
                />
                <Show when={whenQuery().trim()}>
                  <div
                    id={whenOptionsId}
                    class="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-edge-muted bg-panel p-1"
                    aria-label="Matching reminder times"
                  >
                    <Show
                      when={
                        dateOptions().length > 0 && !typedWallTimeIsInvalid()
                      }
                      fallback={
                        <Show
                          when={typedWallTimeIsInvalid()}
                          fallback={
                            <span class="px-2 py-1.5 text-xs text-failure-ink">
                              No date found. Try “tomorrow 9am” or use Custom.
                            </span>
                          }
                        >
                          <span
                            class="px-2 py-1.5 text-xs text-failure-ink"
                            role="alert"
                          >
                            That local time doesn’t exist because the clocks
                            change. Choose a time before or after the gap.
                          </span>
                        </Show>
                      }
                    >
                      <For each={dateOptions()}>
                        {(option) => (
                          <Button
                            type="button"
                            variant="ghost"
                            class="min-h-10 justify-between gap-3 text-left"
                            onClick={() => selectOnceDate(option.date)}
                          >
                            <span class="min-w-0 truncate">
                              {option.displayText}
                            </span>
                            <span class="shrink-0 text-xs text-ink-muted">
                              {option.secondaryText}
                            </span>
                          </Button>
                        )}
                      </For>
                    </Show>
                  </div>
                </Show>

                <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <For each={quickPresets}>
                    {(preset) => (
                      <Button
                        type="button"
                        variant="outline"
                        class="min-h-11 min-w-0 flex-col items-start gap-0 px-2 py-1.5 text-left"
                        aria-label={`${preset.label}, ${formatReminderInstant(preset.date, localZone, openedAt)}`}
                        aria-pressed={
                          onceDateTime()?.getTime() === preset.date.getTime()
                        }
                        onClick={() => {
                          setShowCustomTime(false);
                          selectOnceDate(preset.date);
                        }}
                      >
                        <span class="truncate text-xs font-medium">
                          {preset.label}
                        </span>
                        <span class="truncate text-[11px] text-ink-muted">
                          {new Intl.DateTimeFormat(undefined, {
                            weekday: 'short',
                            hour: 'numeric',
                            minute: '2-digit',
                          }).format(preset.date)}
                        </span>
                      </Button>
                    )}
                  </For>
                  <Button
                    type="button"
                    variant="outline"
                    class="min-h-11 min-w-0 flex-col items-start gap-0 px-2 py-1.5 text-left"
                    aria-pressed={showCustomTime()}
                    onClick={toggleCustomTime}
                  >
                    <span class="text-xs font-medium">Custom</span>
                    <span class="text-[11px] text-ink-muted">Date & time</span>
                  </Button>
                </div>

                <Show when={showCustomTime()}>
                  <div class="flex flex-col gap-2 sm:flex-row">
                    <Input
                      type="date"
                      aria-label="Custom reminder date"
                      aria-invalid={customWallTimeIsInvalid()}
                      value={onceDate()}
                      onInput={(event) => {
                        setWhenQuery('');
                        setSelectedOnceInstant(undefined);
                        setOnceDate(event.currentTarget.value);
                      }}
                      class="min-w-0 flex-1 text-sm"
                    />
                    <Input
                      type="time"
                      aria-label="Custom reminder time"
                      aria-invalid={customWallTimeIsInvalid()}
                      value={onceTime()}
                      onInput={(event) => {
                        setWhenQuery('');
                        setSelectedOnceInstant(undefined);
                        setOnceTime(event.currentTarget.value);
                      }}
                      class="min-w-0 flex-1 text-sm"
                    />
                  </div>
                  <Show when={customWallTimeIsInvalid()}>
                    <p class="text-xs text-failure-ink" role="alert">
                      That local time doesn’t exist because the clocks change.
                      Choose a time before or after the gap.
                    </p>
                  </Show>
                </Show>
              </section>
            </Show>

            <Show when={schedulePreview()}>
              {(preview) => (
                <p
                  class="rounded-lg border border-edge-muted bg-hover px-3 py-2 text-xs text-ink-muted"
                  aria-live="polite"
                >
                  <span class="font-medium text-ink">Scheduled:</span>{' '}
                  {preview()}
                </p>
              )}
            </Show>

            <details class="group rounded-lg border border-edge-muted">
              <summary class="flex min-h-11 list-none items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent">
                <span class="min-w-0">
                  <span class="block text-xs font-medium text-ink-muted">
                    Repeat
                  </span>
                  <span class="block truncate text-ink">
                    {match(repeatChoice())
                      .with('once', () => 'Does not repeat')
                      .with('custom', () => 'Custom schedule')
                      .with('daily', () => 'Daily')
                      .with('weekdays', () => 'Weekdays')
                      .with('weekly', () => 'Weekly')
                      .with('monthly', () => 'Monthly')
                      .exhaustive()}
                  </span>
                </span>
                <CaretDownIcon class="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div class="flex flex-col gap-3 border-t border-edge-muted p-3">
                <Show when={storedCronIsCustom && !customScheduleReplaced()}>
                  <p class="rounded-lg bg-alert/10 px-3 py-2 text-xs text-alert-ink">
                    This reminder uses a custom repeat schedule. It will stay
                    unchanged unless you choose a replacement below.
                  </p>
                </Show>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <For
                    each={
                      [
                        ['once', 'Does not repeat'],
                        ['daily', 'Daily'],
                        ['weekdays', 'Weekdays'],
                        ['weekly', 'Weekly'],
                        ['monthly', 'Monthly'],
                      ] as const
                    }
                  >
                    {([value, label]) => (
                      <Button
                        type="button"
                        size="sm"
                        class="min-h-10 whitespace-normal px-2"
                        variant={
                          repeatChoice() === value ? 'accent' : 'outline'
                        }
                        aria-pressed={repeatChoice() === value}
                        onClick={() => selectRepeat(value)}
                      >
                        {label}
                      </Button>
                    )}
                  </For>
                </div>

                <Show
                  when={
                    repeat() !== 'once' &&
                    (!storedCronIsCustom || customScheduleReplaced())
                  }
                >
                  <Switch>
                    <Match when={repeat() === 'week'}>
                      <div class="flex flex-col gap-3">
                        <div class="flex gap-1" aria-label="Repeat on">
                          <For each={WEEKDAY_OPTIONS}>
                            {(day) => (
                              <Button
                                type="button"
                                size="sm"
                                class="min-h-10 min-w-0 flex-1 px-1"
                                variant={
                                  repeatParts().daysOfWeek.includes(day.value)
                                    ? 'accent'
                                    : 'outline'
                                }
                                aria-label={day.fullLabel}
                                aria-pressed={repeatParts().daysOfWeek.includes(
                                  day.value
                                )}
                                onClick={() => toggleDay(day.value)}
                              >
                                {day.label}
                              </Button>
                            )}
                          </For>
                        </div>
                        <TimeField
                          value={repeatParts().time}
                          onChange={(time) => updateParts({ time })}
                        />
                      </div>
                    </Match>
                    <Match when={repeat() === 'month'}>
                      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <label class="flex items-center gap-2 text-sm text-ink-muted">
                          Day
                          <Input
                            type="number"
                            min="1"
                            max="31"
                            value={repeatParts().dayOfMonth}
                            onInput={(event) =>
                              updateParts({
                                dayOfMonth: event.currentTarget.value,
                              })
                            }
                            class="w-20 text-sm"
                          />
                        </label>
                        <TimeField
                          value={repeatParts().time}
                          onChange={(time) => updateParts({ time })}
                        />
                      </div>
                    </Match>
                  </Switch>

                  <label class="flex flex-col gap-1 text-xs text-ink-muted sm:flex-row sm:items-center sm:gap-2">
                    <span class="font-medium">Timezone</span>
                    <TimezoneSelect
                      value={timezone()}
                      onChange={(value) => {
                        setCustomScheduleReplaced(true);
                        setTimezone(value);
                      }}
                      options={TIMEZONE_OPTIONS}
                    />
                  </label>
                </Show>
              </div>
            </details>

            <Show when={props.error}>
              {(error) => (
                <div
                  class="rounded-lg border border-failure/40 bg-failure-bg px-3 py-2 text-xs text-failure-ink"
                  role="alert"
                >
                  {error()}
                </div>
              )}
            </Show>
          </fieldset>
        </form>
      </Dynamic>
      <Dynamic
        component={props.layout === 'dialog' ? ActionDialogShell.Footer : 'div'}
        class={
          props.layout === 'dialog'
            ? undefined
            : 'mt-4 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge-muted pt-3'
        }
      >
        <Show when={isEdit && isDirty()}>
          <span class="flex items-center gap-1.5 text-xs text-ink-muted">
            <span class="size-1.5 rounded-full bg-warning" />
            Unsaved changes
          </span>
        </Show>
        <Button
          type="button"
          variant="ghost"
          class="ml-auto"
          disabled={props.pending}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="strong"
          disabled={!canSubmit() || (isEdit && !isDirty())}
        >
          <Show when={props.pending} fallback={props.submitLabel}>
            <SpinnerIcon class="size-4 animate-spin" />
            <span class="sr-only">Saving reminder</span>
          </Show>
        </Button>
      </Dynamic>
    </div>
  );
}

/** A time-of-day field for the recurring schedule. `At HH:MM`. */
function TimeField(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label class="flex items-center gap-2 text-sm text-ink-muted">
      At
      <Input
        type="time"
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
        class="min-w-0 flex-1 text-sm"
      />
    </label>
  );
}
