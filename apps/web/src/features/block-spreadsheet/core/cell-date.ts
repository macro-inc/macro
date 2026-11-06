import {
  cellDateMention,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { numericLiteral } from '@macro-inc/spreadsheet/number-display';

const DAY_MILLISECONDS = 86_400_000;
/** Excel's serial day 0. Serials after 60 skip its fictitious 29 February 1900. */
const SERIAL_ZERO = Date.UTC(1899, 11, 31);

/** The local calendar day an Excel serial number falls on. */
export function serialDay(serial: number): Date {
  const day = Math.floor(serial);
  const date = new Date(
    SERIAL_ZERO + (day > 60 ? day - 1 : day) * DAY_MILLISECONDS
  );
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function daySerial(day: Date): number {
  const days =
    (Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) - SERIAL_ZERO) /
    DAY_MILLISECONDS;
  return days >= 60 ? days + 1 : days;
}

/**
 * The input that puts `day` in a cell holding `value`, written the way
 * `value` is: a serial number keeps its time of day, a date pill stays a pill
 * and ISO text stays ISO. Other cells get month/day/year, as the grid shows
 * dates.
 */
export function cellDateInput(value: string, day: Date): string {
  if (numericLiteral.test(value)) {
    const serial = Number(value);
    const time = serial - Math.floor(serial);
    return String(Number((daySerial(day) + time).toPrecision(15)));
  }
  if (cellDateMention(value))
    return encodeCellMention({
      type: 'date',
      date: day.toISOString(),
      displayFormat: '',
    });
  const month = day.getMonth() + 1;
  if (/^\s*\d{4}-\d{1,2}-\d{1,2}\s*$/.test(value))
    return `${day.getFullYear()}-${String(month).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return `${month}/${day.getDate()}/${day.getFullYear()}`;
}
