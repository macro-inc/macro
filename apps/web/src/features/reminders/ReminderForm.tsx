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
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import RepeatIcon from '@phosphor/repeat.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { ActionDialogShell, Button, Dropdown, Input } from '@ui';
import {
  createEffect,
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
  EventDateField,
  EventTimeInput,
} from '../calendar/components/composer/EventDateTimeInputs';
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
  /** Revert unsaved editor fields before notifying the host of cancellation. */
  revertOnCancel?: boolean;
  /** Notified when the form drifts from (or returns to) its seeded values. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Cancel with whether the form contained unsaved changes. */
  onCancel: (wasDirty: boolean) => void;
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

const REPEAT_PRESETS = [
  { value: 'once', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;

type RepeatPreset = (typeof REPEAT_PRESETS)[number]['value'];
type RepeatChoice = RepeatPreset | 'custom';

function repeatPresetFromShape(
  repeat: RepeatKind,
  parts: CronParts
): RepeatPreset {
  if (repeat === 'once') return 'once';
  if (repeat === 'month') return 'monthly';
  if (sameDays(parts.daysOfWeek, ALL_WEEKDAYS)) return 'daily';
  if (sameDays(parts.daysOfWeek, DEFAULT_WEEKDAYS)) return 'weekdays';
  return 'weekly';
}

function sameDays(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((day) => b.includes(day));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Compact but exact enough to compare the quick choices before selecting one. */
function formatQuickPreset(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Human-readable zone without awkward output such as `UTC (UTC)`. */
function formatTimezoneSummary(zone: string): string {
  const readable = zone.replace(/_/g, ' ');
  const abbreviation = shortZone(zone);
  if (
    abbreviation === readable ||
    (abbreviation === 'UTC' && (zone === 'UTC' || zone === 'Etc/UTC'))
  ) {
    return abbreviation;
  }
  return `${readable} (${abbreviation})`;
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
  const initialSelectedOnceInstant = isEdit
    ? seed.originalSchedule.type === 'once'
      ? new Date(seed.originalSchedule.remindAt)
      : props.initialRemindAt
        ? new Date(props.initialRemindAt)
        : undefined
    : undefined;
  const [selectedOnceInstant, setSelectedOnceInstant] = createSignal<
    Date | undefined
  >(initialSelectedOnceInstant);
  const [repeatParts, setRepeatParts] = createSignal<CronParts>(seed.parts);
  // A recurring cron fires at a wall-clock time in this zone. It defaults to the
  // reminder's stored zone (or the viewer's, for a new recurrence) and is
  // editable, so a reminder can fire in a zone other than the one editing it.
  const [timezone, setTimezone] = createSignal(
    seed.recurringTimezone ?? localZone
  );
  const [whenQuery, setWhenQuery] = createSignal('');
  const [showCustomTime, setShowCustomTime] = createSignal(false);
  // Keep an explicit cadence choice separate from its cron shape. Weekly can
  // intentionally contain Mon–Fri or all seven days while the user is still
  // editing toward another set (for example Mon–Sat); shape inference alone
  // would relabel it Weekdays/Daily and hide the weekday controls mid-edit.
  const [selectedRepeatPreset, setSelectedRepeatPreset] =
    createSignal<RepeatPreset>(repeatPresetFromShape(seed.repeat, seed.parts));
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
  const initialSavedWeeklyDays =
    !storedCronIsCustom &&
    seed.repeat === 'week' &&
    !sameDays(seed.parts.daysOfWeek, ALL_WEEKDAYS) &&
    !sameDays(seed.parts.daysOfWeek, DEFAULT_WEEKDAYS)
      ? [...seed.parts.daysOfWeek]
      : undefined;
  const [savedWeeklyDays, setSavedWeeklyDays] = createSignal<
    string[] | undefined
  >(initialSavedWeeklyDays);
  const initialSavedMonthlyDay =
    !storedCronIsCustom && seed.repeat === 'month'
      ? seed.parts.dayOfMonth
      : undefined;
  const [savedMonthlyDay, setSavedMonthlyDay] = createSignal<
    string | undefined
  >(initialSavedMonthlyDay);
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
  let errorRef: HTMLDivElement | undefined;
  let customControlsRef: HTMLDivElement | undefined;
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
  const customTimeIsMissing = () =>
    showCustomTime() && !whenQuery().trim() && onceTime() === '';

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

  createEffect(() => props.onDirtyChange?.(isDirty()));
  createEffect(() => {
    if (!props.error) return;
    queueMicrotask(() =>
      errorRef?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    );
  });

  const reset = () => {
    setDescription(seed.description);
    setRepeat(seed.repeat);
    setOnceDate(seed.onceDate);
    setOnceTime(seed.onceTime);
    setSelectedOnceInstant(
      initialSelectedOnceInstant
        ? new Date(initialSelectedOnceInstant.getTime())
        : undefined
    );
    setRepeatParts(seed.parts);
    setTimezone(initialTimezone);
    setWhenQuery('');
    setShowCustomTime(false);
    setSelectedRepeatPreset(repeatPresetFromShape(seed.repeat, seed.parts));
    setCustomScheduleReplaced(false);
    setSavedWeeklyDays(
      initialSavedWeeklyDays ? [...initialSavedWeeklyDays] : undefined
    );
    setSavedMonthlyDay(initialSavedMonthlyDay);
  };

  const cancel = () => {
    const wasDirty = isDirty();
    if (props.revertOnCancel && wasDirty) reset();
    props.onCancel(wasDirty);
  };

  const seedRepeatParts = (kind: ScheduleFrequency) => {
    const from = onceDateTime();
    if (from) {
      const inZone = TZDateMini.tz(timezone(), from.getTime());
      return repeatPartsFromDate(inZone, kind);
    }
    return { ...repeatParts(), frequency: kind };
  };

  const selectRepeat = (option: RepeatPreset) => {
    setSelectedRepeatPreset(option);
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

  const selectRepeatValue = (value: string) => {
    const option = REPEAT_PRESETS.find((preset) => preset.value === value);
    if (option) selectRepeat(option.value);
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
    if (opening) {
      queueMicrotask(() =>
        customControlsRef?.scrollIntoView?.({
          block: 'nearest',
          inline: 'nearest',
          behavior: 'smooth',
        })
      );
    }
  };

  const repeatChoice = (): RepeatChoice => {
    if (storedCronIsCustom && !customScheduleReplaced()) return 'custom';
    return selectedRepeatPreset();
  };

  const repeatLabel = () =>
    match(repeatChoice())
      .with('once', () => 'Does not repeat')
      .with('custom', () => 'Custom schedule')
      .with('daily', () => 'Daily')
      .with('weekdays', () => 'Weekdays')
      .with('weekly', () => 'Weekly')
      .with('monthly', () => 'Monthly')
      .exhaustive();

  const schedulePreview = createMemo(() => {
    if (repeat() === 'once') {
      if (!typedWhenIsValid()) return;
      const date = onceDateTime();
      return date
        ? formatReminderInstant(date, localZone, openedAt)
        : undefined;
    }
    if (storedCronIsCustom && !customScheduleReplaced()) {
      return `Custom repeating schedule · ${formatTimezoneSummary(timezone())}`;
    }
    return `${capitalize(describeCron(repeatParts()))} · ${formatTimezoneSummary(timezone())}`;
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
          class="flex flex-col gap-3"
          aria-busy={props.pending}
          inert={props.pending}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <fieldset
            class="flex min-w-0 flex-col gap-3"
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

                <div
                  class="grid min-w-0 grid-cols-2 gap-2"
                  aria-label="Quick reminder times"
                >
                  <Show when={!showCustomTime()}>
                    <For each={quickPresets}>
                      {(preset) => (
                        <Button
                          type="button"
                          variant={
                            onceDateTime()?.getTime() === preset.date.getTime()
                              ? 'accent'
                              : 'outline'
                          }
                          fullWidth
                          class="h-auto min-h-12 min-w-0 flex-col items-start gap-0.5 rounded-[10px] px-3 py-2 text-left whitespace-normal"
                          data-reminder-quick-preset={preset.id}
                          aria-label={`${preset.label}, ${formatReminderInstant(preset.date, localZone, openedAt)}`}
                          aria-pressed={
                            onceDateTime()?.getTime() === preset.date.getTime()
                          }
                          onClick={() => {
                            setShowCustomTime(false);
                            selectOnceDate(preset.date);
                          }}
                        >
                          <span class="max-w-full truncate text-xs font-medium text-ink">
                            {preset.label}
                          </span>
                          <span class="max-w-full truncate text-[11px] font-normal text-ink-muted">
                            {formatQuickPreset(preset.date, localZone)}
                          </span>
                        </Button>
                      )}
                    </For>
                  </Show>
                  <Button
                    type="button"
                    size="sm"
                    variant={showCustomTime() ? 'accent' : 'outline'}
                    fullWidth
                    class="col-span-2 min-w-0 justify-start rounded-[10px] px-3"
                    aria-pressed={showCustomTime()}
                    onClick={toggleCustomTime}
                  >
                    <CalendarBlankIcon class="size-4" />
                    Choose date &amp; time
                  </Button>
                </div>

                <Show when={showCustomTime()}>
                  <div
                    ref={customControlsRef}
                    class="rounded-[10px] border border-edge-muted bg-input/50 p-3"
                  >
                    <div class="grid min-w-0 gap-2 min-[360px]:grid-cols-2">
                      <div class="flex min-w-0 flex-col gap-1">
                        <span class="text-xxs font-medium text-ink-muted">
                          Date
                        </span>
                        <EventDateField
                          label="Custom reminder"
                          value={onceDate()}
                          invalid={customWallTimeIsInvalid()}
                          disabled={props.pending}
                          portalScope="local"
                          appearance="bare"
                          class="h-9 w-full rounded-md border border-edge-muted bg-control px-2 hover:bg-hover focus-visible:border-accent"
                          onChange={(value) => {
                            setWhenQuery('');
                            setSelectedOnceInstant(undefined);
                            setOnceDate(value);
                          }}
                        />
                      </div>
                      <div class="flex min-w-0 flex-col">
                        <EventTimeInput
                          id={`${formId}-custom-time`}
                          label="Time"
                          value={onceTime()}
                          disabled={props.pending}
                          invalid={
                            customTimeIsMissing() || customWallTimeIsInvalid()
                          }
                          step={1}
                          onClear={() => {
                            setWhenQuery('');
                            setSelectedOnceInstant(undefined);
                            setOnceTime('');
                          }}
                          onChange={(option) => {
                            setWhenQuery('');
                            setSelectedOnceInstant(undefined);
                            setOnceTime(option.value);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <Show
                    when={customTimeIsMissing()}
                    fallback={
                      <Show when={customWallTimeIsInvalid()}>
                        <p class="text-xs text-failure-ink" role="alert">
                          That local time doesn’t exist because the clocks
                          change. Choose a time before or after the gap.
                        </p>
                      </Show>
                    }
                  >
                    <p class="text-xs text-failure-ink" role="alert">
                      Choose a time for this reminder.
                    </p>
                  </Show>
                </Show>
              </section>
            </Show>

            <Show when={!whenQuery().trim() ? schedulePreview() : undefined}>
              {(preview) => (
                <p
                  class="flex min-w-0 items-start gap-2 rounded-lg border border-edge-muted bg-hover px-3 py-2 text-xs text-ink-muted"
                  aria-live="polite"
                >
                  <CalendarBlankIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                  <span class="min-w-0">
                    <span class="font-medium text-ink">Scheduled:</span>{' '}
                    {preview()}
                  </span>
                </p>
              )}
            </Show>

            <Dropdown placement="bottom-start">
              <Dropdown.Trigger
                fullWidth
                aria-label={`Repeat, ${repeatLabel()}`}
                class="min-h-10 min-w-0 justify-start gap-2 rounded-[10px] px-3"
              >
                <RepeatIcon class="size-4 shrink-0 text-ink-extra-muted" />
                <span class="shrink-0 font-medium text-ink">Repeat</span>
                <span class="min-w-0 flex-1 truncate text-left font-normal text-ink-muted">
                  {repeatLabel()}
                </span>
                <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
              </Dropdown.Trigger>
              <Dropdown.Content
                portalScope="local"
                class="w-56 max-w-[calc(100vw-1rem)]"
              >
                <Dropdown.Group>
                  <Dropdown.RadioGroup
                    value={repeatChoice()}
                    onChange={selectRepeatValue}
                  >
                    <Show
                      when={storedCronIsCustom && !customScheduleReplaced()}
                    >
                      <Dropdown.RadioItem
                        value="custom"
                        disabled
                        class="justify-between"
                      >
                        Custom schedule
                        <Dropdown.ItemIndicator>
                          <CheckIcon class="size-3.5 text-accent" />
                        </Dropdown.ItemIndicator>
                      </Dropdown.RadioItem>
                    </Show>
                    <For each={REPEAT_PRESETS}>
                      {(option) => (
                        <Dropdown.RadioItem
                          value={option.value}
                          closeOnSelect
                          class="justify-between"
                        >
                          {option.label}
                          <Dropdown.ItemIndicator>
                            <CheckIcon class="size-3.5 text-accent" />
                          </Dropdown.ItemIndicator>
                        </Dropdown.RadioItem>
                      )}
                    </For>
                  </Dropdown.RadioGroup>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>

            <Show when={storedCronIsCustom && !customScheduleReplaced()}>
              <p class="rounded-lg bg-alert/10 px-3 py-2 text-xs text-alert-ink">
                This reminder uses a custom repeat schedule. It will stay
                unchanged unless you choose a replacement.
              </p>
            </Show>

            <Show
              when={
                repeat() !== 'once' &&
                (!storedCronIsCustom || customScheduleReplaced())
              }
            >
              <div class="flex min-w-0 flex-col gap-3 rounded-[10px] border border-edge-muted bg-input/40 p-3">
                <Switch>
                  <Match when={repeat() === 'week'}>
                    <div class="flex flex-col gap-3">
                      <Show when={repeatChoice() === 'weekly'}>
                        <div class="flex flex-col gap-1.5">
                          <span class="text-xs font-medium text-ink-muted">
                            Repeat on
                          </span>
                          <div
                            class="flex min-w-0 flex-wrap items-center gap-1.5"
                            aria-label="Repeat on"
                          >
                            <For each={WEEKDAY_OPTIONS}>
                              {(day) => (
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  class="rounded-full text-xxs"
                                  variant={
                                    repeatParts().daysOfWeek.includes(day.value)
                                      ? 'accent'
                                      : 'ghost'
                                  }
                                  aria-label={day.fullLabel}
                                  aria-pressed={repeatParts().daysOfWeek.includes(
                                    day.value
                                  )}
                                  onClick={() => toggleDay(day.value)}
                                >
                                  {day.label[0]}
                                </Button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                      <TimeField
                        value={repeatParts().time}
                        disabled={props.pending}
                        onChange={(time) => updateParts({ time })}
                      />
                    </div>
                  </Match>
                  <Match when={repeat() === 'month'}>
                    <div class="grid min-w-0 gap-3 min-[360px]:grid-cols-2">
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
                        disabled={props.pending}
                        onChange={(time) => updateParts({ time })}
                      />
                    </div>
                  </Match>
                </Switch>

                <label class="flex min-w-0 flex-col gap-1.5 text-xs text-ink-muted">
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
              </div>
            </Show>

            <Show when={props.error}>
              {(error) => (
                <div
                  ref={errorRef}
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
          onClick={cancel}
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
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = createUniqueId();
  return (
    <div class="flex min-w-0 flex-col">
      <EventTimeInput
        id={`reminder-repeat-time-${id}`}
        label="At"
        value={props.value}
        disabled={props.disabled}
        invalid={props.value === ''}
        step={60}
        onClear={() => props.onChange('')}
        onChange={(option) => props.onChange(option.value)}
      />
      <Show when={props.value === ''}>
        <span class="mt-1 text-xs text-failure-ink" role="alert">
          Choose a time.
        </span>
      </Show>
    </div>
  );
}
