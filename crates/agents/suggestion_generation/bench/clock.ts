// Moving a persona's dates to the day the bench runs. Each persona was
// written for one evening (`ANCHOR`): its mail is dated relative to it and its
// text names dates ("Thu Nov 12", "week of 10/26"). A session reads the real
// clock, so the bench seeds the mail as old as it was at the anchor and moves
// every date in the text by the same whole number of days, weekdays too, so
// "the board meets Thursday" is still three days off and still a Thursday.
// Month names on their own and quarters ("Q4") stay as written.

/** The evening every persona was written for: Sunday 2026-11-08, 20:00 UTC. */
export const ANCHOR = Date.parse('2026-11-08T20:00:00Z');

const DAY_MS = 86_400_000;

/** Whole days from the anchor to `now`, the amount every date in the text moves. */
export const shiftDays = (now: number) => Math.round((now - ANCHOR) / DAY_MS);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The year the personas' dates fall in when they don't say. */
const YEAR = 2026;

/** `name` written the way `like` is: full or three letters, with a dot after an abbreviation when it had one. */
function styled(name: string, like: string) {
  const dot = like.endsWith('.') ? '.' : '';
  const word = like.replace('.', '');
  if (MONTHS.includes(word)) return name;
  // "Sept" keeps four letters only while it is still September.
  return (word.length === 4 && name === 'September' ? 'Sept' : name.slice(0, 3)) + dot;
}

const monthIndex = (word: string) => MONTHS.findIndex((month) => month.slice(0, 3) === word.slice(0, 3));

/** The date `days` after `month`/`day` of `year`, in UTC. */
function moved(year: number, month: number, day: number, days: number) {
  return new Date(Date.UTC(year, month, day) + days * DAY_MS);
}

// "Nov 12", "November 12th", "Nov. 12, 2026"
const MONTH_DAY =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(\.?) (\d{1,2})(st|nd|rd|th)?(, (20\d\d))?\b/g;
// "Monday the 9th": a day of a month the text leaves out.
const WEEKDAY_ORDINAL = /\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday) the (\d{1,2})(st|nd|rd|th)\b/g;
// "10/26", only for the months the personas span, so pipe sizes ("3/4") and "24/7" stay.
const NUMERIC = /(?<![\d/.])\b(9|10|11|12)\/(\d{1,2})\b(?![\d/"”])/g;
// "2026-11-12", also as the start of "2026-11-12T09:00Z".
const ISO = /\b(20\d\d)-(\d\d)-(\d\d)(?!\d)/g;
// "Thu", "Thursday", "Thursdays", and the longer "Tues", "Weds", "Thurs".
const WEEKDAY = /\b(Sun|Mon|Tues|Tue|Weds|Wed|Thurs|Thur|Thu|Fri|Sat)(day|sday|nesday|rsday|urday)?(s?)\b/g;

const ordinal = (day: number) => {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][day % 10] ?? 'th';
};

/**
 * `text` with every date and weekday moved `days` days. Dates are moved
 * before weekdays, and each through a placeholder, so nothing moves twice.
 */
export function shiftText(text: string, days: number): string {
  if (days === 0) return text;
  const held: string[] = [];
  const hold = (value: string) => `\u0000${held.push(value) - 1}\u0000`;
  // The month is the one near the anchor in which that day falls on that weekday.
  let out = text.replace(WEEKDAY_ORDINAL, (whole, weekday: string, day: string) => {
    const date = Number(day);
    const anchor = new Date(ANCHOR);
    const month = [-1, 0, 1]
      .map((offset) => new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, date)))
      .find((candidate) => candidate.getUTCDate() === date && WEEKDAYS[candidate.getUTCDay()] === weekday);
    if (!month) return hold(whole);
    const next = new Date(month.getTime() + days * DAY_MS);
    return hold(`${WEEKDAYS[next.getUTCDay()]} the ${next.getUTCDate()}${ordinal(next.getUTCDate())}`);
  });
  out = out.replace(MONTH_DAY, (whole, month: string, dot: string, day: string, suffix: string | undefined, comma: string | undefined, year: string | undefined) => {
    const index = monthIndex(month);
    const date = Number(day);
    if (index < 0 || date < 1 || date > 31) return whole;
    const next = moved(year ? Number(year) : YEAR, index, date, days);
    const name = styled(MONTHS[next.getUTCMonth()], month + dot);
    const nextDay = next.getUTCDate();
    return hold(
      `${name} ${nextDay}${suffix ? ordinal(nextDay) : ''}${comma ? `, ${next.getUTCFullYear()}` : ''}`,
    );
  });
  out = out.replace(NUMERIC, (whole, month: string, day: string) => {
    const date = Number(day);
    if (date < 1 || date > 31) return whole;
    const next = moved(YEAR, Number(month) - 1, date, days);
    return hold(`${next.getUTCMonth() + 1}/${next.getUTCDate()}`);
  });
  out = out.replace(ISO, (whole, year: string, month: string, day: string) => {
    const next = moved(Number(year), Number(month) - 1, Number(day), days);
    return hold(next.toISOString().slice(0, 10));
  });
  const step = ((days % 7) + 7) % 7;
  out = out.replace(WEEKDAY, (whole, short: string, rest: string | undefined, plural: string) => {
    const index = WEEKDAYS.findIndex((weekday) => weekday.startsWith(short.slice(0, 3)));
    // "Wed" with "day" after it isn't a weekday; only the real endings count.
    if (rest && !WEEKDAYS[index].endsWith(rest)) return whole;
    const next = WEEKDAYS[(index + step) % 7];
    return hold((rest ? next : next.slice(0, 3)) + plural);
  });
  return out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => held[Number(index)]);
}

/** Every string inside `value` moved `days` days, keys left alone. */
export function shiftAll<T>(value: T, days: number): T {
  if (typeof value === 'string') return shiftText(value, days) as T;
  if (Array.isArray(value)) return value.map((item) => shiftAll(item, days)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftAll(item, days)])) as T;
  }
  return value;
}
