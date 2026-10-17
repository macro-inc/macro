import { describe, expect, it } from 'vitest';
import {
  currentRegion,
  resizeTable,
  type SheetTable,
  TABLE_TOTALS,
  totalsFormula,
  totalsFunction,
  validSheetTable,
} from './sheet-tables';
import type { SpreadsheetCells } from './spreadsheet-document';
import {
  hasThisRowReference,
  referencedTableNames,
  renameColumnReferences,
  renameTableReferences,
  resolveStructuredReferences,
  type WorkbookTable,
} from './structured-references';
import {
  calculatedColumnEdits,
  columnTypeMismatch,
  detectColumnTypes,
  newTableRow,
  setTableColumnType,
} from './table-columns';
import { tableEditChanges } from './table-edits';
import { conditionMatches, filterSummary, filterTable } from './table-filters';
import { groupTableRows, summarize } from './table-groups';
import { coloredTable, tableLookEdits } from './table-styles';

const table: SheetTable = {
  name: 'Sales',
  range: 'A1:C4',
  totalsRow: false,
  bandedRows: true,
};
const cells: SpreadsheetCells = {
  A1: { value: 'Item' },
  B1: { value: 'Qty' },
  C1: { value: 'Total' },
  A2: { value: 'Pens' },
  B2: { value: '2', format: 'currency' },
  C2: { value: '=[@Qty]*2' },
  A3: { value: 'Ink' },
  B3: { value: '3', format: 'currency' },
  C3: { value: '=[@Qty]*2' },
  A4: { value: 'Pads' },
  B4: { value: '5', format: 'currency' },
  C4: { value: '=[@Qty]*2' },
};

describe('table model', () => {
  it('validates ids, colors, column types and condition filters', () => {
    expect(
      validSheetTable({
        ...table,
        id: 'a-1',
        color: '#d93025',
        columnTypes: { 0: 'text', 2: 'number' },
        filters: {
          1: { condition: { operator: 'between', value: '1', value2: '4' } },
        },
      })
    ).toBe(true);
    expect(validSheetTable({ ...table, columnTypes: { 3: 'text' } })).toBe(
      false
    );
    expect(validSheetTable({ ...table, columnTypes: { 0: 'money' } })).toBe(
      false
    );
    expect(validSheetTable({ ...table, color: 'red' })).toBe(false);
    expect(
      validSheetTable({
        ...table,
        filters: { 0: { condition: { operator: 'like', value: 'x' } } },
      })
    ).toBe(false);
    expect(validSheetTable({ ...table, filters: { 0: {} } })).toBe(false);
  });

  it('finds the block of filled cells around a cell', () => {
    const block = { ...cells, E7: { value: 'far' } };
    expect(
      currentRegion(
        block,
        { top: 2, left: 1, bottom: 2, right: 1 },
        { rows: 100, columns: 26 }
      )
    ).toEqual({ top: 0, left: 0, bottom: 3, right: 2 });
  });

  it('writes and reads back every footer aggregate', () => {
    for (const aggregate of TABLE_TOTALS)
      expect(
        totalsFunction(
          totalsFormula(aggregate, 'Unit price').replace('[', 'Sales['),
          'Unit price',
          'Sales'
        )
      ).toBe(aggregate);
    expect(totalsFormula('empty', 'Qty')).toBe('=COUNTBLANK([Qty])');
  });

  it('resizes a table, naming new headers and moving column settings', () => {
    const change = resizeTable({
      metadata: {
        tables: [
          {
            ...table,
            filters: { 1: { values: ['3'] } },
            columnTypes: { 0: 'text', 1: 'currency' },
          },
        ],
      },
      cells,
      name: 'Sales',
      range: 'B1:D4',
    });
    expect(change.metadata.tables?.[0]).toMatchObject({
      range: 'B1:D4',
      filters: { 0: { values: ['3'] } },
      columnTypes: { 0: 'currency' },
    });
    expect(change.edits).toEqual({ D1: { value: 'Column3' } });
    expect(() =>
      resizeTable({
        metadata: { tables: [table] },
        cells,
        name: 'Sales',
        range: 'A1:C1',
      })
    ).toThrow('at least one data row');
  });

  it('colors a table with an Excel style, keeping colors Excel lacks', () => {
    expect(coloredTable(table, '#70ad47')).toEqual({
      ...table,
      style: 'TableStyleMedium7',
    });
    expect(coloredTable({ ...table, color: '#d93025' }, '#8e24aa')).toEqual({
      ...table,
      style: 'TableStyleMedium2',
      color: '#8e24aa',
    });
  });

  it('draws a table look into cells that have no formatting of their own', () => {
    const edits = tableLookEdits(
      { ...table, style: 'TableStyleMedium2', totalsRow: true },
      { ...cells, A2: { value: 'Pens', fillColor: '#ffff00' } }
    );
    expect(edits.A1).toEqual({
      fillColor: '#4472c4',
      textColor: '#ffffff',
      bold: true,
    });
    expect(edits.A2).toBeUndefined();
    expect(edits.B2).toEqual({ fillColor: '#dae3f3' });
    expect(edits.A4).toMatchObject({
      bold: true,
      borderTop: true,
      borderTopStyle: 'double',
    });
  });
});

describe('structured references', () => {
  const layouts: WorkbookTable[] = [
    {
      name: 'Sales',
      sheet: 'Data',
      top: 0,
      left: 0,
      bottom: 3,
      right: 2,
      headerRows: 1,
      totalsRows: 0,
      columns: ['Item', 'Qty', 'Total'],
    },
  ];

  it('reads a bare table name as its data, but not a sheet name or function', () => {
    expect(
      resolveStructuredReferences(
        '=SUM(Sales)+Sales!A1+SALES(1)',
        layouts,
        'Data',
        10,
        0
      )
    ).toBe('=SUM($A$2:$C$4)+Sales!A1+SALES(1)');
    expect(renameTableReferences('=ROWS(Sales)', 'Sales', 'Orders')).toBe(
      '=ROWS(Orders)'
    );
    expect([...referencedTableNames('=ROWS(sales)', ['Sales'])]).toEqual([
      'sales',
    ]);
  });

  it('renames a column in references to its table only', () => {
    const rename = { table: 'Sales', from: 'Qty', to: 'Unit count' };
    expect(
      renameColumnReferences(
        '=[@Qty]+Sales[Qty]+Sales[[#Headers],[Qty]:[Total]]+Other[Qty]',
        layouts,
        'Data',
        1,
        2,
        rename
      )
    ).toBe(
      '=[@[Unit count]]+Sales[Unit count]+Sales[[#Headers],[Unit count]:[Total]]+Other[Qty]'
    );
  });

  it('knows formulas that refer to their own row', () => {
    expect(hasThisRowReference('=[@Qty]*2')).toBe(true);
    expect(hasThisRowReference('=Sales[[#This Row],[Qty]]')).toBe(true);
    expect(hasThisRowReference('=SUM(Sales[Qty])')).toBe(false);
  });
});

describe('column types', () => {
  it('suggests types every value of a column fits', () => {
    expect(
      detectColumnTypes(table, {
        ...cells,
        C2: { value: 'TRUE', checkbox: true },
        C3: { value: 'FALSE', checkbox: true },
        C4: { value: '', checkbox: true },
      })
    ).toEqual({ 0: 'text', 1: 'currency', 2: 'checkbox' });
  });

  it('flags values that do not fit a column type', () => {
    const value = (display: string, number?: number) => ({ display, number });
    expect(columnTypeMismatch('number', { value: 'abc' }, value('abc'))).toBe(
      'Expected a number'
    );
    expect(columnTypeMismatch('number', { value: '=1' }, value('1', 1))).toBe(
      undefined
    );
    expect(
      columnTypeMismatch('dropdown', { value: 'Maybe' }, undefined, ['Yes'])
    ).toBe('Expected one of the dropdown’s options');
    expect(columnTypeMismatch('checkbox', { value: 'yes' }, undefined)).toBe(
      'Expected a checkbox: TRUE or FALSE'
    );
    expect(
      columnTypeMismatch(
        'person',
        {
          value:
            '<m-user-mention>{"userId":"u1","email":"ada@example.com"}</m-user-mention>',
        },
        undefined
      )
    ).toBeUndefined();
    expect(columnTypeMismatch('person', { value: 'Ada' }, undefined)).toBe(
      'Expected a person: type @ to mention someone'
    );
    expect(columnTypeMismatch('date', { value: '' }, undefined)).toBe(
      undefined
    );
  });

  it('turns a column into checkboxes and back', () => {
    const metadata = { tables: [table] };
    const change = setTableColumnType({
      metadata,
      cells: { ...cells, A3: { value: '' } },
      name: 'Sales',
      column: 0,
      type: 'checkbox',
      display: () => '',
    });
    expect(change.metadata.tables?.[0].columnTypes).toEqual({ 0: 'checkbox' });
    expect(change.edits.A3).toEqual({
      format: 'general',
      numberFormat: '',
      checkbox: true,
      value: 'FALSE',
    });
    const back = setTableColumnType({
      metadata: change.metadata,
      cells: { ...cells, A2: { value: 'TRUE', checkbox: true } },
      name: 'Sales',
      column: 0,
      type: undefined,
      display: () => '',
    });
    expect(back.edits.A2).toEqual({ checkbox: false });
    expect(back.metadata.tables?.[0].columnTypes).toBeUndefined();
  });

  it('gives a new row the formats, lists and calculated formulas above it', () => {
    const grown = { ...table, range: 'A1:C5' };
    const row = newTableRow({
      metadata: {
        tables: [grown],
        validations: [{ range: 'A2:A4', type: 'list', formulas: ['"a,b"'] }],
      },
      table: grown,
      cells,
      row: 4,
      edits: { A5: { value: 'Tape' } },
    });
    expect(row.edits).toEqual({
      A5: { value: 'Tape' },
      B5: { format: 'currency' },
      C5: { value: '=[@Qty]*2' },
    });
    expect(row.validations).toEqual([
      { range: 'A2:A5', type: 'list', formulas: ['"a,b"'] },
    ]);
  });

  it('fills an empty column with a formula that refers to its own row', () => {
    const empty = { ...cells };
    delete empty.C2;
    delete empty.C3;
    delete empty.C4;
    expect(
      calculatedColumnEdits([table], empty, { C3: { value: '=[@Qty]*3' } })
    ).toEqual({ C2: { value: '=[@Qty]*3' }, C4: { value: '=[@Qty]*3' } });
    expect(
      calculatedColumnEdits([table], cells, { C3: { value: '=[@Qty]*3' } })
    ).toBeUndefined();
    expect(
      calculatedColumnEdits([table], empty, { C3: { value: '=B3*3' } })
    ).toBeUndefined();
  });
});

describe('cell edits on tables', () => {
  const sheets = [
    { id: 'data', name: 'Data', cells, metadata: { tables: [table] } },
    {
      id: 'summary',
      name: 'Summary',
      cells: { A1: { value: '=SUM(Sales[Qty])' } },
    },
  ];

  it('renames a column everywhere when its header changes', () => {
    expect(
      tableEditChanges(sheets, 'data', { B1: { value: 'Count' } })
    ).toEqual([
      {
        sheetId: 'data',
        edits: {
          B1: { value: 'Count' },
          C2: { value: '=[@Count]*2' },
          C3: { value: '=[@Count]*2' },
          C4: { value: '=[@Count]*2' },
        },
      },
      { sheetId: 'summary', edits: { A1: { value: '=SUM(Sales[Count])' } } },
    ]);
  });

  it('names a cleared or repeated header as Excel does', () => {
    const [own] =
      tableEditChanges(sheets, 'data', { B1: { value: 'Item' } }) ?? [];
    expect(own.edits.B1).toEqual({ value: 'Item2' });
    expect(own.edits.C2).toEqual({ value: '=[@Item2]*2' });
  });

  it('grows a table by a row typed below it, filling the new row', () => {
    const [own] =
      tableEditChanges(sheets, 'data', { A5: { value: 'Tape' } }) ?? [];
    expect(own.metadata?.tables?.[0].range).toBe('A1:C5');
    expect(own.edits).toEqual({
      A5: { value: 'Tape' },
      B5: { format: 'currency' },
      C5: { value: '=[@Qty]*2' },
    });
  });

  it('leaves edits that touch no table alone', () => {
    expect(
      tableEditChanges(sheets, 'data', { F9: { value: 'x' } })
    ).toBeUndefined();
    expect(
      tableEditChanges(sheets, 'summary', { A2: { value: 'x' } })
    ).toBeUndefined();
  });
});

describe('filters and groups', () => {
  it('tests text, number, date and range conditions', () => {
    const cell = (text: string, number?: number) => ({ text, number });
    expect(
      conditionMatches({ operator: 'contains', value: 'EN' }, cell('Pens'))
    ).toBe(true);
    expect(
      conditionMatches({ operator: 'greaterThan', value: '5' }, cell('7', 7))
    ).toBe(true);
    expect(
      conditionMatches({ operator: 'greaterThan', value: '5' }, cell('n/a'))
    ).toBe(false);
    expect(
      conditionMatches(
        { operator: 'between', value: '2026-01-01', value2: '2026-01-31' },
        cell('Jan 15, 2026', 46037)
      )
    ).toBe(true);
    expect(
      conditionMatches(
        { operator: 'notBetween', value: '1', value2: '3' },
        cell('2', 2)
      )
    ).toBe(false);
    expect(conditionMatches({ operator: 'empty' }, cell(' '))).toBe(true);
    expect(
      conditionMatches({ operator: 'equal', value: 'pens' }, cell('Pens'))
    ).toBe(true);
  });

  it('combines a condition with values', () => {
    const shown: Record<string, string> = { B2: '2', B3: '3', B4: '5' };
    const metadata = filterTable({
      metadata: { tables: [table] },
      name: 'Sales',
      filters: {
        1: {
          values: ['2', '5'],
          condition: { operator: 'greaterThan', value: '3' },
        },
      },
      read: (row, column) => ({
        text: shown[`${String.fromCharCode(65 + column)}${row + 1}`] ?? '',
      }),
    });
    expect(metadata.hiddenRows).toEqual([1, 2]);
  });

  it('groups rows and summarizes them as Google Sheets does', () => {
    const read = (row: number) => ({
      text: ['', 'East', 'west', 'East', ''][row] ?? '',
    });
    expect(
      groupTableRows({ table: { ...table, range: 'A1:C5' }, column: 0, read })
    ).toEqual([
      { value: 'East', rows: [1, 3] },
      { value: 'west', rows: [2] },
      { value: '', rows: [4] },
    ]);
    const cellsOf = [
      { text: '2', number: 2 },
      { text: '' },
      { text: '2', number: 2 },
      { text: 'x' },
    ];
    expect(summarize(cellsOf, 'sum')).toBe(4);
    expect(summarize(cellsOf, 'unique')).toBe(2);
    expect(summarize(cellsOf, 'percentEmpty')).toBe(0.25);
    expect(summarize([{ text: 'a' }], 'average')).toBeUndefined();
  });
});

describe('filter summaries', () => {
  it('describes values and conditions as the column menu shows them', () => {
    expect(filterSummary({ values: ['a'] })).toBe('1 value');
    expect(filterSummary({ values: ['a'], blanks: true })).toBe('2 values');
    expect(
      filterSummary({
        condition: { operator: 'between', value: '1', value2: '5' },
      })
    ).toBe('Is between 1 and 5');
    expect(filterSummary({ condition: { operator: 'notEmpty' } })).toBe(
      'Is not empty'
    );
  });
});
