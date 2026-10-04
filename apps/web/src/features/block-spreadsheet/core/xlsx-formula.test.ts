import { describe, expect, it } from 'vitest';
import {
  addFunctionPrefixes,
  expandSheetRanges,
  exportImplicitIntersections,
  formulaFunctionNames,
  hasExternalReference,
  importSingleFunction,
  markImplicitIntersections,
  normalizeReferences,
  resolveStructuredReferences,
  stripFunctionPrefixes,
  translateFormula,
  type WorkbookTable,
} from './xlsx-formula';

describe('translateFormula', () => {
  it('shifts relative references and keeps absolute parts', () => {
    expect(translateFormula('A1+$B$2+C$3+$D4', 2, 1)).toBe('B3+$B$2+D$3+$D6');
    expect(translateFormula('SUM(A:B)+SUM(1:2)', 1, 1)).toBe(
      'SUM(B:C)+SUM(2:3)'
    );
  });

  it('never changes strings, quoted sheet names or function names', () => {
    expect(translateFormula(`"A1"&'A1 sheet'!A1&LOG10(A1)`, 1, 0)).toBe(
      `"A1"&'A1 sheet'!A2&LOG10(A2)`
    );
  });

  it('turns references moved off the sheet into #REF!', () => {
    expect(translateFormula('A1+B2', -1, 0)).toBe('#REF!+B1');
  });
});

describe('function prefixes', () => {
  it('strips and restores Excel compatibility prefixes', () => {
    expect(
      stripFunctionPrefixes('_xlfn.XLOOKUP(A1,B:B,C:C)+_xlfn._xlws.SORT(D1:D3)')
    ).toBe('XLOOKUP(A1,B:B,C:C)+SORT(D1:D3)');
    expect(addFunctionPrefixes('XLOOKUP(A1,B:B,C:C)+SORT(D1:D3)+SUM(1)')).toBe(
      '_xlfn.XLOOKUP(A1,B:B,C:C)+_xlfn._xlws.SORT(D1:D3)+SUM(1)'
    );
    expect(formulaFunctionNames('_xlfn.IFS(A1,1)+if(B1,"SUM(",2)')).toEqual([
      'IFS',
      'IF',
    ]);
  });
});

describe('external and structured references', () => {
  it('finds references into other workbooks', () => {
    expect(hasExternalReference('[1]Sheet1!A1+1')).toBe(true);
    expect(hasExternalReference("'[2]Q1 data'!B2")).toBe(true);
    expect(hasExternalReference('Table1[[#This Row],[Qty]]')).toBe(false);
  });

  it('converts table references to A1 ranges', () => {
    const table: WorkbookTable = {
      name: 'Sales',
      sheet: 'Data',
      top: 1,
      left: 1,
      bottom: 6,
      right: 3,
      headerRows: 1,
      totalsRows: 1,
      columns: ['Region', 'Qty', 'Price'],
    };
    const resolve = (formula: string, row = 3) =>
      resolveStructuredReferences(formula, [table], 'Data', row, 4);
    expect(resolve('SUM(Sales[Qty])')).toBe('SUM($C$3:$C$6)');
    expect(resolve('Sales[[#Totals],[Price]]')).toBe('$D$7');
    expect(resolve('Sales[[#All],[Region]:[Qty]]')).toBe('$B$2:$C$7');
    expect(resolve('[@Qty]*[@Price]')).toBeUndefined();
    expect(
      resolveStructuredReferences('[@Qty]*[@Price]', [table], 'Data', 3, 2)
    ).toBe('$C4*$D4');
    expect(
      resolveStructuredReferences('Sales[Qty]', [table], 'Other', 0, 0)
    ).toBe('Data!$C$3:$C$6');
  });
});

describe('normalizeReferences', () => {
  it('drops a repeated sheet name inside a range and a deleted sheet reference', () => {
    expect(normalizeReferences("SUM(TBA!$D$10:'TBA'!D10)")).toBe(
      'SUM(TBA!$D$10:D10)'
    );
    expect(normalizeReferences("'My data'!A1:'my data'!B2")).toBe(
      "'My data'!A1:B2"
    );
    expect(normalizeReferences("(A1+B1)/'Financial Model'!#REF!")).toBe(
      '(A1+B1)/#REF!'
    );
  });

  it('keeps ranges between different sheets and quoted text', () => {
    for (const formula of [
      'Data!A1:Other!B2',
      '"Data!A1:Data!B2"',
      'Data!A1:B2',
    ])
      expect(normalizeReferences(formula)).toBe(formula);
  });
});

describe('expandSheetRanges', () => {
  const sheets = ['Summary', '1st Q', '2nd Q', '3rd Q', 'Notes'];

  it('lists each sheet of a 3-D reference in tab order', () => {
    expect(expandSheetRanges("SUM('1st Q:3rd Q'!D7)", sheets)).toBe(
      "SUM('1st Q'!D7,'2nd Q'!D7,'3rd Q'!D7)"
    );
    expect(
      expandSheetRanges('AVERAGE(Summary:Notes!$A$1:$B$2, 5)', sheets)
    ).toBe(
      "AVERAGE(Summary!$A$1:$B$2,'1st Q'!$A$1:$B$2,'2nd Q'!$A$1:$B$2,'3rd Q'!$A$1:$B$2,Notes!$A$1:$B$2, 5)"
    );
  });

  it('leaves ordinary ranges and unknown sheets alone', () => {
    expect(expandSheetRanges("SUM('1st Q'!A1:B2)", sheets)).toBe(
      "SUM('1st Q'!A1:B2)"
    );
    expect(expandSheetRanges("SUM('Jan:Dec'!A1)", sheets)).toBe(
      "SUM('Jan:Dec'!A1)"
    );
  });
});

describe('implicit intersection', () => {
  const names = new Set(['revenue']);
  const mark = (formula: string) => markImplicitIntersections(formula, names);

  it('marks ranges that Excel reads as one value', () => {
    expect(mark('Table!$B$2:$B$7')).toBe('@Table!$B$2:$B$7');
    expect(mark('N:N')).toBe('@N:N');
    expect(mark('-A1:A9*2')).toBe('-@A1:A9*2');
    expect(mark('EXP(H:H)+SIGN(H:H)')).toBe('EXP(@H:H)+SIGN(@H:H)');
    expect(mark('IF(A1:A3>0,B1:B3,0)')).toBe('IF(@A1:A3>0,B1:B3,0)');
    expect(mark('Revenue*0.2')).toBe('@Revenue*0.2');
    expect(mark("CHOOSE(A25:A27,A4,'My data'!A5:A6)")).toBe(
      "CHOOSE(@A25:A27,A4,'My data'!A5:A6)"
    );
  });

  it('keeps ranges where Excel passes or evaluates them whole', () => {
    for (const formula of [
      'SUM(A1:A9)',
      'SUMPRODUCT((A1:A9>0)*B1:B9)',
      'VLOOKUP(A1,Data!$A:$D,2,FALSE)',
      'INDEX(A1:C9,2,3)',
      'LOOKUP(2,1/(A:A<>""),A:A)',
      'SUM((A1:A3))',
      'SUM((A1:A3,C1:C3))',
      'SUM(A1:A3 B1:B5)',
      'XLOOKUP(1,A1:A3,B1:B3)',
      '{1,2;3,4}',
      'A1:A1',
      'LOG10(A1)',
      'SUM(Revenue)',
    ])
      expect(mark(formula)).toBe(formula);
  });

  it('writes @ implicitly where Excel intersects and as SINGLE elsewhere', () => {
    expect(exportImplicitIntersections('@A1:A9*2', names, true)).toBe(
      'A1:A9*2'
    );
    expect(exportImplicitIntersections("@'My data'!B:B", names, true)).toBe(
      "'My data'!B:B"
    );
    expect(exportImplicitIntersections('SUM(@A1:A9)', names, true)).toBe(
      'SUM(_xlfn.SINGLE(A1:A9))'
    );
    expect(exportImplicitIntersections('@A1:A9*2', names, false)).toBe(
      '_xlfn.SINGLE(A1:A9)*2'
    );
    expect(
      exportImplicitIntersections('@INDEX(A:A,2)+@Revenue', names, false)
    ).toBe('_xlfn.SINGLE(INDEX(A:A,2))+_xlfn.SINGLE(Revenue)');
    expect(exportImplicitIntersections('"@"&A1', names, true)).toBe('"@"&A1');
  });

  it('reads SINGLE back as @', () => {
    expect(importSingleFunction('_xlfn.SINGLE(A1:A9)*2')).toBe('@A1:A9*2');
    expect(importSingleFunction("SUM(_xlfn.SINGLE('My data'!B:B))")).toBe(
      "SUM(@'My data'!B:B)"
    );
    expect(importSingleFunction('_xlfn.SINGLE(INDEX(A:A,2))')).toBe(
      '@(INDEX(A:A,2))'
    );
  });
});
