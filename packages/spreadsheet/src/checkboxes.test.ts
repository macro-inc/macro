import { describe, expect, it } from 'vitest';
import {
  checkboxChecked,
  deleteCellEdits,
  insertCheckboxEdits,
  toggleCheckboxEdits,
} from './checkboxes';

const range = (top: number, left: number, bottom = top, right = left) => ({
  anchor: { row: top, column: left },
  focus: { row: bottom, column: right },
});

describe('checkboxes', () => {
  it('reads TRUE as checked, FALSE and blank as unchecked, and other text as text', () => {
    expect(checkboxChecked('TRUE')).toBe(true);
    expect(checkboxChecked('true')).toBe(true);
    expect(checkboxChecked('FALSE')).toBe(false);
    expect(checkboxChecked('')).toBe(false);
    expect(checkboxChecked('Done')).toBeUndefined();
    expect(checkboxChecked('#REF!')).toBeUndefined();
  });

  it('inserts unchecked FALSE boxes into blank cells and keeps existing values', () => {
    expect(
      insertCheckboxEdits(
        { A2: { value: 'TRUE' }, A3: { value: 'Notes', bold: true } },
        range(0, 0, 2, 0)
      )
    ).toEqual({
      A1: { checkbox: true, value: 'FALSE' },
      A2: { checkbox: true },
      A3: { checkbox: true },
    });
  });

  it('checks every box unless all are already checked, leaving formulas alone', () => {
    const cells = {
      A1: { value: 'TRUE', checkbox: true },
      A2: { value: 'FALSE', checkbox: true },
      A3: { value: '', checkbox: true },
      A4: { value: '=B4>1', checkbox: true },
      A5: { value: 'TRUE' },
    };
    expect(toggleCheckboxEdits(cells, range(0, 0, 4, 0))).toEqual({
      A1: { value: 'TRUE' },
      A2: { value: 'TRUE' },
      A3: { value: 'TRUE' },
    });
    expect(toggleCheckboxEdits(cells, range(0, 0))).toEqual({
      A1: { value: 'FALSE' },
    });
    // A formula's box shows its result; there is nothing to toggle.
    expect(toggleCheckboxEdits(cells, range(3, 0))).toEqual({});
    expect(toggleCheckboxEdits(cells, range(4, 0))).toBeUndefined();
  });

  it('unchecks boxes on the first Delete and removes them on the next', () => {
    const cells = {
      A1: { value: 'TRUE', checkbox: true },
      A2: { value: 'FALSE', checkbox: true },
      B1: { value: 'Note' },
    };
    const selection = range(0, 0, 1, 1);
    expect(deleteCellEdits(cells, selection)).toEqual({
      A1: { value: 'FALSE' },
      A2: { value: 'FALSE' },
      B1: { value: '' },
      B2: { value: '' },
    });
    expect(
      deleteCellEdits(
        { ...cells, A1: { value: 'FALSE', checkbox: true } },
        selection
      )
    ).toEqual({
      A1: { value: '', checkbox: false },
      A2: { value: '', checkbox: false },
      B1: { value: '' },
      B2: { value: '' },
    });
  });
});
