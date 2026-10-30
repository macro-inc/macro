export interface ParsedTime {
  hours: number; // 0-23
  minutes: number; // 0-59
}

/** `alternate` is the other half of the day when the input gave no am/pm. */
interface TimeReading {
  time: ParsedTime;
  alternate?: ParsedTime;
}

type Meridiem = 'am' | 'pm';

const MONTH_WORDS = new Set([
  'jan',
  'january',
  'feb',
  'february',
  'mar',
  'march',
  'apr',
  'april',
  'may',
  'jun',
  'june',
  'jul',
  'july',
  'aug',
  'august',
  'sep',
  'sept',
  'september',
  'oct',
  'october',
  'nov',
  'november',
  'dec',
  'december',
]);

/** Tokens that can stand alone as a date before a bare hour like "tmrw 8". */
const DATE_WORD_PREFIXES = new Set([
  'today',
  'tod',
  'tomorrow',
  'tmrw',
  'tmr',
  'tom',
  'tomorow',
  'tomoro',
  'tmro',
  'yesterday',
  'yest',
  'ystrdy',
  'yday',
  'sun',
  'sunday',
  'mon',
  'monday',
  'mndy',
  'tue',
  'tues',
  'tuesday',
  'tu',
  'wed',
  'weds',
  'wednes',
  'wednesday',
  'thu',
  'thur',
  'thurs',
  'thursday',
  'fri',
  'friday',
  'sat',
  'saturday',
]);

const DATE_PHRASES = new Set(['next week', 'nw']);

function normalizeMeridiem(raw: string): Meridiem | null {
  const value = raw.toLowerCase();
  if (value === 'a' || value === 'am') return 'am';
  if (value === 'p' || value === 'pm') return 'pm';
  return null;
}

function applyMeridiem(hours: number, meridiem: Meridiem): number | null {
  if (hours < 1 || hours > 12) return null;
  if (meridiem === 'pm' && hours !== 12) return hours + 12;
  if (meridiem === 'am' && hours === 12) return 0;
  return hours;
}

/**
 * Without am/pm, 7–11 read as morning and 12–6 as afternoon, the hours people
 * send mail and set reminders for. A leading zero ("05:00") or an hour past 12
 * is 24-hour time.
 */
function readClockTime(hourRaw: string, minutes: number): TimeReading {
  const hours = parseInt(hourRaw, 10);
  if (hours < 1 || hours > 12 || hourRaw.startsWith('0'))
    return { time: { hours, minutes } };
  const morning = { hours: hours % 12, minutes };
  const afternoon = { hours: (hours % 12) + 12, minutes };
  return hours >= 7 && hours <= 11
    ? { time: morning, alternate: afternoon }
    : { time: afternoon, alternate: morning };
}

function parseHourMinute(
  hourRaw: string,
  minuteRaw: string | undefined,
  meridiemRaw: string | undefined
): TimeReading | null {
  const hours = parseInt(hourRaw, 10);
  const minutes = parseInt(minuteRaw || '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) return null;

  if (meridiemRaw) {
    const meridiem = normalizeMeridiem(meridiemRaw);
    if (!meridiem) return null;
    const converted = applyMeridiem(hours, meridiem);
    if (converted === null) return null;
    return { time: { hours: converted, minutes } };
  }

  if (hours > 23) return null;
  return readClockTime(hourRaw, minutes);
}

/** A bare hour like the "5" in "tom 5"; 0 and 24+ are not hours of a day. */
function parseBareHour(hourRaw: string): TimeReading | null {
  const hours = parseInt(hourRaw, 10);
  if (hours < 1 || hours > 23) return null;
  return readClockTime(hourRaw, 0);
}

/**
 * Parse compact clock forms like "830p" / "1230am" into hour + minute.
 * Only used when a meridiem is present so "830" alone is not treated as a time.
 */
function parseCompactTime(
  digits: string,
  meridiemRaw: string
): TimeReading | null {
  if (digits.length === 3) {
    return parseHourMinute(digits[0], digits.slice(1), meridiemRaw);
  }
  if (digits.length === 4) {
    return parseHourMinute(digits.slice(0, 2), digits.slice(2), meridiemRaw);
  }
  return null;
}

function isBareHourDatePrefix(rest: string): boolean {
  const tokens = rest.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  // "feb 17" / "17 feb" day-of-month forms must not be treated as hours
  if (tokens.some((token) => MONTH_WORDS.has(token))) return false;
  if (DATE_PHRASES.has(tokens.join(' '))) return true;
  const last = tokens[tokens.length - 1]!;
  if (DATE_WORD_PREFIXES.has(last)) return true;
  // Allow short weekday prefixes while typing ("mo", "fr")
  return (
    last.length >= 2 &&
    [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ].some((day) => day.startsWith(last))
  );
}

/**
 * Parse time strings like "9am", "9a", "8p", "3:30pm", "14:00", "noon",
 * "midnight", bare hours like "5", and date+time composites like "tmrw 8",
 * "friday 8p". Returns the most likely time, the other half of the day when
 * the input gave no am/pm, and the remaining input with the time removed.
 */
export function parseTime(
  input: string
): (TimeReading & { rest: string }) | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // "noon"
  if (/^noon$/i.test(trimmed)) {
    return { time: { hours: 12, minutes: 0 }, rest: '' };
  }
  // "midnight"
  if (/^midnight$/i.test(trimmed)) {
    return { time: { hours: 0, minutes: 0 }, rest: '' };
  }

  // Compact meridiem forms first so "830p" is not misread as hour 30
  const compactAtEnd = /^(.*?)\s*(\d{3,4})\s*(a|am|p|pm)\s*$/i;
  let match = trimmed.match(compactAtEnd);
  if (match) {
    const reading = parseCompactTime(match[2], match[3]);
    if (reading) return { ...reading, rest: match[1].trim() };
  }

  // Time at end with meridiem: "tomorrow 9am", "tmrw 8p", "feb 17 3:30 PM"
  // Also matches standalone: "9am", "8p", "3:30pm"
  const timeAtEnd = /^(.*?)\s*(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)\s*$/i;
  match = trimmed.match(timeAtEnd);
  if (match) {
    const reading = parseHourMinute(match[2], match[3], match[4]);
    if (reading) return { ...reading, rest: match[1].trim() };
  }

  // Clock time without meridiem: "14:00", "tomorrow 5:30"
  const clockAtEnd = /^(.*?)\s*(\d{1,2}):(\d{2})\s*$/;
  match = trimmed.match(clockAtEnd);
  if (match) {
    const reading = parseHourMinute(match[2], match[3], undefined);
    if (reading) return { ...reading, rest: match[1].trim() };
  }

  // Bare hour at end when prefix is a relative/weekday word: "tmrw 8", "friday 9"
  const bareHourAtEnd = /^(.*?[^\d\s])\s+(\d{1,2})\s*$/;
  match = trimmed.match(bareHourAtEnd);
  if (match && isBareHourDatePrefix(match[1])) {
    const reading = parseBareHour(match[2]);
    if (reading) return { ...reading, rest: match[1].trim() };
  }

  // Compact meridiem at start: "830p tomorrow"
  const compactAtStart = /^(\d{3,4})\s*(a|am|p|pm)\s+(.+)$/i;
  match = trimmed.match(compactAtStart);
  if (match) {
    const reading = parseCompactTime(match[1], match[2]);
    if (reading) return { ...reading, rest: match[3].trim() };
  }

  // Time at start with meridiem: "9am tomorrow", "8p friday", "3:30 PM feb 17"
  const timeAtStart = /^(\d{1,2})(?::(\d{2}))?\s*(a|am|p|pm)\s+(.+)$/i;
  match = trimmed.match(timeAtStart);
  if (match) {
    const reading = parseHourMinute(match[1], match[2], match[3]);
    if (reading) return { ...reading, rest: match[4].trim() };
  }

  // Bare hour at start with date-word suffix: "8 tmrw", "9 friday"
  const bareHourAtStart = /^(\d{1,2})\s+(.+)$/;
  match = trimmed.match(bareHourAtStart);
  if (match && isBareHourDatePrefix(match[2])) {
    const reading = parseBareHour(match[1]);
    if (reading) return { ...reading, rest: match[2].trim() };
  }

  // Bare hour alone: "5"
  match = trimmed.match(/^(\d{1,2})$/);
  if (match) {
    const reading = parseBareHour(match[1]);
    if (reading) return { ...reading, rest: '' };
  }

  return null;
}
