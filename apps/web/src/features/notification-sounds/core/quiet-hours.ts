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

/**
 * When notification sounds and desktop alerts stay quiet.
 * Saved with the other sound settings, per person and per device.
 */
export type QuietHours = {
  enabled: boolean;
  /** Minutes from midnight, 0–1439. A later start runs through midnight. */
  startMinutes: number;
  /** Minutes from midnight, 0–1439. The window ends at this minute. */
  endMinutes: number;
  /**
   * Calendar days, in the schedule's time zone, that use the clock window.
   * Tuesday morning is quiet only when Tuesday is selected.
   */
  days: readonly Weekday[];
  /** IANA zone. Empty means the device zone at the moment of evaluation. */
  timeZone: string;
};

/** Off until turned on, then every day from 10:00 PM to 8:00 AM. */
export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startMinutes: 22 * 60,
  endMinutes: 8 * 60,
  days: WEEKDAYS,
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

/** The device's IANA time zone, or UTC when the runtime cannot name one. */
export function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Reads a saved schedule, keeping each valid field and defaulting the rest. */
export function parseQuietHours(raw: unknown): QuietHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_QUIET_HOURS;
  const value = raw as Record<string, unknown>;
  const storedDays = value.days;
  const days = Array.isArray(storedDays)
    ? WEEKDAYS.filter((day) => storedDays.includes(day))
    : DEFAULT_QUIET_HOURS.days;
  const timeZone = typeof value.timeZone === 'string' ? value.timeZone : '';
  return {
    enabled: value.enabled === true,
    startMinutes: clockMinutes(
      value.startMinutes,
      DEFAULT_QUIET_HOURS.startMinutes
    ),
    endMinutes: clockMinutes(value.endMinutes, DEFAULT_QUIET_HOURS.endMinutes),
    days,
    timeZone: timeZone && isTimeZone(timeZone) ? timeZone : '',
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

/** Whether `now` falls inside the schedule. An equal start and end covers nothing. */
export function isWithinQuietHours(quietHours: QuietHours, now: Date): boolean {
  if (!quietHours.enabled || quietHours.days.length === 0) return false;
  if (quietHours.startMinutes === quietHours.endMinutes) return false;
  const clock = zonedClock(now, quietHours.timeZone);
  if (!clock || !quietHours.days.includes(clock.weekday)) return false;
  const { minutes } = clock;
  if (quietHours.startMinutes < quietHours.endMinutes) {
    return (
      minutes >= quietHours.startMinutes && minutes < quietHours.endMinutes
    );
  }
  return minutes >= quietHours.startMinutes || minutes < quietHours.endMinutes;
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
