/**
 * Cron expressions as the Rust backend reads them.
 *
 * Shared by every feature that lets someone build a repeating schedule —
 * automations and reminders both — so the two cannot drift on what `0 0 9 * * 2`
 * means. The backend parses these with the `cron` crate, which sets two
 * conventions worth stating up front:
 *
 * - Six fields, `sec min hour dayOfMonth month dayOfWeek`, not the conventional
 *   five. A seventh optional `year` field is accepted on read.
 * - Day-of-week is **1-based starting at Sunday**: 1=Sun through 7=Sat. This is
 *   not the JS `Date.getDay()` numbering, and mixing them up shifts every
 *   weekly schedule by a day.
 */

/**
 * How often a schedule repeats.
 *
 * No daily option: a weekly schedule with every day selected is the same
 * thing, and the pickers let you say it that way. One fewer frequency to
 * render, and no expression that only one picker can express.
 */
export type ScheduleFrequency = 'week' | 'month';

/** Time of day a schedule fires when none was chosen, as `HH:MM`. */
export const DEFAULT_TIME = '09:00';

// Day-of-week values match the `cron` crate convention:
//   1 = Sun, 2 = Mon, 3 = Tue, 4 = Wed, 5 = Thu, 6 = Fri, 7 = Sat
export const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Sun', fullLabel: 'Sunday' },
  { value: '2', label: 'Mon', fullLabel: 'Monday' },
  { value: '3', label: 'Tue', fullLabel: 'Tuesday' },
  { value: '4', label: 'Wed', fullLabel: 'Wednesday' },
  { value: '5', label: 'Thu', fullLabel: 'Thursday' },
  { value: '6', label: 'Fri', fullLabel: 'Friday' },
  { value: '7', label: 'Sat', fullLabel: 'Saturday' },
];

const DOW_VALUES = WEEKDAY_OPTIONS.map((option) => option.value);

/** Monday to Friday, the default weekly selection. */
export const DEFAULT_WEEKDAYS = ['2', '3', '4', '5', '6'];

/** The parts of a cron expression a picker actually edits. */
export type CronParts = {
  frequency: ScheduleFrequency;
  /** `HH:MM`, 24-hour. */
  time: string;
  /** Day-of-week values in the cron crate's 1-7 numbering. Weekly only. */
  daysOfWeek: string[];
  /** 1-31. Monthly only. */
  dayOfMonth: string;
};

/** The IANA zone the browser is in, which is what a local time is relative to. */
export function getDefaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * Whether `value` is a real `HH:MM` time, in range as well as in shape.
 *
 * The range check is the point: `buildCron` silently falls back to
 * {@link DEFAULT_TIME} for anything it cannot use, so a picker that accepted
 * `99:99` would report the schedule as valid, let it be saved, and store a
 * different time than the one on screen.
 */
export function isValidTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;

  const [, hour, minute] = match;
  const h = Number(hour);
  const m = Number(minute);
  // Both bounds, though the digits-only pattern already rules out negatives.
  // A range check that only looks one way invites the next reader to widen the
  // pattern and not notice the other half was never there.
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * Whether these parts describe a schedule that will be stored as shown.
 *
 * Every field {@link buildCron} would quietly substitute a fallback for, so a
 * picker can refuse to save rather than save something else. A weekly schedule
 * with no days selected builds an every-day cron, which is not what clearing
 * the last day is asking for.
 */
export function isValidCronParts(parts: CronParts): boolean {
  if (!isValidTime(parts.time)) return false;
  if (parts.frequency === 'week') {
    // Every value checked, not just the count: a stray day outside 1-7 would
    // build an expression the backend rejects, and "at least one selected" is
    // only the constraint the buttons happen to enforce today.
    return (
      parts.daysOfWeek.length > 0 &&
      parts.daysOfWeek.every((day) => DOW_VALUES.includes(day))
    );
  }
  const day = Number(parts.dayOfMonth);
  return Number.isInteger(day) && day >= 1 && day <= 31;
}

/** `HH:MM` from separate fields, falling back on anything out of range. */
function toTimeValue(hour: string, minute: string): string {
  const safeHour = Number(hour);
  const safeMinute = Number(minute);
  if (
    Number.isNaN(safeHour) ||
    Number.isNaN(safeMinute) ||
    safeHour < 0 ||
    safeHour > 23 ||
    safeMinute < 0 ||
    safeMinute > 59
  ) {
    return DEFAULT_TIME;
  }

  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

/** `09:00` as the viewer's locale writes it, e.g. `9:00 AM`. */
export function formatTimeLabel(value: string): string {
  if (!isValidTime(value)) return value;
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date(2026, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** A day-of-week selection in words, collapsing the sets that have a name. */
function formatDayList(daysOfWeek: string[]): string {
  if (daysOfWeek.length === 0) return 'no days';
  const sorted = [...daysOfWeek].sort(
    (a, b) => DOW_VALUES.indexOf(a) - DOW_VALUES.indexOf(b)
  );
  if (sorted.length === 7) return 'every day';
  if (
    sorted.length === 5 &&
    sorted.every((d) => DEFAULT_WEEKDAYS.includes(d))
  ) {
    return 'weekdays';
  }
  if (sorted.length === 2 && sorted.includes('1') && sorted.includes('7')) {
    return 'weekends';
  }
  return sorted
    .map((d) => WEEKDAY_OPTIONS.find((opt) => opt.value === d)?.fullLabel)
    .filter(Boolean)
    .join(', ');
}

function nthSuffix(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * A schedule in words, e.g. `weekdays at 9:00 AM`.
 *
 * Lower-case and un-punctuated so callers can drop it into their own sentence;
 * capitalize at the call site if it stands alone. `timezone` is appended in
 * parentheses when given, for surfaces where the zone is not obvious.
 */
export function describeCron(parts: CronParts, timezone?: string): string {
  const timeLabel = formatTimeLabel(parts.time);
  const zone = timezone ? ` (${timezone})` : '';

  if (parts.frequency === 'week') {
    return `${formatDayList(parts.daysOfWeek)} at ${timeLabel}${zone}`;
  }

  const day = Number(parts.dayOfMonth);
  if (Number.isInteger(day) && day >= 1 && day <= 31) {
    return `${day}${nthSuffix(day)} of each month at ${timeLabel}${zone}`;
  }
  return `each month at ${timeLabel}${zone}`;
}

/**
 * Expand a day-of-week field like `2,4,6` or `2-6` into single values.
 *
 * Returns `[]` when any part of the expression cannot be read, so the caller
 * falls back to defaults rather than silently dropping the days it understood.
 */
function expandDowExpression(expr: string): string[] {
  const parts = expr.split(',');
  const set = new Set<string>();
  for (const raw of parts) {
    const part = raw.trim();
    if (/^[1-7]$/.test(part)) {
      set.add(part);
      continue;
    }
    const range = part.match(/^([1-7])-([1-7])$/);
    if (range) {
      const [, lo, hi] = range;
      const loN = Number(lo);
      const hiN = Number(hi);
      if (loN <= hiN) {
        for (let n = loN; n <= hiN; n++) set.add(String(n));
        continue;
      }
    }
    return [];
  }
  return [...set].sort((a, b) => DOW_VALUES.indexOf(a) - DOW_VALUES.indexOf(b));
}

/** The parts a picker should start from, for anything unreadable. */
function fallbackParts(time: string = DEFAULT_TIME): CronParts {
  return {
    frequency: 'week',
    time,
    daysOfWeek: [...DEFAULT_WEEKDAYS],
    dayOfMonth: '1',
  };
}

/**
 * Read a cron expression back into the parts a picker edits.
 *
 * Lossy by design: this only recognizes the shapes {@link buildCron} produces,
 * and anything else falls back to a sane weekly default rather than throwing.
 * A schedule written by hand may therefore come back as something simpler than
 * what it says — the picker cannot represent it either way.
 *
 * `dayOfMonth: '*'` with `dayOfWeek: '*'` reads as `day`, the most specific
 * frequency that describes it. Callers that have no daily option should map it
 * to a weekly schedule with every day selected, which is the same expression.
 */
export function parseCron(cron: string): CronParts {
  return interpretCron(cron).parts;
}

/**
 * A parse, plus whether the expression was one the pickers can actually say.
 *
 * The distinction matters to anything comparing two expressions: every
 * unrepresentable cron parses to the *same* fallback, so treating those parses
 * as canonical would make two genuinely different schedules look identical.
 */
type CronReading = { parts: CronParts; representable: boolean };

function unrepresentable(time?: string): CronReading {
  return { parts: fallbackParts(time), representable: false };
}

/**
 * Whether a cron field is a single plain number in range.
 *
 * Ranges (`9-17`), lists (`0,30`) and steps (`*&#47;15`) are all valid to the
 * backend and none of them are something the picker can show, so they are
 * rejected here rather than read as whichever number happens to parse first.
 */
function isPlainCronNumber(field: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(field)) return false;
  const value = Number(field);
  return value >= min && value <= max;
}

function interpretCron(cron: string): CronReading {
  const fields = cron.trim().split(/\s+/);
  // Six fields (`sec min hour dom mon dow`), or seven with a trailing year.
  if (fields.length !== 6 && fields.length !== 7) return unrepresentable();

  const [second, minute, hour, dayOfMonth, month, dayOfWeek, year] = fields;
  const time = toTimeValue(hour, minute);

  // Every field the picker cannot express has to be reported, not just the
  // obvious ones. `toTimeValue` answers with the default for anything it cannot
  // read, so a range like `9-17` would otherwise pass as representable with the
  // hour silently reset to 09:00 — and `normalizeCron` would then rewrite a
  // real schedule into a different one, which is exactly what makes a genuine
  // edit compare equal and never get sent.
  if (!isPlainCronNumber(second, 0, 59)) return unrepresentable(time);
  if (!isPlainCronNumber(minute, 0, 59)) return unrepresentable(time);
  if (!isPlainCronNumber(hour, 0, 23)) return unrepresentable(time);

  // Seconds are the owner's — `30 0 9 * * *` means 09:00:30 — and the picker
  // only builds whole minutes, so anything else is not ours to rewrite.
  if (Number(second) !== 0) return unrepresentable(time);

  // A year constraint is a real part of the schedule and the picker has no way
  // to show it, so an expression carrying one is not ours to rewrite.
  if (year !== undefined && year !== '*') return unrepresentable(time);
  if (month !== '*') return unrepresentable(time);

  if (dayOfMonth === '*') {
    if (dayOfWeek === '*') {
      // Every day, said the way the picker says it.
      return {
        parts: {
          frequency: 'week',
          time,
          daysOfWeek: [...DOW_VALUES],
          dayOfMonth: '1',
        },
        representable: true,
      };
    }
    const days = expandDowExpression(dayOfWeek);
    if (days.length > 0) {
      return {
        parts: { frequency: 'week', time, daysOfWeek: days, dayOfMonth: '1' },
        representable: true,
      };
    }
    return unrepresentable(time);
  }

  // Monthly: a specific day-of-month with no day-of-week constraint.
  if (dayOfWeek === '*' && /^(?:[1-9]|[12]\d|3[01])$/.test(dayOfMonth)) {
    return {
      parts: {
        frequency: 'month',
        time,
        daysOfWeek: [...DEFAULT_WEEKDAYS],
        dayOfMonth,
      },
      representable: true,
    };
  }

  return unrepresentable(time);
}

/**
 * A cron expression in the one form the pickers write it.
 *
 * `0 0 9 * * *` and `0 0 9 * * 1,2,3,4,5,6,7` are the same schedule spelled two
 * ways, and which one you hold depends on what last wrote it. Callers comparing
 * two expressions for "did this change?" want them to agree, since a difference
 * that is only spelling still reads as an edit — and on a reminder an edit
 * resets state the owner cares about.
 *
 * Both spellings parse to the same parts, so rebuilding is the whole job.
 */
export function normalizeCron(cron: string): string {
  const { parts, representable } = interpretCron(cron);

  // Anything the pickers cannot express is returned untouched. Every such
  // expression parses to the same fallback, so normalizing them would make two
  // different schedules compare equal — and a comparison that says "unchanged"
  // about a real change silently discards the edit.
  return representable ? buildCron(parts) : cron;
}

/** Build the six-field expression the backend expects. */
export function buildCron(parts: CronParts): string {
  const [hour, minute] = (isValidTime(parts.time) ? parts.time : DEFAULT_TIME)
    .split(':')
    .map((value) => Number(value));

  if (parts.frequency === 'week') {
    const days = parts.daysOfWeek.length
      ? [...parts.daysOfWeek]
          .sort((a, b) => DOW_VALUES.indexOf(a) - DOW_VALUES.indexOf(b))
          .join(',')
      : '*';
    return `0 ${minute} ${hour} * * ${days}`;
  }

  const day = Number(parts.dayOfMonth);
  const safeDay = Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
  return `0 ${minute} ${hour} ${safeDay} * *`;
}
