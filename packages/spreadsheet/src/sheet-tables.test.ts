import { describe, expect, it } from 'vitest';
import {
  createTable,
  expandTables,
  type SheetTable,
  setTableTotalsRow,
  tableColumnNames,
  totalsFormula,
  totalsFunction,
} from './sheet-tables';
import type { SpreadsheetCells } from './spreadsheet-document';
import { convertTableToRange, renameTable } from './table-edits';
import { filterTable } from './table-filters';
import { parseWorkbookMetadata } from './workbook-metadata';

const sales: SpreadsheetCells = {
  A1: { value: 'Region' },
  B1: { value: 'Amount' },
  C1: { value: '' },
  D1: { value: 'Amount' },
  A2: { value: 'East' },
  B2: { value: '10' },
  A3: { value: 'West' },
  B3: { value: '20' },
};

describe('createTable', () => {
  it('names blank and repeated headers as Excel does and adds the table', () => {
    const change = createTable({
      metadata: { autoFilter: 'A1:D3', hiddenColumns: [9] },
      cells: sales,
      range: 'A1:D3',
      name: 'Sales',
      rowCount: 200,
    });
    expect(change.edits).toEqual({
      C1: { value: 'Column3' },
      D1: { value: 'Amount2' },
    });
    expect(change.metadata).toEqual({
      hiddenColumns: [9],
      tables: [
        {
          name: 'Sales',
          range: 'A1:D3',
          totalsRow: false,
          bandedRows: true,
          style: 'TableStyleMedium2',
        },
      ],
    });
  });

  it('takes the empty row below a header-only selection as its data row', () => {
    const change = createTable({
      metadata: undefined,
      cells: { A1: { value: 'Name' } },
      range: 'A1',
      name: 'People',
      rowCount: 200,
    });
    expect(change.metadata.tables?.[0].range).toBe('A1:A2');
  });

  it('writes a formula header as the text it shows', () => {
    const change = createTable({
      metadata: undefined,
      cells: { A1: { value: '="Q"&1' }, A2: { value: '5' } },
      range: 'A1:A2',
      name: 'Quarters',
      rowCount: 200,
      display: () => 'Q1',
    });
    expect(change.edits).toEqual({ A1: { value: 'Q1' } });
  });

  it('refuses ranges overlapping a table or a merge', () => {
    const metadata = createTable({
      metadata: undefined,
      cells: sales,
      range: 'A1:B3',
      name: 'Sales',
      rowCount: 200,
    }).metadata;
    expect(() =>
      createTable({
        metadata,
        cells: sales,
        range: 'B2:D4',
        name: 'Other',
        rowCount: 200,
      })
    ).toThrow('Tables cannot overlap');
    expect(() =>
      createTable({
        metadata: { merges: ['C2:D2'] },
        cells: sales,
        range: 'A1:D3',
        name: 'Merged',
        rowCount: 200,
      })
    ).toThrow('Unmerge');
  });
});

describe('total row', () => {
  const metadata = createTable({
    metadata: undefined,
    cells: sales,
    range: 'A1:B3',
    name: 'Sales',
    rowCount: 200,
  }).metadata;

  it('labels the first column and sums a numeric last column', () => {
    const change = setTableTotalsRow({
      metadata,
      cells: sales,
      name: 'Sales',
      totalsRow: true,
      rowCount: 200,
    });
    expect(change.edits).toEqual({
      A4: { value: 'Total' },
      B4: { value: '=SUBTOTAL(109,[Amount])' },
    });
    expect(change.metadata.tables?.[0]).toMatchObject({
      range: 'A1:B4',
      totalsRow: true,
    });
    const removed = setTableTotalsRow({
      metadata: change.metadata,
      cells: { ...sales, A4: { value: 'Total' }, B4: { value: '=1' } },
      name: 'Sales',
      totalsRow: false,
      rowCount: 200,
    });
    expect(removed.edits).toEqual({
      A4: { value: '' },
      B4: { value: '' },
    });
    expect(removed.metadata.tables?.[0].range).toBe('A1:B3');
  });

  it('needs an empty row below the table', () => {
    expect(() =>
      setTableTotalsRow({
        metadata,
        cells: { ...sales, B4: { value: 'notes' } },
        name: 'Sales',
        totalsRow: true,
        rowCount: 200,
      })
    ).toThrow('must be empty');
  });

  it('reads the aggregate back from its formula', () => {
    expect(totalsFormula('average', 'Unit [USD]')).toBe(
      "=SUBTOTAL(101,[Unit '[USD']])"
    );
    expect(totalsFunction("=SUBTOTAL(101,[Unit '[USD']])", 'Unit [USD]')).toBe(
      'average'
    );
    expect(
      totalsFunction('=SUBTOTAL(109,Sales[Amount])', 'Amount', 'Sales')
    ).toBe('sum');
    expect(totalsFunction('=SUBTOTAL(109,[Amount])', 'Region')).toBeUndefined();
    expect(totalsFunction('=SUM([Amount])', 'Amount')).toBeUndefined();
  });
});

describe('expandTables', () => {
  const table: SheetTable = {
    name: 'Sales',
    range: 'A1:B3',
    totalsRow: false,
    bandedRows: true,
  };

  it('grows down when a value is typed directly below', () => {
    expect(
      expandTables({
        metadata: { tables: [table] },
        cells: sales,
        edits: { B4: { value: '30' } },
      })
    ).toEqual({
      metadata: { tables: [{ ...table, range: 'A1:B4' }] },
      edits: {},
    });
  });

  it('grows right and names the new column', () => {
    expect(
      expandTables({
        metadata: { tables: [table] },
        cells: sales,
        edits: { C2: { value: 'x' } },
      })
    ).toEqual({
      metadata: { tables: [{ ...table, range: 'A1:C3' }] },
      edits: { C1: { value: 'Column3' } },
    });
  });

  it('ignores clears, several cells, corners and tables with a total row', () => {
    const grow = (edits: Record<string, { value: string }>, tables = [table]) =>
      expandTables({ metadata: { tables }, cells: sales, edits });
    expect(grow({ B4: { value: '' } })).toBeUndefined();
    expect(grow({ B4: { value: '1' }, A4: { value: 'x' } })).toBeUndefined();
    expect(grow({ C4: { value: '1' } })).toBeUndefined();
    expect(
      grow({ B5: { value: '1' } }, [
        { ...table, range: 'A1:B4', totalsRow: true },
      ])
    ).toBeUndefined();
  });
});

describe('filterTable', () => {
  const table: SheetTable = {
    name: 'Sales',
    range: 'A1:B5',
    totalsRow: true,
    bandedRows: true,
  };
  const shown: Record<string, string> = {
    A2: 'East',
    A3: 'West',
    A4: '',
    A5: 'Total',
  };
  const read = (row: number, column: number) => ({
    text: shown[`${String.fromCharCode(65 + column)}${row + 1}`] ?? '',
  });

  it('hides data rows the filter leaves out, never the total row', () => {
    const filtered = filterTable({
      metadata: { tables: [table], hiddenRows: [10] },
      name: 'Sales',
      filters: { 0: { values: ['east'] } },
      read,
    });
    expect(filtered.hiddenRows).toEqual([2, 3, 10]);
    expect(filtered.tables?.[0].filters).toEqual({ 0: { values: ['east'] } });
    const blanks = filterTable({
      metadata: filtered,
      name: 'Sales',
      filters: { 0: { values: ['West'], blanks: true } },
      read,
    });
    expect(blanks.hiddenRows).toEqual([1, 10]);
    const cleared = filterTable({
      metadata: blanks,
      name: 'Sales',
      filters: {},
      read,
    });
    expect(cleared.hiddenRows).toEqual([10]);
    expect(cleared.tables?.[0]).toEqual(table);
  });
});

describe('side-by-side tables', () => {
  const left: SheetTable = {
    name: 'Left',
    range: 'A1:B4',
    totalsRow: false,
    bandedRows: true,
  };
  const right: SheetTable = {
    name: 'Right',
    range: 'D1:E4',
    totalsRow: false,
    bandedRows: true,
    filters: { 0: { values: ['keep'] } },
  };
  const shown: Record<string, string> = {
    A2: 'a',
    A3: 'b',
    A4: 'c',
    D2: 'keep',
    D3: 'drop',
    D4: 'keep',
  };
  const read = (row: number, column: number) => ({
    text: shown[`${String.fromCharCode(65 + column)}${row + 1}`] ?? '',
  });

  it('keep rows the other table hides when one filters or stops being a table', () => {
    const metadata = { tables: [left, right], hiddenRows: [2] };
    expect(
      filterTable({
        metadata,
        name: 'Left',
        filters: { 0: { values: ['a', 'b'] } },
        read,
      }).hiddenRows
    ).toEqual([2, 3]);
    expect(
      filterTable({ metadata, name: 'Left', filters: {}, read }).hiddenRows
    ).toEqual([2]);
    const filtered = {
      tables: [{ ...left, filters: {} }, right],
      hiddenRows: [2],
    };
    expect(
      convertTableToRange(
        [{ id: 'sheet1', name: 'Data', cells: {}, metadata: filtered }],
        'sheet1',
        'Left'
      )[0].metadata?.hiddenRows
    ).toEqual([2]);
  });
});

describe('workbook table operations', () => {
  const sheets = [
    {
      id: 'sheet1',
      name: 'Data',
      cells: {
        ...sales,
        C1: { value: 'Double' },
        C2: { value: '=[@Amount]*2' },
        C3: { value: '=Sales[@Amount]*2' },
      },
      metadata: {
        tables: [
          {
            name: 'Sales',
            range: 'A1:C3',
            totalsRow: false,
            bandedRows: true,
            filters: { 0: { values: ['East'] } },
          },
        ],
        hiddenRows: [2, 7],
      },
    },
    {
      id: 'other',
      name: 'Summary',
      cells: {
        A1: { value: '=SUM(Sales[Amount])' },
        A2: { value: '="Sales[Amount]"&Sales[[#Headers],[Region]]' },
      },
    },
  ];

  it('renames a table and every reference to it', () => {
    expect(renameTable(sheets, 'sheet1', 'Sales', 'Revenue')).toEqual([
      {
        sheetId: 'sheet1',
        edits: { C3: { value: '=Revenue[@Amount]*2' } },
        metadata: {
          tables: [{ ...sheets[0].metadata.tables[0], name: 'Revenue' }],
          hiddenRows: [2, 7],
        },
      },
      {
        sheetId: 'other',
        edits: {
          A1: { value: '=SUM(Revenue[Amount])' },
          A2: { value: '="Sales[Amount]"&Revenue[[#Headers],[Region]]' },
        },
      },
    ]);
    expect(() => renameTable(sheets, 'sheet1', 'Sales', 'A1')).toThrow(
      'not a valid table name'
    );
  });

  it('turns formulas into cell ranges when the table becomes a range', () => {
    expect(convertTableToRange(sheets, 'sheet1', 'Sales')).toEqual([
      {
        sheetId: 'sheet1',
        edits: {
          C2: { value: '=$B2*2' },
          C3: { value: '=$B3*2' },
        },
        metadata: { hiddenRows: [7] },
      },
      {
        sheetId: 'other',
        edits: {
          A1: { value: '=SUM(Data!$B$2:$B$3)' },
          A2: { value: '="Sales[Amount]"&Data!$A$1' },
        },
      },
    ]);
  });

  it('reads column names from the header cells', () => {
    expect(
      tableColumnNames({ range: 'A1:C3' }, { A1: { value: "'2024" } })
    ).toEqual(['2024', 'Column2', 'Column3']);
  });
});

describe('table metadata', () => {
  const parse = (tables: unknown[]) =>
    parseWorkbookMetadata(JSON.stringify({ tables }));
  const table = {
    name: 'Sales',
    range: 'A1:C5',
    totalsRow: true,
    bandedRows: true,
    style: 'TableStyleMedium2',
    filters: { 2: { values: ['x'], blanks: true } },
  };

  it('keeps valid tables', () => {
    expect(parse([table])?.tables).toEqual([table]);
  });

  it('refuses invalid names, ranges, filters and repeated names', () => {
    expect(parse([{ ...table, name: 'B2' }])).toBeUndefined();
    expect(parse([{ ...table, name: 'Has space' }])).toBeUndefined();
    expect(parse([{ ...table, range: 'A1:C2' }])).toBeUndefined();
    expect(
      parse([{ ...table, filters: { 3: { values: [] } } }])
    ).toBeUndefined();
    expect(
      parse([table, { ...table, name: 'sales', range: 'E1:F3' }])
    ).toBeUndefined();
    expect(parse([{ ...table, extra: true }])).toBeUndefined();
  });
});
