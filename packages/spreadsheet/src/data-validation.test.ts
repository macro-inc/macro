import { describe, expect, it } from 'vitest';
import {
  dropdownRule,
  literalListItems,
  overlappingValidations,
  replaceValidations,
  validationReference,
} from './data-validation';
import type { DataValidation } from './sheet-rules';

const list = (range: string, formula = '"a,b"'): DataValidation => ({
  range,
  type: 'list',
  formulas: [formula],
});

describe('dropdown rules', () => {
  it('stores typed choices as a quoted Excel list and ranges as absolute references', () => {
    expect(dropdownRule({ items: [' Yes ', 'No', 'Yes', 'Say "hi"'] })).toEqual(
      {
        type: 'list',
        formulas: ['"Yes,No,Say ""hi"""'],
        allowBlank: true,
        showError: true,
        errorStyle: 'stop',
      }
    );
    expect(
      literalListItems(dropdownRule({ items: ['Say "hi"', 'b'] }).formulas![0])
    ).toEqual(['Say "hi"', 'b']);
    expect(
      dropdownRule({ range: "'Team list'!a2:b9", rejectInvalid: false })
    ).toEqual({
      type: 'list',
      formulas: ["'Team list'!$A$2:$B$9"],
      allowBlank: true,
    });
    expect(dropdownRule({ range: '$C$1' }).formulas).toEqual(['$C$1']);
    expect(() => dropdownRule({ range: 'B9:B2' })).toThrow('Invalid dropdown');
  });

  it('reads sheet-qualified references', () => {
    expect(validationReference("'It''s'!$A$1:$A$3")).toEqual({
      sheet: "It's",
      range: 'A1:A3',
    });
    expect(validationReference('A1')).toEqual({
      sheet: undefined,
      range: 'A1',
    });
    expect(validationReference('"a,b"')).toBeUndefined();
  });
});

describe('replacing validation ranges', () => {
  it('cuts a hole out of every overlapping rule and keeps the rest', () => {
    expect(
      replaceValidations([list('A1:C3'), list('E1 F1:F2')], 'B2', list('B2'))
    ).toEqual([
      list('A1:C1 A3:C3 A2 C2'),
      list('E1 F1:F2'),
      { ...list('B2'), range: 'B2' },
    ]);
  });

  it('drops rules the range covers completely and clears without a new rule', () => {
    expect(replaceValidations([list('B2:B4'), list('D1')], 'A1:C9')).toEqual([
      list('D1'),
    ]);
    expect(replaceValidations(undefined, 'A1')).toEqual([]);
  });

  it('finds the rules overlapping a range', () => {
    const rules = [list('A1:A5'), list('C1 C9'), list('E5')];
    expect(overlappingValidations(rules, 'A5:C5')).toEqual([rules[0]]);
    expect(overlappingValidations(rules, 'C9:E9')).toEqual([rules[1]]);
  });
});
