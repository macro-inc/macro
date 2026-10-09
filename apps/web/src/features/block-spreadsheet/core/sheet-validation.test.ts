import type { DataValidation } from '@macro-inc/spreadsheet/sheet-rules';
import { describe, expect, it } from 'vitest';
import {
  dropdownOptions,
  listItems,
  type RangeValues,
  validateInput,
  validationAt,
} from './sheet-validation';

const sheets: Record<string, Record<string, string>> = {
  '': { H2: 'Open', H3: 'Done', H4: '', H5: 'Done', J1: '10' },
  Lists: { A1: 'North', A2: 'South' },
};
const values: RangeValues = (sheet, range) => {
  const cells = sheets[sheet ?? ''];
  if (!cells) return;
  const [start, end = start] = range.split(':');
  const column = start.replace(/\d+/, '');
  const from = Number(start.replace(/\D+/, ''));
  const to = Number(end.replace(/\D+/, ''));
  return Array.from({ length: to - from + 1 }, (_, i) => {
    const text = cells[`${column}${from + i}`] ?? '';
    return /^\d+$/.test(text) ? { text, number: Number(text) } : { text };
  });
};

const rule = (patch: Partial<DataValidation>): DataValidation => ({
  range: 'A1:A9',
  type: 'list',
  showError: true,
  ...patch,
});

describe('data validation', () => {
  it('finds the rule of a cell', () => {
    const rules = [rule({ range: 'B2 D4:D6' }), rule({ range: 'A1' })];
    expect(validationAt(rules, 'D5')).toBe(rules[0]);
    expect(validationAt(rules, 'A1')).toBe(rules[1]);
    expect(validationAt(rules, 'C3')).toBeUndefined();
  });

  it('describes a list rule for the dropdown dialog', () => {
    expect(dropdownOptions(rule({ formulas: ['"Open,Done"'] }))).toEqual({
      items: ['Open', 'Done'],
      rejectInvalid: true,
    });
    expect(
      dropdownOptions(
        rule({ formulas: ["'Lists'!$A$1:$A$2"], errorStyle: 'warning' })
      )
    ).toEqual({ range: "'Lists'!A1:A2", rejectInvalid: false });
    expect(
      dropdownOptions(rule({ type: 'whole', formulas: ['1'] }))
    ).toBeUndefined();
  });

  it('lists quoted items, ranges, other sheets and names', () => {
    expect(listItems(rule({ formulas: ['"Yes, No,Maybe"'] }), values)).toEqual([
      'Yes',
      'No',
      'Maybe',
    ]);
    expect(listItems(rule({ formulas: ['$H$2:$H$5'] }), values)).toEqual([
      'Open',
      'Done',
    ]);
    expect(listItems(rule({ formulas: ['Lists!$A$1:$A$2'] }), values)).toEqual([
      'North',
      'South',
    ]);
    expect(
      listItems(rule({ formulas: ['Regions'] }), values, [
        { name: 'Regions', formula: 'Lists!$A$1:$A$2' },
      ])
    ).toEqual(['North', 'South']);
    expect(
      listItems(rule({ formulas: ['INDIRECT($A$1)'] }), values)
    ).toBeUndefined();
  });

  it('checks typed values against lists, numbers, dates and text length', () => {
    const list = rule({ formulas: ['"Open,Done"'], error: 'Pick a status.' });
    expect(validateInput(list, 'done', values)).toEqual({ valid: true });
    expect(validateInput(list, 'Later', values)).toEqual({
      valid: false,
      style: 'stop',
      message: 'Pick a status.',
    });
    const whole = rule({
      type: 'whole',
      operator: 'between',
      formulas: ['1', '$J$1'],
      errorStyle: 'warning',
    });
    expect(validateInput(whole, '7', values).valid).toBe(true);
    expect(validateInput(whole, '7.5', values)).toMatchObject({
      valid: false,
      style: 'warning',
    });
    expect(validateInput(whole, '11', values).valid).toBe(false);
    const date = rule({
      type: 'date',
      operator: 'greaterThan',
      formulas: ['46000'],
    });
    expect(validateInput(date, '2026-07-23', values).valid).toBe(true);
    expect(validateInput(date, '1/1/2025', values).valid).toBe(false);
    const length = rule({
      type: 'textLength',
      operator: 'lessThanOrEqual',
      formulas: ['3'],
    });
    expect(validateInput(length, 'abcd', values).valid).toBe(false);
    const amount = rule({
      type: 'decimal',
      operator: 'lessThanOrEqual',
      formulas: ['0.5'],
    });
    expect(validateInput(amount, '50%', values).valid).toBe(true);
    expect(validateInput(amount, '$1,000.25', values).valid).toBe(false);
  });

  it('accepts clearing, formulas, silent rules and unknown lists', () => {
    const list = rule({ formulas: ['"Open,Done"'] });
    expect(validateInput(list, '', values).valid).toBe(true);
    expect(validateInput(list, '=A2', values).valid).toBe(true);
    expect(
      validateInput({ ...list, showError: false }, 'x', values).valid
    ).toBe(true);
    expect(
      validateInput(rule({ formulas: ['OFFSET(A1,0,0,3)'] }), 'x', values).valid
    ).toBe(true);
  });
});
