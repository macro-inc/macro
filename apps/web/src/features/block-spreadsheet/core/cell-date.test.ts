import {
  cellDateMention,
  cellPlainText,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { describe, expect, it } from 'vitest';
import { cellDateInput, serialDay } from './cell-date';

describe('date cells', () => {
  it('reads the calendar day of an Excel serial, around its 1900 leap day', () => {
    expect(serialDay(46311)).toEqual(new Date(2026, 9, 16));
    expect(serialDay(46311.75)).toEqual(new Date(2026, 9, 16));
    expect(serialDay(59)).toEqual(new Date(1900, 1, 28));
    expect(serialDay(61)).toEqual(new Date(1900, 2, 1));
  });

  it('writes a serial number for a serial, keeping its time of day', () => {
    expect(cellDateInput('46311', new Date(2026, 9, 24))).toBe('46319');
    expect(cellDateInput('46311.395833333336', new Date(2026, 9, 17))).toBe(
      '46312.3958333333'
    );
    expect(cellDateInput('59', new Date(1900, 2, 1))).toBe('61');
  });

  it('writes typed dates as ISO when they were, and month/day/year otherwise', () => {
    expect(cellDateInput('2026-01-31', new Date(2026, 1, 28))).toBe(
      '2026-02-28'
    );
    expect(cellDateInput('10/16/2026', new Date(2026, 9, 24))).toBe(
      '10/24/2026'
    );
    expect(cellDateInput('16-Oct-2026', new Date(2026, 9, 24))).toBe(
      '10/24/2026'
    );
    expect(cellDateInput('', new Date(2027, 0, 5))).toBe('1/5/2027');
  });

  it('keeps a date pill a pill', () => {
    const pill = encodeCellMention({
      type: 'date',
      date: new Date(2026, 9, 16).toISOString(),
      displayFormat: 'Today',
    });
    const written = cellDateInput(pill, new Date(2026, 9, 24));
    expect(cellDateMention(written)).toEqual({
      type: 'date',
      date: new Date(2026, 9, 24).toISOString(),
      displayFormat: '',
    });
    expect(cellPlainText(written)).toBe('Oct 24, 2026');
  });
});
