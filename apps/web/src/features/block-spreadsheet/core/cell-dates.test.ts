import { format as formatExcelNumber } from 'ssf';
import { describe, expect, it } from 'vitest';
import {
  dateFormatStyle,
  parseTypedDate,
  typedDateText,
  typedDayText,
} from './cell-dates';
import { SPREADSHEET_DATE_FORMATS } from './toolbar-types';

const isoDate = (serial: number) => formatExcelNumber('yyyy-mm-dd', serial);

describe('typed dates', () => {
  it.each([
    ['01/2026', '2026-01-01', 'mmm yyyy'],
    ['1-2026', '2026-01-01', 'mmm yyyy'],
    ['Jan 2026', '2026-01-01', 'mmm yyyy'],
    ['jan. 2026', '2026-01-01', 'mmm yyyy'],
    ['January, 2026', '2026-01-01', 'mmmm yyyy'],
    ['Sept 2026', '2026-09-01', 'mmm yyyy'],
    ['Jan 01 2026', '2026-01-01', 'mmm dd, yyyy'],
    ['Jan 1, 2026', '2026-01-01', 'mmm d, yyyy'],
    ['January 17th, 2026', '2026-01-17', 'mmmm dd, yyyy'],
    ['Thursday, January 1, 2026', '2026-01-01', 'dddd, mmmm d, yyyy'],
    ['Thu Jan 1 2026', '2026-01-01', 'ddd, mmm d, yyyy'],
    ['1 Jan 2026', '2026-01-01', 'd mmm yyyy'],
    ['01-Jan-26', '2026-01-01', 'dd-mmm-yyyy'],
    ['17 September 2026', '2026-09-17', 'dd mmmm yyyy'],
    ['2026-01-01', '2026-01-01', 'yyyy-mm-dd'],
    ['2026/9/17', '2026-09-17', 'yyyy/mm/dd'],
    ['9-17-2026', '2026-09-17', 'm-d-yyyy'],
  ])('reads %s as %s shown as %s', (input, date, numberFormat) => {
    const typed = parseTypedDate(input, 'en-US');
    expect(typed?.numberFormat).toBe(numberFormat);
    expect(isoDate(typed!.serial)).toBe(date);
  });

  it('shows month/day/year input in the default date format', () => {
    expect(parseTypedDate('1/1/2026', 'en-US')).toEqual({ serial: 46023 });
    expect(parseTypedDate(' 1/1/26 ', 'en-US')).toEqual({ serial: 46023 });
    expect(parseTypedDate('12/31/2026', 'en-US')).toEqual({ serial: 46387 });
  });

  it('reads two-digit years as Excel does', () => {
    expect(isoDate(parseTypedDate('1/1/29', 'en-US')!.serial)).toBe(
      '2029-01-01'
    );
    expect(isoDate(parseTypedDate('1/1/30', 'en-US')!.serial)).toBe(
      '1930-01-01'
    );
  });

  it('reads numeric day and month in the locale’s order', () => {
    expect(parseTypedDate('03/04/2026', 'en-US')).toEqual({ serial: 46085 });
    expect(parseTypedDate('03/04/2026', 'en-GB')).toEqual({
      serial: 46115,
      numberFormat: 'd/m/yyyy',
    });
    expect(parseTypedDate('3.4.2026', 'de-DE')).toEqual({
      serial: 46115,
      numberFormat: 'd.m.yyyy',
    });
    expect(parseTypedDate('17/09/2026', 'en-US')).toBeUndefined();
    expect(parseTypedDate('17/09/2026', 'fr-FR')?.serial).toBe(46282);
    // Month names and year-first dates read the same everywhere.
    expect(parseTypedDate('Mar 4, 2026', 'en-GB')?.serial).toBe(46085);
    expect(parseTypedDate('2026-03-04', 'de-DE')?.serial).toBe(46085);
    expect(parseTypedDate('3/4/2026', 'not a locale')?.serial).toBe(46085);
  });

  it.each([
    '2/30/2026',
    '13/1/2026',
    'Jan 32 2026',
    'Friday, January 1, 2026',
    'due Jan 1 2026',
    'Jan 26',
    '1/2',
    '01/26',
    '2026',
    '2026-01',
    'Jan',
    'Ma 2026',
    'Junk 2026',
    'revenue 2026',
    '1.5',
    '12345',
    '1/1/1899',
    '1/1/1900',
    '=DATE(2026,1,1)',
    '',
  ])('leaves %j as text', (input) => {
    expect(parseTypedDate(input, 'en-US')).toBeUndefined();
  });

  it('edits a date as text that reads back as the same date', () => {
    expect(typedDateText(46085, 'en-US')).toBe('3/4/2026');
    expect(typedDateText(46085, 'en-GB')).toBe('4/3/2026');
    expect(typedDateText(46085, 'ja-JP')).toBe('2026/3/4');
    for (const locale of ['en-US', 'en-GB', 'de-DE', 'fr-FR', 'ja-JP', 'ko-KR'])
      for (const serial of [61, 10_000, 46_023, 46_085, 2_958_465])
        expect(
          parseTypedDate(typedDateText(serial, locale)!, locale)?.serial
        ).toBe(serial);
  });

  it('enters a picked local day as text that reads back as that day', () => {
    // Late in the evening, so a UTC conversion would land on the next day.
    const day = new Date(2026, 9, 16, 23, 59);
    expect(typedDayText(day, 'en-US')).toBe('10/16/2026');
    expect(typedDayText(day, 'en-GB')).toBe('16/10/2026');
    expect(typedDayText(day, 'ja-JP')).toBe('2026/10/16');
    for (const locale of ['en-US', 'en-GB', 'de-DE', 'ja-JP'])
      expect(
        parseTypedDate(`${typedDayText(day, locale)} `, locale)?.serial
      ).toBe(46311);
  });

  it('leaves times of day and out-of-range serials to the raw number', () => {
    expect(typedDateText(46023.5, 'en-US')).toBeUndefined();
    expect(typedDateText(60, 'en-US')).toBeUndefined();
    expect(typedDateText(2_958_466, 'en-US')).toBeUndefined();
  });
});

describe('date format codes', () => {
  it('maps date and time codes to cell styles', () => {
    expect(dateFormatStyle('mmm yyyy')).toEqual({
      format: 'date',
      numberFormat: 'mmm yyyy',
    });
    expect(dateFormatStyle('mmmm')).toEqual({
      format: 'date',
      numberFormat: 'mmmm',
    });
    expect(dateFormatStyle('m/d/yyyy')).toEqual({ format: 'date' });
    expect(dateFormatStyle('h:mm')).toEqual({
      format: 'time',
      numberFormat: 'h:mm',
    });
    expect(dateFormatStyle('h:mm:ss AM/PM')).toEqual({ format: 'time' });
  });

  it.each(['', 'General', '0.00', '$#,##0', '@', `${'d'.repeat(513)}`])(
    'rejects %j, which is not a date or time code',
    (code) => {
      expect(dateFormatStyle(code)).toBeUndefined();
    }
  );

  it('shows each preset as its menu example', () => {
    for (const preset of SPREADSHEET_DATE_FORMATS) {
      expect(formatExcelNumber(preset.numberFormat, 46_282)).toBe(
        preset.example
      );
      expect(dateFormatStyle(preset.numberFormat)).toEqual({
        format: 'date',
        numberFormat: preset.numberFormat,
      });
    }
  });
});
