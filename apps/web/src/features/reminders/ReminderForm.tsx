import { toast } from '@core/component/Toast/Toast';
import {
  type CronParts,
  describeCron,
  getDefaultTimezone,
  isValidCronParts,
  type ScheduleFrequency,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';
import { TZDateMini } from '@date-fns/tz';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { Button, cn } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  isRecurring,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  recurringSchedule,
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
  autofocus?: boolean;
  /**
   * Cancel reverts the fields to what they were seeded with rather than only
   * bubbling `onCancel` — for an editor that stays open (the split view), so a
   * cancelled edit undoes itself instead of tearing the panel down.
   */
  revertOnCancel?: boolean;
  /** Notified when the fields drift from (or return to) their seeded values. */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Cancel. `wasDirty` is whether there were unsaved edits when it was clicked:
   * with `revertOnCancel`, those edits have already been reverted, so the host
   * can keep the panel open on a revert and only dismiss on a clean cancel.
   */
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
  const [description, setDescription] = createSignal(seed.description);
  const [repeat, setRepeat] = createSignal<RepeatKind>(seed.repeat);
  const [onceDate, setOnceDate] = createSignal(seed.onceDate);
  const [onceTime, setOnceTime] = createSignal(seed.onceTime);
  const [repeatParts, setRepeatParts] = createSignal<CronParts>(seed.parts);
  // A recurring cron fires at a wall-clock time in this zone. It defaults to the
  // reminder's stored zone (or the viewer's, for a new recurrence) and is
  // editable, so a reminder can fire in a zone other than the one editing it.
  const [timezone, setTimezone] = createSignal(
    seed.recurringTimezone ?? localZone
  );

  // What the schedule controls were seeded to, so an untouched edit can be told
  // from a real change without depending on second-level precision the pickers
  // do not carry.
  const initialRepeat = seed.repeat;
  const initialOnceDate = seed.onceDate;
  const initialOnceTime = seed.onceTime;
  const initialParts = seed.parts;
  const initialTimezone = seed.recurringTimezone ?? localZone;

  let titleRef: HTMLInputElement | undefined;
  onMount(() => {
    if (props.autofocus) titleRef?.focus();
  });

  const onceDateTime = () => new Date(`${onceDate()}T${onceTime()}`);

  /** Whether the schedule controls still hold exactly what they were seeded to. */
  const scheduleUntouched = () => {
    if (repeat() !== initialRepeat) return false;
    return repeat() === 'once'
      ? onceDate() === initialOnceDate && onceTime() === initialOnceTime
      : samePartsShape(repeatParts(), initialParts) &&
          timezone() === initialTimezone;
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

  // Let the host reflect the unsaved state (e.g. a dot on the split's title).
  createEffect(() => props.onDirtyChange?.(isDirty()));

  const reset = () => {
    setDescription(seed.description);
    setRepeat(seed.repeat);
    setOnceDate(seed.onceDate);
    setOnceTime(seed.onceTime);
    setRepeatParts(seed.parts);
    setTimezone(initialTimezone);
  };

  const cancel = () => {
    const wasDirty = isDirty();
    // Revert the edits in place; the host decides whether to also dismiss.
    if (props.revertOnCancel && wasDirty) reset();
    props.onCancel(wasDirty);
  };

  const setRepeatKind = (kind: RepeatKind) => {
    const wasOnce = repeat() === 'once';
    setRepeat(kind);
    if (kind === 'once') return;
    // Coming from a one-shot, seed the recurrence from the date and time the
    // one-shot fields currently hold rather than the mount-time parts, so
    // switching to Weekly or Monthly lands on that weekday and time. Those
    // fields are the viewer's local wall-clock but the cron is read in
    // `timezone()`, so take the weekday and time of that instant AS SEEN in
    // that zone — otherwise the local time would be reinterpreted in a
    // different zone and the reminder would fire at another moment. Between two
    // recurring kinds, keep the parts the user set and only flip frequency.
    if (wasOnce) {
      const from = onceDateTime();
      if (!Number.isNaN(from.getTime())) {
        const inZone = TZDateMini.tz(timezone(), from.getTime());
        setRepeatParts(repeatPartsFromDate(inZone, kind));
        return;
      }
    }
    setRepeatParts((parts) => ({ ...parts, frequency: kind }));
  };

  const updateParts = (patch: Partial<CronParts>) =>
    setRepeatParts((parts) => ({ ...parts, ...patch }));

  const toggleDay = (value: string) => {
    const days = repeatParts().daysOfWeek;
    // Never empty: an empty selection builds an every-day cron, which is not
    // what unticking your last day is asking for.
    const next = days.includes(value)
      ? days.filter((day) => day !== value)
      : [...days, value];
    if (next.length > 0) updateParts({ daysOfWeek: next });
  };

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
      if (Number.isNaN(date.getTime())) return;
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
      ? !Number.isNaN(onceDateTime().getTime())
      : isValidCronParts(repeatParts());
  };

  return (
    <div class="flex flex-col gap-4 text-sm">
      {/* Outside the <form> on purpose: the reference card carries its own
          buttons (Copy Link, etc.), and a button inside a form submits it —
          which here would save-and-close the panel on a stray click. */}
      <Show when={props.reference}>{(node) => node()}</Show>

      <form
        class="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
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
          class="w-full rounded-md border border-edge-muted bg-surface px-2 py-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
        />

        <div class="flex flex-col gap-2">
          <span class="text-xs font-medium text-ink-muted">Repeat</span>
          <div class="flex gap-1">
            <For
              each={
                [
                  { value: 'once', label: 'Does not repeat' },
                  { value: 'week', label: 'Weekly' },
                  { value: 'month', label: 'Monthly' },
                ] as const
              }
            >
              {(option) => (
                <button
                  type="button"
                  class={cn(
                    'flex-1 rounded border px-2 py-1.5 text-xs',
                    repeat() === option.value
                      ? 'border-edge bg-active text-ink'
                      : 'border-edge-muted text-ink-muted hover:text-ink'
                  )}
                  onClick={() => setRepeatKind(option.value)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </div>

        <Switch>
          <Match when={repeat() === 'once'}>
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2">
                <input
                  type="date"
                  aria-label="Date"
                  value={onceDate()}
                  onInput={(event) => setOnceDate(event.currentTarget.value)}
                  class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
                <input
                  type="time"
                  aria-label="Time"
                  value={onceTime()}
                  onInput={(event) => setOnceTime(event.currentTarget.value)}
                  class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
              <span class="text-xs text-ink-muted">
                {localZone.replace(/_/g, ' ')} ({shortZone(localZone)})
              </span>
            </div>
          </Match>
          <Match when={repeat() === 'week'}>
            <div class="flex flex-col gap-3">
              <div class="flex gap-1">
                <For each={WEEKDAY_OPTIONS}>
                  {(day) => (
                    <button
                      type="button"
                      class={cn(
                        'flex-1 rounded border px-1 py-1.5 text-xs',
                        repeatParts().daysOfWeek.includes(day.value)
                          ? 'border-edge bg-active text-ink'
                          : 'border-edge-muted text-ink-muted hover:text-ink'
                      )}
                      aria-pressed={repeatParts().daysOfWeek.includes(
                        day.value
                      )}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.label}
                    </button>
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
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-2 text-sm text-ink-muted">
                Day
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={repeatParts().dayOfMonth}
                  onInput={(event) =>
                    updateParts({ dayOfMonth: event.currentTarget.value })
                  }
                  class="w-16 rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                />
              </label>
              <TimeField
                value={repeatParts().time}
                onChange={(time) => updateParts({ time })}
              />
            </div>
          </Match>
        </Switch>

        <Show when={repeat() !== 'once'}>
          <div class="flex flex-col gap-2">
            <label class="flex items-center gap-2 text-xs text-ink-muted">
              <span class="font-medium">Timezone</span>
              <TimezoneSelect
                value={timezone()}
                onChange={setTimezone}
                options={TIMEZONE_OPTIONS}
              />
            </label>
            <span class="truncate text-xs text-ink-muted">
              {describeCron(repeatParts())} · {shortZone(timezone())}
            </span>
          </div>
        </Show>

        <div class="flex items-center gap-3 pt-2">
          <Show when={isEdit && isDirty()}>
            <span class="flex items-center gap-1.5 text-xs text-ink-muted">
              <span class="size-1.5 rounded-full bg-warning" />
              Unsaved changes
            </span>
          </Show>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            class="ml-auto rounded-lg"
            onClick={cancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="accent"
            size="sm"
            depth={3}
            class="rounded-lg border-0"
            disabled={!canSubmit() || (isEdit && !isDirty())}
          >
            {props.submitLabel}
          </Button>
        </div>
      </form>
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
      <input
        type="time"
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
        class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
      />
    </label>
  );
}
