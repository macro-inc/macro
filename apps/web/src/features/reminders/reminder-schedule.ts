import { formatDateAndTime } from '@app/features/entity/utils/timestamp';
import {
  buildCron,
  type CronParts,
  describeCron,
  getDefaultTimezone,
  normalizeCron,
  parseCron,
  type ScheduleFrequency,
} from '@core/util/cron';
import type { EntityData } from '@entity';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import type { UpdateReminderRequest } from '@service-storage/generated/schemas/updateReminderRequest';

/**
 * The time of day a bare date resolves to.
 *
 * The date presets shared with the due-date editor land on `endOfDay`, which
 * would put every reminder at 11:59 PM. A reminder is meant to be acted on, so
 * bare dates get a morning instead; typing a time ("tomorrow 3pm") overrides it.
 */
export const REMINDER_DEFAULT_TIME = { hours: 9, minutes: 0 } as const;

/** Longest description the API accepts, mirroring the service's own limit. */
export const REMINDER_DESCRIPTION_MAX_LENGTH = 2000;

/** A one-shot schedule firing at `date`. */
export function onceSchedule(date: Date): ReminderSchedule {
  return { type: 'once', remindAt: date.toISOString() };
}

/**
 * A recurring schedule from picker parts, evaluated in the viewer's timezone.
 *
 * The zone travels with the cron because that is the only thing that makes
 * "every day at 9am" mean 9am: the backend evaluates the expression in it, so a
 * schedule built in Denver keeps firing at Denver's 9am after a move to Berlin.
 */
export function recurringSchedule(
  parts: CronParts,
  timezone: string = getDefaultTimezone()
): ReminderSchedule {
  return { type: 'recurring', cron: buildCron(parts), timezone };
}

/**
 * Cron day-of-week for a date, in the backend's 1=Sunday numbering.
 *
 * `Date.getDay()` is 0=Sunday, so every value is one higher here. Off-by-one
 * lands the reminder on the wrong day of the week, which is the kind of bug
 * that only shows up a week after it ships.
 */
function cronDayOfWeek(date: Date): string {
  return String(date.getDay() + 1);
}

/** `HH:MM` for a date, in local time — the form the cron helpers take. */
function timeOfDay(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * The recurrence to offer for a reminder the user has just dated.
 *
 * Seeded entirely from that date, so choosing "weekly" repeats on the weekday
 * they picked at the time they picked, and the repeat step needs no second time
 * input to state the obvious.
 */
export function repeatPartsFromDate(
  date: Date,
  frequency: ScheduleFrequency = 'week'
): CronParts {
  return {
    frequency,
    time: timeOfDay(date),
    daysOfWeek: [cronDayOfWeek(date)],
    dayOfMonth: String(date.getDate()),
  };
}

/**
 * The schedule a soup row is on, rebuilt as the tagged union the API speaks.
 *
 * A row carries the schedule flattened into `scheduleType` plus the fields that
 * variant uses, and more than one surface needs it back in one piece — the
 * editor to diff against, the row to describe. Shared so they cannot disagree:
 * two call sites each picking their own fallback for an absent zone would
 * describe the same reminder differently, and the editor's diff would read the
 * substituted zone as a change and re-send it, moving when the reminder fires.
 *
 * `UTC` is the fallback rather than the viewer's zone, so the answer does not
 * depend on who is looking. It should be unreachable: the database requires a
 * timezone wherever a cron is set.
 */
export function scheduleFromRow(row: {
  scheduleType: 'once' | 'recurring';
  cron?: string;
  timezone?: string;
  nextRunAt: string | Date;
}): ReminderSchedule {
  if (row.scheduleType === 'recurring' && row.cron) {
    return {
      type: 'recurring',
      cron: row.cron,
      timezone: row.timezone ?? 'UTC',
    };
  }
  return { type: 'once', remindAt: new Date(row.nextRunAt).toISOString() };
}

/**
 * When a reminder next comes due, as one line for a row to show.
 *
 * A recurring reminder reads as its cadence ("Every weekday at 9:00 AM"), which
 * is what says it fires again at all; a one-shot reads as the single instant it
 * fires, date and time together. Both answer "when?" without repeating what the
 * recurrence badge beside them already says.
 */
export function describeReminderWhen(row: {
  scheduleType: 'once' | 'recurring';
  cron?: string;
  timezone?: string;
  nextRunAt: string | Date;
}): string {
  return (
    describeReminderSchedule(scheduleFromRow(row)) ??
    formatDateAndTime(row.nextRunAt)
  );
}

/** Whether a schedule repeats, narrowed for the caller. */
export function isRecurring(
  schedule: ReminderSchedule
): schedule is Extract<ReminderSchedule, { type: 'recurring' }> {
  return schedule.type === 'recurring';
}

/**
 * The picker parts behind an existing recurring schedule, for editing one.
 *
 * Lossy in the same way {@link parseCron} is: a cron the picker cannot express
 * comes back as the nearest thing it can, because there is no UI for the rest.
 */
export function repeatPartsFromSchedule(schedule: ReminderSchedule): CronParts {
  return isRecurring(schedule)
    ? parseCron(schedule.cron)
    : repeatPartsFromDate(new Date(schedule.remindAt));
}

/**
 * A schedule in words, for a row that has to say when it fires.
 *
 * Recurring schedules read as their recurrence ("Every weekday at 9:00 AM")
 * since a single date says nothing useful about them. One-shots return
 * undefined: their next firing is already rendered as a date, and repeating it
 * in words would just be the same thing twice.
 */
export function describeReminderSchedule(
  schedule: ReminderSchedule
): string | undefined {
  if (!isRecurring(schedule)) return undefined;
  // The zone is part of the schedule, not decoration: "every day at 9:00 AM"
  // means a different instant in Denver than in Berlin, and a reminder built in
  // one and read in the other has to say which it fires by.
  const described = describeCron(parseCron(schedule.cron), schedule.timezone);
  return described.charAt(0).toUpperCase() + described.slice(1);
}

/** Whether two schedules are the same, so an unchanged one is not re-sent. */
export function sameSchedule(
  a: ReminderSchedule,
  b: ReminderSchedule
): boolean {
  if (a.type !== b.type) return false;
  if (isRecurring(a) && isRecurring(b)) {
    // Normalized, not compared literally: two spellings of the same schedule
    // must not read as an edit. Sending a schedule the owner did not change
    // is not harmless — the backend treats any schedule write as a reschedule
    // and clears the done flag with it.
    return (
      normalizeCron(a.cron) === normalizeCron(b.cron) &&
      a.timezone === b.timezone
    );
  }
  if (!isRecurring(a) && !isRecurring(b)) {
    // Compared as instants, not strings: the same moment can be written with a
    // different offset or precision.
    return new Date(a.remindAt).getTime() === new Date(b.remindAt).getTime();
  }
  return false;
}

/**
 * The patch that turns `original` into `next`, or undefined when they match.
 *
 * Only changed fields are sent: the API rejects a patch with no fields, and an
 * unchanged schedule must be omitted rather than re-sent, since re-sending the
 * time of a reminder that has already fired would be rejected as being in the
 * past. Omitting it is also what lets an overdue reminder be renamed at all.
 */
export function reminderEditPatch(
  original: {
    description: string;
    schedule: ReminderSchedule;
    completed: boolean;
  },
  next: { description: string; schedule: ReminderSchedule }
): UpdateReminderRequest | undefined {
  const patch: UpdateReminderRequest = {};

  const description = clampDescription(next.description);
  if (description && description !== original.description) {
    patch.description = description;
  }
  if (!sameSchedule(original.schedule, next.schedule)) {
    patch.schedule = next.schedule;
    // Giving a reminder that was marked done a new schedule is a request for it
    // to fire again. For a one-shot that is load-bearing: the dispatcher skips
    // a completed one, so without clearing the flag the time just picked would
    // silently never arrive. For a recurring one it is presentational — the
    // series keeps running either way — but a reminder that fires tomorrow
    // should not sit under Done today. A description-only edit leaves it alone.
    if (original.completed) patch.completed = false;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** What an entity with no usable name is called, matching how lists render it. */
function untitledName(type: EntityData['type']): string {
  switch (type) {
    case 'email':
      return '(No Subject)';
    case 'crm_company':
      return 'Unknown Company';
    case 'crm_contact':
      return 'Unknown Contact';
    default:
      return 'Untitled';
  }
}

/**
 * `text` trimmed and cut to the service's limit.
 *
 * Counts characters, not code units, because the service's limit does — a
 * naive `slice` would cut an emoji in half rather than drop it.
 */
function clampDescription(text: string): string {
  const characters = [...text.trim()];
  return characters.length > REMINDER_DESCRIPTION_MAX_LENGTH
    ? characters.slice(0, REMINDER_DESCRIPTION_MAX_LENGTH).join('')
    : characters.join('');
}

/**
 * The description for a reminder about `entity`, derived from the entity alone.
 *
 * This is the fallback for a reminder the user did not describe, so it must
 * always produce something the API will accept: an unnamed entity falls back to
 * how lists label it, and an over-long name is truncated instead of rejected.
 */
export function reminderDescriptionFor(entity: EntityData): string {
  // A thread row's `name` is the literal placeholder "Channel thread", so the
  // message text is the only thing that says which thread. It matters more
  // here than elsewhere: the reminder attaches to the parent channel, so the
  // description is all that distinguishes two reminders on the same channel.
  const label =
    entity.type === 'channel_thread' ? entity.content?.trim() : undefined;
  const name = label || entity.name?.trim();
  return clampDescription(name || untitledName(entity.type));
}

/**
 * What to store as a reminder's description: what the user typed, or the
 * entity-derived name when they skipped the field.
 *
 * The composer's description step is optional but the API rejects an empty
 * description, so blank input has to resolve to something rather than through.
 */
export function resolveReminderDescription(
  input: string,
  entity: EntityData
): string {
  return clampDescription(input) || reminderDescriptionFor(entity);
}

/**
 * What to store as a standalone reminder's description, or undefined when
 * there is nothing usable to store.
 *
 * A reminder about nothing has no name to fall back on, so unlike every other
 * description path this one can come back empty — which is also the answer to
 * "may the composer move off the description step yet?". Both questions go
 * through here so the step's gate and its submit cannot disagree about a
 * description made only of spaces.
 */
export function resolveStandaloneDescription(
  input: string
): string | undefined {
  return clampDescription(input) || undefined;
}

/**
 * The same entity-derived description, from a resolved name rather than a whole
 * entity.
 *
 * An edited reminder only knows its reference as a type and an id — the name
 * lives in the preview cache — so it cannot go through
 * {@link reminderDescriptionFor}. The fallbacks are the same, so blanking the
 * field lands on the name creating it would have chosen.
 */
export function reminderDescriptionForReference(
  name: string | undefined,
  type: EntityData['type']
): string {
  return clampDescription(name?.trim() || untitledName(type));
}

/**
 * What to store when an edited reminder's description is left blank.
 *
 * Blanking the field means the same thing it means when creating: name this
 * after whatever it is about. `fallback` is that name, already derived — absent
 * for a standalone reminder, or one whose reference could not be resolved. With
 * nothing to derive from, the reminder keeps what it says: renaming it to
 * "Untitled" because a lookup missed would be worse than leaving it alone.
 */
export function resolveEditedDescription(
  input: string,
  current: string,
  fallback?: string
): string {
  return clampDescription(input) || fallback || current;
}
