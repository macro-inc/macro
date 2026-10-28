import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInitializedSpreadsheetCalculator,
  type SpreadsheetCalculator,
} from './calculation';
import { pivotLayout, sheetPivotLayouts } from './pivot-layout';
import type { SpreadsheetCells } from './spreadsheet-document';
import type { SheetPivotTable } from './workbook-metadata';

let calculator: SpreadsheetCalculator;
beforeAll(() => {
  initSync({
    module: readFileSync(
      createRequire(import.meta.url).resolve('@ironcalc/wasm/wasm_bg.wasm')
    ),
  });
  calculator = createInitializedSpreadsheetCalculator();
});
afterAll(() => calculator.dispose());

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Sales and units by region and city, in Excel's tabular form: subtotals
 * below each region, a blank line after the last, the two values across,
 * filtered to 2024. New York is NYC renamed.
 *
 *        A            B         C             D
 *   3    Values
 *   4    Region       City      Sum of Sales  Units sold
 *   5    East         Boston    4             1
 *   6                 New York  6             2
 *   7    East Total             10            3
 *   8    West         LA        1             5
 *   9    West Total             1             5
 *  10
 *  11    Grand Total            11            8
 */
const pivot: SheetPivotTable = {
  location: 'A3:D11',
  table: `<pivotTableDefinition xmlns="${MAIN}" name="Sales" cacheId="0" dataCaption="Values"><location ref="A3:D11" firstHeaderRow="1" firstDataRow="2" firstDataCol="2" rowPageCount="2" colPageCount="1"/><pivotFields count="6"><pivotField axis="axisRow" compact="0" outline="0" showAll="0"><items count="3"><item x="0"/><item x="1"/><item t="default"/></items></pivotField><pivotField axis="axisRow" compact="0" outline="0" showAll="0"><items count="4"><item x="0"/><item n="New York" x="1"/><item x="2"/><item t="default"/></items></pivotField><pivotField dataField="1" showAll="0"/><pivotField dataField="1" showAll="0"/><pivotField axis="axisPage" showAll="0"><items count="3"><item x="0"/><item x="1"/><item t="default"/></items></pivotField><pivotField axis="axisPage" showAll="0"><items count="15">${Array.from({ length: 14 }, (_, index) => `<item x="${index}"/>`).join('')}<item t="default"/></items></pivotField></pivotFields><rowFields count="2"><field x="0"/><field x="1"/></rowFields><rowItems count="7"><i><x/><x/></i><i r="1"><x v="1"/></i><i t="default"><x/></i><i><x v="1"/><x v="2"/></i><i t="default"><x v="1"/></i><i t="blank"><x v="1"/></i><i t="grand"><x/></i></rowItems><colFields count="1"><field x="-2"/></colFields><colItems count="2"><i><x/></i><i i="1"><x v="1"/></i></colItems><pageFields count="2"><pageField fld="4" item="1" hier="-1"/><pageField fld="5" hier="-1"/></pageFields><dataFields count="2"><dataField name="Sum of Sales" fld="2" baseField="0" baseItem="0"/><dataField name="Units sold" fld="3" baseField="0" baseItem="0"/></dataFields><extLst><ext uri="{962EF5D1-5CA2-4c93-8EF4-DBF5C05439D2}"><x14:pivotTableDefinition xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" hideValuesRow="1"/></ext></extLst></pivotTableDefinition>`,
  cache: `<pivotCacheDefinition xmlns="${MAIN}" saveData="0" refreshOnLoad="1"><cacheSource type="worksheet"><worksheetSource ref="A1:F5" sheet="Data"/></cacheSource><cacheFields count="6"><cacheField name="Region" numFmtId="0"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="City" numFmtId="0"><sharedItems count="3"><s v="Boston"/><s v="NYC"/><s v="LA"/></sharedItems></cacheField><cacheField name="Sales" numFmtId="0"><sharedItems containsNumber="1"/></cacheField><cacheField name="Units" numFmtId="0"><sharedItems containsNumber="1"/></cacheField><cacheField name="Year" numFmtId="0"><sharedItems count="2"><n v="2023"/><n v="2024"/></sharedItems></cacheField><cacheField name="Date" numFmtId="14"><sharedItems containsDate="1" count="2"><d v="2024-01-05T00:00:00"/><d v="2024-03-09T00:00:00"/></sharedItems><fieldGroup base="5"><rangePr groupBy="months" startDate="2024-01-05T00:00:00" endDate="2024-03-10T00:00:00"/><groupItems count="14"><s v="&lt;1/5/2024"/>${months.map((month) => `<s v="${month}"/>`).join('')}<s v="&gt;3/10/2024"/></groupItems></fieldGroup></cacheField></cacheFields></pivotCacheDefinition>`,
};

const cells: SpreadsheetCells = {
  A3: { value: 'Values' },
  A4: { value: 'Region' },
  B4: { value: 'City' },
  C4: { value: 'Sum of Sales' },
  D4: { value: 'Units sold' },
};
for (const [row, label, city, sales, units] of [
  [5, 'East', 'Boston', 4, 1],
  [6, '', 'New York', 6, 2],
  [7, 'East Total', '', 10, 3],
  [8, 'West', 'LA', 1, 5],
  [9, 'West Total', '', 1, 5],
  [11, 'Grand Total', '', 11, 8],
] as const) {
  if (label) cells[`A${row}`] = { value: label };
  if (city) cells[`B${row}`] = { value: city };
  cells[`C${row}`] = { value: String(sales) };
  cells[`D${row}`] = { value: String(units) };
}

describe('pivot table layouts', () => {
  it('lists the rows and columns of values with the items they are for', () => {
    const layout = pivotLayout(pivot);
    expect(layout?.range).toEqual([3, 1, 11, 4]);
    // The blank line is no line of values; totals are marked.
    expect(layout?.rows).toEqual([
      {
        at: 5,
        items: [
          [0, 0],
          [1, 0],
        ],
      },
      {
        at: 6,
        items: [
          [0, 0],
          [1, 1],
        ],
      },
      { at: 7, items: [[0, 0]], total: true },
      {
        at: 8,
        items: [
          [0, 1],
          [1, 2],
        ],
      },
      { at: 9, items: [[0, 1]], total: true },
      { at: 11, items: [], total: true },
    ]);
    // The values run across, one data field a column.
    expect(layout?.columns).toEqual([
      { at: 3, items: [], data: 0 },
      { at: 4, items: [], data: 1 },
    ]);
    expect(layout?.data).toEqual([
      ['sum of sales', 'sales'],
      ['units sold', 'units'],
    ]);
    expect(layout?.filters).toEqual([
      [4, 1],
      [5, null],
    ]);
    const [, city, , , year, date] = layout?.fields ?? [];
    expect(city.items[1]).toEqual({ text: 'new york' });
    expect(year.items[1]).toEqual({ text: '2024', number: 2024 });
    // A grouped field's items are its groups; months go by their number.
    expect(date.items[3]).toEqual({ text: 'mar', number: 3 });
    expect(date.items[0]).toEqual({ text: '<1/5/2024' });
  });

  it('follows the table when it moves, but not when its cells change shape', () => {
    const moved = pivotLayout({ ...pivot, location: 'B5:E13' });
    expect(moved?.rows[0].at).toBe(7);
    expect(moved?.columns[0].at).toBe(4);
    expect(pivotLayout({ ...pivot, location: 'A3:D12' })).toBeUndefined();
    expect(pivotLayout({ ...pivot, location: 'A3:E11' })).toBeUndefined();
  });

  it('works out each table once', () => {
    const [first] = sheetPivotLayouts([pivot]);
    expect(sheetPivotLayouts([pivot])[0]).toBe(first);
  });
});

describe('GETPIVOTDATA', () => {
  const formulas: Record<string, string> = {
    G1: '=GETPIVOTDATA("Sales",$A$3)',
    G2: '=GETPIVOTDATA("Units sold",$A$3)',
    G3: '=GETPIVOTDATA("Units",$A$3,"Region","East")',
    G4: '=GETPIVOTDATA("Sum of Sales",$C$7,"Region","East","City","New York")',
    G5: '=GETPIVOTDATA("Sales",$A$3,"Region","West")',
    G6: '=GETPIVOTDATA("Sales",$A$3,"Year",2024)',
    G7: '=GETPIVOTDATA("Sales",Pivot!$A$3,"City","LA","Region","West")',
    H1: '=GETPIVOTDATA("Sales",$A$3,"Year",2023)',
    H2: '=GETPIVOTDATA("Sales",$A$3,"Date",3)',
    H3: '=GETPIVOTDATA("Sales",$A$3,"Region","North")',
    H4: '=GETPIVOTDATA("Sales",$F$1)',
  };
  const sheet = (extra: SpreadsheetCells = {}) => ({
    id: 'pivot',
    name: 'Pivot',
    rowCount: 20,
    cells: {
      ...cells,
      ...Object.fromEntries(
        Object.entries(formulas).map(([address, value]) => [address, { value }])
      ),
      ...extra,
    },
    metadata: { pivotTables: [pivot] },
  });

  it('reads the values a pivot table shows by their items', () => {
    const results = calculator.calculateWorkbook([sheet()]).pivot;
    expect(
      ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].map(
        (address) => results[address]?.display
      )
    ).toEqual(['11', '8', '3', '6', '1', '11', '1']);
    // What it does not show: another year, a filter showing every month,
    // an item it does not have and a cell outside it.
    for (const address of ['H1', 'H2', 'H3', 'H4'])
      expect(results[address]?.display).toBe('#REF!');
  });

  it('follows the cells of the pivot table, and its layout when the host gives it', () => {
    const edited = calculator.calculateWorkbook([
      sheet({ C6: { value: '7' } }),
    ]).pivot;
    expect(edited.G4?.display).toBe('7');
    const session = calculator.session();
    const { metadata: _metadata, ...plain } = sheet();
    const loaded = session.load([
      { ...plain, pivots: sheetPivotLayouts([pivot]) },
    ]).pivot;
    expect(loaded.G3?.display).toBe('3');
    const changed = session.update({ pivot: { D7: { value: '30' } } }).pivot;
    expect(changed.G3?.display).toBe('30');
    session.dispose();
  });
});
