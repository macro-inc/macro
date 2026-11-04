import { Result } from 'neverthrow';
import { format as formatExcelNumber, is_date } from 'ssf';
import type { SpreadsheetCellStyle } from './spreadsheet-document';
import { readNumberFormat } from './xlsx-styles';

const DAY_MILLISECONDS = 86_400_000;
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
/** 1 March 1900: earlier serials count Excel's fictitious 29 February 1900. */
const FIRST_SERIAL = 61;
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const NAME = '([a-z]+)\\.?';
const ORDINAL = '(?:st|nd|rd|th)?';
const monthYear = new RegExp(`^${NAME},?[ -](\\d{4})$`);
const monthDayYear = new RegExp(
  `^(?:${NAME},? )?${NAME}[ -](\\d{1,2})${ORDINAL},?[ -](\\d{2}|\\d{4})$`
);
const dayMonthYear = new RegExp(
  `^(?:${NAME},? )?(\\d{1,2})${ORDINAL}([ -])${NAME},?[ -](\\d{2}|\\d{4})$`
);

/** A typed date as an Excel serial, with the Excel format that shows it the
 * way it was typed; without one it shows as Macro's default m/d/yyyy. */
export type TypedDate = { serial: number; numberFormat?: string };

const localeDateParts = Result.fromThrowable(
  (locale: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC' })
      .formatToParts(0)
      .map((part) => part.type),
  () => 'unknown locale' as const
);

/** The order of day, month and year in the locale's numeric dates. */
function dateOrder(locale: string): 'dmy' | 'mdy' | 'ymd' {
  const parts = localeDateParts(locale);
  if (parts.isErr()) return 'mdy';
  const day = parts.value.indexOf('day');
  const month = parts.value.indexOf('month');
  if (parts.value.indexOf('year') < Math.min(day, month)) return 'ymd';
  return day < month ? 'dmy' : 'mdy';
}

/** A full or abbreviated (three letters or more) English name's index. */
function nameIndex(names: string[], text: string) {
  const index =
    text.length < 3 ? -1 : names.findIndex((name) => name.startsWith(text));
  return index < 0 ? undefined : { index, full: names[index] === text };
}

/** Two-digit years 00–29 are this century and 30–99 the last, as in Excel. */
function fullYear(text: string) {
  const year = Number(text);
  if (text.length === 4) return year;
  return year < 30 ? 2000 + year : 1900 + year;
}

/** The leading weekday of a date code, as long as the typed one. */
function weekdayCode(weekday: string | undefined) {
  if (weekday === undefined) return '';
  return nameIndex(WEEKDAYS, weekday)?.full ? 'dddd, ' : 'ddd, ';
}

function typedDate(
  year: number,
  month: number,
  day: number,
  numberFormat: string | undefined,
  weekday?: string
): TypedDate | undefined {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return;
  if (
    weekday !== undefined &&
    nameIndex(WEEKDAYS, weekday)?.index !== date.getUTCDay()
  )
    return;
  const serial = (time - SERIAL_EPOCH) / DAY_MILLISECONDS;
  if (serial < FIRST_SERIAL) return;
  return numberFormat === undefined ? { serial } : { serial, numberFormat };
}

/** `2026-01-01`, `1/1/26` or `01/2026`. */
function numericDate(text: string, locale: string) {
  let match = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(text);
  if (match) {
    const [, year, separator, month, day] = match;
    return typedDate(
      Number(year),
      Number(month),
      Number(day),
      `yyyy${separator}mm${separator}dd`
    );
  }
  match = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const [, first, separator, second, year] = match;
    const dayFirst = dateOrder(locale) === 'dmy';
    const code = dayFirst
      ? `d${separator}m${separator}yyyy`
      : `m${separator}d${separator}yyyy`;
    return typedDate(
      fullYear(year),
      Number(dayFirst ? second : first),
      Number(dayFirst ? first : second),
      code === 'm/d/yyyy' ? undefined : code
    );
  }
  match = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match)
    return typedDate(Number(match[2]), Number(match[1]), 1, 'mmm yyyy');
}

/** `Jan 2026`, `Thursday, January 1, 2026` or `1 Jan 2026`. */
function namedDate(text: string) {
  let match = monthYear.exec(text);
  if (match) {
    const month = nameIndex(MONTHS, match[1]);
    return (
      month &&
      typedDate(
        Number(match[2]),
        month.index + 1,
        1,
        `${month.full ? 'mmmm' : 'mmm'} yyyy`
      )
    );
  }
  match = monthDayYear.exec(text);
  if (match) {
    const [, weekday, name, day, year] = match;
    const month = nameIndex(MONTHS, name);
    return (
      month &&
      typedDate(
        fullYear(year),
        month.index + 1,
        Number(day),
        `${weekdayCode(weekday)}${month.full ? 'mmmm' : 'mmm'} ${day.length === 2 ? 'dd' : 'd'}, yyyy`,
        weekday
      )
    );
  }
  match = dayMonthYear.exec(text);
  if (match) {
    const [, weekday, day, separator, name, year] = match;
    const month = nameIndex(MONTHS, name);
    return (
      month &&
      typedDate(
        fullYear(year),
        month.index + 1,
        Number(day),
        `${weekdayCode(weekday)}${day.length === 2 ? 'dd' : 'd'}${separator}${month.full ? 'mmmm' : 'mmm'}${separator}yyyy`,
        weekday
      )
    );
  }
}

/**
 * A date typed into a cell, such as `01/2026`, `Jan 2026`, `Jan 01 2026`,
 * `1 January 2026`, `2026-01-01` or `1/1/26`. All-numeric dates read day and
 * month in the locale's order; names are English. Text that is not a whole
 * date, a day that does not exist, or a weekday that does not match it is
 * undefined, as are dates before March 1900.
 */
export function parseTypedDate(
  input: string,
  locale: string
): TypedDate | undefined {
  const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
  return numericDate(text, locale) ?? namedDate(text);
}

/**
 * A whole-day serial as the numeric date `parseTypedDate` reads back in the
 * same locale, for editing a date cell. Undefined for times of day and
 * serials outside the dates it reads.
 */
export function typedDateText(
  serial: number,
  locale: string
): string | undefined {
  if (!Number.isInteger(serial) || serial < FIRST_SERIAL) return;
  const date = new Date(SERIAL_EPOCH + serial * DAY_MILLISECONDS);
  const year = date.getUTCFullYear();
  if (!(year <= 9999)) return;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  switch (dateOrder(locale)) {
    case 'ymd':
      return `${year}/${month}/${day}`;
    case 'dmy':
      return `${day}/${month}/${year}`;
    case 'mdy':
      return `${month}/${day}/${year}`;
  }
}

/**
 * A local calendar day as the numeric date `parseTypedDate` reads back in the
 * same locale, for entering a picked day as if it were typed.
 */
export function typedDayText(day: Date, locale: string): string | undefined {
  const time = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  return typedDateText((time - SERIAL_EPOCH) / DAY_MILLISECONDS, locale);
}

const readDateFormat = Result.fromThrowable(
  (code: string): SpreadsheetCellStyle | undefined => {
    if (!is_date(code)) return;
    formatExcelNumber(code, 0);
    const style = readNumberFormat(code);
    return { ...style, format: style.format === 'time' ? 'time' : 'date' };
  },
  () => 'unsupported format' as const
);

/**
 * The cell style for an Excel date or time format code, or undefined when the
 * code is not one Macro can display.
 */
export function dateFormatStyle(
  code: string
): SpreadsheetCellStyle | undefined {
  return readDateFormat(code).unwrapOr(undefined);
}
