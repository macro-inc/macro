import {
  type DateOption,
  formatDateWithContext,
} from '@core/util/dateSearch/useDateSearch';
import type { EntityData } from '@entity';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { addDays, addHours, addWeeks, endOfWeek } from 'date-fns';

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

/**
 * Drop options that have already passed.
 *
 * The API rejects a `remindAt` in the past, and the date search happily returns
 * past dates for a typed query ("yesterday", or a month already gone by). The
 * no-query preset list filters itself; this covers everything else.
 */
export function futureDateOptions(
  options: readonly DateOption[],
  now: Date
): DateOption[] {
  return options.filter((option) => option.date.getTime() > now.getTime());
}

/** A one-shot schedule firing at `date`. */
export function onceSchedule(date: Date): ReminderSchedule {
  return { type: 'once', remindAt: date.toISOString() };
}

/** The same instant, at `REMINDER_DEFAULT_TIME`. */
function atDefaultTime(date: Date): Date {
  const result = new Date(date);
  result.setHours(
    REMINDER_DEFAULT_TIME.hours,
    REMINDER_DEFAULT_TIME.minutes,
    0,
    0
  );
  return result;
}

/** The same instant, with seconds dropped. */
function toWholeMinute(date: Date): Date {
  const result = new Date(date);
  result.setSeconds(0, 0);
  return result;
}

/**
 * What the reminder picker offers before anything is typed.
 *
 * Deliberately not the shared `searchPresets` list, which is built for due dates
 * — it leads with "Today"/"Yesterday" and every entry lands on `endOfDay`.
 * Typing still goes through `useDateSearch`, so the shared presets remain
 * reachable by name; this only replaces the resting list.
 *
 * The hour offsets keep their computed clock time (an "in 1 hour" reminder at
 * 9am would be useless); the day-scale ones get the morning default.
 */
export function reminderDefaultOptions(now: Date): DateOption[] {
  const entries: Array<{ id: string; label: string; date: Date }> = [
    {
      id: 'in-1-hour',
      label: 'In 1 hour',
      date: toWholeMinute(addHours(now, 1)),
    },
    {
      id: 'in-2-hours',
      label: 'In 2 hours',
      date: toWholeMinute(addHours(now, 2)),
    },
    { id: 'tomorrow', label: 'Tomorrow', date: atDefaultTime(addDays(now, 1)) },
    {
      id: 'end-of-week',
      label: 'End of week',
      date: atDefaultTime(endOfWeek(now, { weekStartsOn: 1 })),
    },
    {
      id: 'in-1-week',
      label: 'In 1 week',
      date: atDefaultTime(addWeeks(now, 1)),
    },
  ];

  // On a Saturday `endOfWeek` (Sunday) is the same instant as "Tomorrow" at the
  // morning default, which would offer the same time under two labels.
  const seen = new Set<number>();
  const unique = entries.filter(({ date }) => {
    const time = date.getTime();
    if (seen.has(time)) return false;
    seen.add(time);
    return true;
  });

  return futureDateOptions(
    unique.map(({ id, label, date }) => ({
      id,
      displayText: label,
      secondaryText: formatDateWithContext(date, now, true),
      date,
      type: 'preset' as const,
    })),
    now
  );
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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Confirmation text for a reminder that was just set.
 *
 * The date is dropped for anything inside the next day: "set for 1:08 PM" is
 * what someone who just asked for three hours from now wants to read back, and
 * "Aug 7, 1:08 PM" only adds a date they already know. Past the day boundary
 * the date carries the meaning, so it stays.
 */
export function formatReminderWhen(
  date: Date,
  now: number = Date.now()
): string {
  const withinADay = date.getTime() - now < ONE_DAY_MS;
  return date.toLocaleString(undefined, {
    ...(withinADay ? {} : { month: 'short', day: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}
