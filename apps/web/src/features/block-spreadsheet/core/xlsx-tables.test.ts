import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { WorkbookFileSheet } from './workbook-file-types';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';

const orders: WorkbookFileSheet = {
  name: 'Sales',
  cells: {
    A1: { value: 'Region' },
    B1: { value: 'Qty' },
    C1: { value: 'Unit Price' },
    D1: { value: 'Amount' },
    A2: { value: 'East' },
    B2: { value: '2' },
    C2: { value: '5' },
    D2: { value: '=[@Qty]*[@[Unit Price]]' },
    A3: { value: 'West' },
    B3: { value: '3' },
    C3: { value: '4' },
    D3: { value: '=[@Qty]*[@[Unit Price]]' },
    A4: { value: 'Total' },
    B4: { value: '=SUBTOTAL(101,[Qty])' },
    C4: { value: '=MAX([Unit Price])*2' },
    D4: { value: '=SUBTOTAL(109,[Amount])' },
    F1: { value: '=SUM(Orders[Amount])' },
  },
  rowCount: 200,
  columnWidths: {},
  metadata: {
    tables: [
      {
        name: 'Orders',
        range: 'A1:D4',
        totalsRow: true,
        bandedRows: true,
        style: 'TableStyleLight9',
        filters: { 0: { values: ['East'] } },
      },
    ],
    hiddenRows: [2],
  },
};

describe('Excel tables', () => {
  it('export a table part Excel reads and import it back unchanged', async () => {
    const exported = await encodeXlsx({ sheets: [orders] });
    const files = unzipSync(exported.bytes);
    const part = strFromU8(files['xl/tables/table1.xml']);
    expect(part).toContain(
      'id="1" name="Orders" displayName="Orders" ref="A1:D4" totalsRowCount="1"'
    );
    expect(part).toContain(
      '<autoFilter ref="A1:D3"><filterColumn colId="0"><filters><filter val="East"/></filters></filterColumn></autoFilter>'
    );
    expect(part).toContain(
      '<tableColumns count="4"><tableColumn id="1" name="Region" totalsRowLabel="Total"/><tableColumn id="2" name="Qty" totalsRowFunction="average"/><tableColumn id="3" name="Unit Price" totalsRowFunction="custom"><totalsRowFormula>MAX(Orders[Unit Price])*2</totalsRowFormula></tableColumn><tableColumn id="4" name="Amount" totalsRowFunction="sum"/></tableColumns>'
    );
    expect(part).toContain(
      '<tableStyleInfo name="TableStyleLight9" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>'
    );
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain(
      '<f>Orders[[#This Row],[Qty]]*Orders[[#This Row],[Unit Price]]</f>'
    );
    expect(sheet).toContain('<f>SUBTOTAL(109,Orders[Amount])</f>');
    expect(sheet).toContain('<row r="3" hidden="1">');
    expect(sheet).toContain(
      '<tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>'
    );
    expect(strFromU8(files['xl/worksheets/_rels/sheet1.xml.rels'])).toContain(
      'relationships/table" Target="../tables/table1.xml"'
    );
    expect(strFromU8(files['[Content_Types].xml'])).toContain(
      '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>'
    );

    const imported = await decodeXlsx(exported.bytes);
    const [sales] = imported.sheets;
    expect(sales.metadata?.tables).toEqual(orders.metadata?.tables);
    expect(sales.metadata?.hiddenRows).toEqual([2]);
    for (const address of ['D2', 'D3', 'B4', 'C4', 'D4', 'F1'])
      expect(sales.cells[address].value).toBe(orders.cells[address].value);
    expect(imported.warnings.join(' ')).not.toMatch(/table/i);
  });

  it('export condition filters and custom footer aggregates as Excel writes them', async () => {
    const conditions = [
      [
        { operator: 'greaterThan', value: '2' },
        '<customFilters><customFilter operator="greaterThan" val="2"/></customFilters>',
      ],
      [
        { operator: 'contains', value: 'a*' },
        '<customFilters><customFilter val="*a~**"/></customFilters>',
      ],
      [
        { operator: 'startsWith', value: 'E' },
        '<customFilters><customFilter val="E*"/></customFilters>',
      ],
      [
        { operator: 'notContains', value: 'x' },
        '<customFilters><customFilter operator="notEqual" val="*x*"/></customFilters>',
      ],
      [
        { operator: 'notEmpty' },
        '<customFilters><customFilter operator="notEqual" val=" "/></customFilters>',
      ],
      [
        { operator: 'between', value: '1', value2: '4' },
        '<customFilters and="1"><customFilter operator="greaterThanOrEqual" val="1"/><customFilter operator="lessThanOrEqual" val="4"/></customFilters>',
      ],
      [
        { operator: 'notBetween', value: '1', value2: '4' },
        '<customFilters><customFilter operator="lessThan" val="1"/><customFilter operator="greaterThan" val="4"/></customFilters>',
      ],
    ] as const;
    for (const [condition, xml] of conditions) {
      const [table] = orders.metadata?.tables ?? [];
      const sheet: WorkbookFileSheet = {
        ...orders,
        cells: { ...orders.cells, B4: { value: '=COUNTBLANK([Qty])' } },
        metadata: {
          ...orders.metadata,
          tables: [{ ...table, filters: { 1: { condition } } }],
        },
      };
      const exported = await encodeXlsx({ sheets: [sheet] });
      const part = strFromU8(unzipSync(exported.bytes)['xl/tables/table1.xml']);
      expect(part).toContain(`<filterColumn colId="1">${xml}</filterColumn>`);
      expect(part).toContain(
        '<tableColumn id="2" name="Qty" totalsRowFunction="custom"><totalsRowFormula>COUNTBLANK(Orders[Qty])</totalsRowFormula></tableColumn>'
      );
      const imported = await decodeXlsx(exported.bytes);
      expect(imported.sheets[0].metadata?.tables?.[0].filters).toEqual({
        1: { condition },
      });
      expect(imported.warnings.join(' ')).not.toMatch(/table/i);
    }
  });

  it('write line breaks in column names as Excel does so they match their headers', async () => {
    const sheet: WorkbookFileSheet = {
      name: 'Prices',
      cells: {
        A1: { value: 'Unit\nPrice' },
        B1: { value: 'Code_x0041_' },
        A2: { value: '4' },
        B2: { value: 'x' },
      },
      rowCount: 200,
      columnWidths: {},
      metadata: {
        tables: [
          {
            name: 'Prices',
            range: 'A1:B2',
            totalsRow: false,
            bandedRows: true,
            filters: { 0: { values: ['4\t'] } },
          },
        ],
      },
    };
    const bytes = (await encodeXlsx({ sheets: [sheet] })).bytes;
    const part = strFromU8(unzipSync(bytes)['xl/tables/table1.xml']);
    expect(part).toContain('name="Unit_x000A_Price"');
    expect(part).toContain('name="Code_x005F_x0041_"');
    expect(part).toContain('<filter val="4_x0009_"/>');
    const [imported] = (await decodeXlsx(bytes)).sheets;
    expect(imported.metadata?.tables).toEqual(sheet.metadata?.tables);
  });

  it('turn tables without a header row into cells and their references into ranges', async () => {
    const files = unzipSync((await encodeXlsx({ sheets: [orders] })).bytes);
    files['xl/tables/table1.xml'] = strToU8(
      strFromU8(files['xl/tables/table1.xml']).replace(
        'ref="A1:D4"',
        'ref="A1:D4" headerRowCount="0"'
      )
    );
    const imported = await decodeXlsx(zipSync(files));
    const [sales] = imported.sheets;
    expect(sales.metadata?.tables).toBeUndefined();
    expect(sales.cells.D2.value).toBe('=$B2*$C2');
    expect(sales.cells.F1.value).toBe('=SUM($D$1:$D$3)');
    expect(imported.warnings).toContain(
      'Excel tables without a header row, or beyond Macro’s sheet size or table limit, are imported as ordinary cells; formulas refer to their cell ranges.'
    );
  });
});
