import type { ChartValue } from '@macro-inc/spreadsheet/sheet-drawings';

/** A cell a chart reads, with the Excel number format it displays with. */
export type CellChartValue = ChartValue & { format?: string };
export type ChartValues = (reference: string) => CellChartValue[] | undefined;

export function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const numberText = (value: number) =>
  Number.isInteger(value)
    ? String(value)
    : String(Number(value.toPrecision(15)));

/** The number format of the first number among values, as Excel caches it. */
export const numberFormat = (values: CellChartValue[] | undefined) =>
  values?.find((value) => value.number !== undefined)?.format || 'General';
