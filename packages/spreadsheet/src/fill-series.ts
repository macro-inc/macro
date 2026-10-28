import { is_date } from 'ssf';
import type { SpreadsheetCell } from './spreadsheet-document';

const DAY_MS = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const numberInput = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
type SeriesValue = {
  number: number;
  date?: Date;
  render: (value: number) => string;
};

function numericText(value: number) {
  return String(Number(value.toPrecision(15)));
}

function readValue(cell: SpreadsheetCell): SeriesValue | undefined {
  if (cell.format === 'text') return;
  const text = cell.value.trim();
  if (numberInput.test(text)) {
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    const dated =
      cell.format === 'date' ||
      (!!cell.numberFormat && is_date(cell.numberFormat));
    // Serial 60 is Excel's fictitious leap day; leave that sequence numeric.
    const date =
      dated && number >= 61 && Number.isInteger(number)
        ? new Date(EXCEL_EPOCH + number * DAY_MS)
        : undefined;
    return { number, date, render: numericText };
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (!iso && !slash) return;
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : [Number(slash![3]), Number(slash![1]), Number(slash![2])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return;
  return {
    number: (date.getTime() - EXCEL_EPOCH) / DAY_MS,
    date,
    render: (value) => {
      const next = new Date(EXCEL_EPOCH + value * DAY_MS);
      return iso
        ? next.toISOString().slice(0, 10)
        : `${next.getUTCMonth() + 1}/${next.getUTCDate()}/${next.getUTCFullYear()}`;
    },
  };
}

function monthEnd(date: Date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
}

/** Infer one lane of a drag fill. Formulas, text and irregular patterns repeat. */
export function inferFillSeries(
  cells: SpreadsheetCell[]
): ((index: number) => string | undefined) | undefined {
  const values = cells.map(readValue);
  if (!values.length || values.some((value) => !value)) return;
  const samples = values as SeriesValue[];
  const first = samples[0];
  const dates = samples.map((value) => value.date);
  if (
    dates.every(
      (date): date is Date => !!date && Number.isFinite(date.getTime())
    ) &&
    dates.length > 1
  ) {
    const months = dates.map(
      (date) => date.getUTCFullYear() * 12 + date.getUTCMonth()
    );
    const step = months[1] - months[0];
    const ends = dates.every((date) => date.getUTCDate() === monthEnd(date));
    const sameDay = dates.every(
      (date) => date.getUTCDate() === dates[0].getUTCDate()
    );
    if (
      step &&
      (ends || sameDay) &&
      months.every((month, index) => month === months[0] + index * step)
    ) {
      return (index) => {
        const next = new Date(
          Date.UTC(
            dates[0].getUTCFullYear(),
            dates[0].getUTCMonth() + index * step,
            1
          )
        );
        next.setUTCDate(
          ends
            ? monthEnd(next)
            : Math.min(dates[0].getUTCDate(), monthEnd(next))
        );
        return Number.isFinite(next.getTime())
          ? first.render((next.getTime() - EXCEL_EPOCH) / DAY_MS)
          : undefined;
      };
    }
  }
  if (samples.length < 2 && !first.date) return;
  const step = samples.length > 1 ? samples[1].number - first.number : 1;
  if (
    !samples.every(
      (value, index) =>
        Math.abs(value.number - (first.number + index * step)) <=
        1e-10 * Math.max(1, Math.abs(step))
    )
  )
    return;
  return (index) => {
    const next = first.number + index * step;
    if (!Number.isFinite(next) || (first.date && Math.abs(next) > 100_000_000))
      return;
    return first.render(next);
  };
}
