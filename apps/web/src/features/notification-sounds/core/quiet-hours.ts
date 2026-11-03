/** Days the schedule can select, Monday through Sunday. */
export const WEEKDAYS = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_NAMES: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

const MINUTES_IN_DAY = 24 * 60;
const DEFAULT_START_MINUTES = 22 * 60;
const DEFAULT_END_MINUTES = 8 * 60;

/**
 * How one calendar day treats sounds and desktop alerts.
 * `off` never quiets that day. `all-day` quiets the whole day.
 * `hours` uses this day's own clock window.
 */
export type DayQuietMode = 'off' | 'hours' | 'all-day';

export type DayQuietHours = {
  mode: DayQuietMode;
  /** Minutes from midnight, 0–1439. A later start runs through midnight. */
  startMinutes: number;
  /** Minutes from midnight, 0–1439. The window ends at this minute. */
  endMinutes: number;
};

/**
 * When notification sounds and desktop alerts stay quiet.
 * Saved with the other sound settings, per person and per device.
 * Each weekday has its own window, so a weekend day can differ or be off.
 */
export type QuietHours = {
  enabled: boolean;
  days: Record<Weekday, DayQuietHours>;
  /** IANA zone. Empty means the device zone at the moment of evaluation. */
  timeZone: string;
};

function week(
  make: (day: Weekday) => DayQuietHours
): Record<Weekday, DayQuietHours> {
  return {
    mon: make('mon'),
    tue: make('tue'),
    wed: make('wed'),
    thu: make('thu'),
    fri: make('fri'),
    sat: make('sat'),
    sun: make('sun'),
  };
}

function dayWindow(
  mode: DayQuietMode,
  startMinutes = DEFAULT_START_MINUTES,
  endMinutes = DEFAULT_END_MINUTES
): DayQuietHours {
  return { mode, startMinutes, endMinutes };
}

/** Off until turned on, then every day from 10:00 PM to 8:00 AM. */
export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  days: week(() => dayWindow('hours')),
  timeZone: '',
};

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  Mon: 'mon',
  Monday: 'mon',
  Tue: 'tue',
  Tuesday: 'tue',
  Wed: 'wed',
  Wednesday: 'wed',
  Thu: 'thu',
  Thursday: 'thu',
  Fri: 'fri',
  Friday: 'fri',
  Sat: 'sat',
  Saturday: 'sat',
  Sun: 'sun',
  Sunday: 'sun',
};

function clockMinutes(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  if (value < 0 || value >= MINUTES_IN_DAY) return fallback;
  return value;
}

function isTimeZone(zone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function isWeekday(value: unknown): value is Weekday {
  return (
    typeof value === 'string' && (WEEKDAYS as readonly string[]).includes(value)
  );
}

function isDayMode(value: unknown): value is DayQuietMode {
  return value === 'off' || value === 'hours' || value === 'all-day';
}

/** The device's IANA time zone, or UTC when the runtime cannot name one. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

function parseDay(raw: unknown, fallback: DayQuietHours): DayQuietHours {
  if (!raw || typeof raw !== 'object') return fallback;
  const value = raw as Record<string, unknown>;
  return {
    mode: isDayMode(value.mode) ? value.mode : fallback.mode,
    startMinutes: clockMinutes(value.startMinutes, fallback.startMinutes),
    endMinutes: clockMinutes(value.endMinutes, fallback.endMinutes),
  };
}

/**
 * Reads a saved schedule. A `days` object is one window per weekday.
 * A `days` array is the first release's shared window: listed days use it,
 * and every other day is off but keeps those times.
 */
export function parseQuietHours(raw: unknown): QuietHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_QUIET_HOURS;
  const value = raw as Record<string, unknown>;
  const timeZone = typeof value.timeZone === 'string' ? value.timeZone : '';
  const schedule: QuietHours = {
    enabled: value.enabled === true,
    days: DEFAULT_QUIET_HOURS.days,
    timeZone: timeZone && isTimeZone(timeZone) ? timeZone : '',
  };

  if (
    value.days &&
    typeof value.days === 'object' &&
    !Array.isArray(value.days)
  ) {
    const stored = value.days as Record<string, unknown>;
    return {
      ...schedule,
      days: week((day) => parseDay(stored[day], DEFAULT_QUIET_HOURS.days[day])),
    };
  }

  const startMinutes = clockMinutes(value.startMinutes, DEFAULT_START_MINUTES);
  const endMinutes = clockMinutes(value.endMinutes, DEFAULT_END_MINUTES);
  const selected = Array.isArray(value.days)
    ? new Set(value.days.filter(isWeekday))
    : new Set<Weekday>(WEEKDAYS);
  return {
    ...schedule,
    days: week((day) =>
      dayWindow(selected.has(day) ? 'hours' : 'off', startMinutes, endMinutes)
    ),
  };
}

function zonedClock(
  now: Date,
  timeZone: string
): { weekday: Weekday; minutes: number } | null {
  const zone = timeZone || deviceTimeZone();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const weekday = WEEKDAY_BY_NAME[read('weekday') ?? ''];
    const hour = Number(read('hour'));
    const minute = Number(read('minute'));
    if (!weekday || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    const normalizedHour = hour === 24 ? 0 : hour;
    if (normalizedHour > 23 || minute > 59) return null;
    return { weekday, minutes: normalizedHour * 60 + minute };
  } catch {
    if (timeZone) return zonedClock(now, '');
    return null;
  }
}

function minutesInsideWindow(
  minutes: number,
  startMinutes: number,
  endMinutes: number
): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return minutes >= startMinutes && minutes < endMinutes;
  }
  return minutes >= startMinutes || minutes < endMinutes;
}

/**
 * Whether `now` falls inside that calendar day's window.
 * Tuesday morning follows Tuesday's hours, not Monday's overnight end.
 * An equal start and end covers nothing. `all-day` covers the whole day.
 */
export function isWithinQuietHours(quietHours: QuietHours, now: Date): boolean {
  if (!quietHours.enabled) return false;
  const clock = zonedClock(now, quietHours.timeZone);
  if (!clock) return false;
  const day = quietHours.days[clock.weekday];
  if (day.mode === 'off') return false;
  if (day.mode === 'all-day') return true;
  return minutesInsideWindow(clock.minutes, day.startMinutes, day.endMinutes);
}

/**
 * Whether this alert should stay silent and skip the desktop notification.
 * Incoming calls keep their own ring and alert.
 */
export function quietHoursMute(
  eventTag: string,
  quietHours: QuietHours,
  now: Date
): boolean {
  if (eventTag === 'call_started') return false;
  return isWithinQuietHours(quietHours, now);
}
