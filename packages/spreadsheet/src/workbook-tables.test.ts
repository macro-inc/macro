import { LoroDoc } from 'loro-crdt';
import { afterAll, describe, expect, it } from 'vitest';
import { validateSpreadsheetDocument } from './document-validation';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from './spreadsheet-document';
import { writeSheetMetadata } from './table-storage';
import {
  addSpreadsheetSheet,
  createSpreadsheetTable,
  deleteSpreadsheetSheet,
  duplicateSpreadsheetSheet,
  importSpreadsheetSheets,
  readSpreadsheetWorkbook,
} from './workbook-document';

const documents: LoroDoc[] = [];
function document() {
  const doc = new LoroDoc();
  doc.getMap('spreadsheetMeta').set('formatVersion', 1);
  writeSpreadsheetCells(doc, {
    A1: { value: 'Item' },
    B1: { value: 'Qty' },
    A2: { value: 'Pens' },
    B2: { value: '2' },
    C2: { value: '=Sales[@Qty]*2' },
  });
  documents.push(doc);
  return doc;
}
afterAll(() => {
  for (const doc of documents) doc.free();
});

describe('tables in the workbook document', () => {
  it('creates a table with the next free name and a valid document', () => {
    const doc = document();
    expect(createSpreadsheetTable(doc, 'sheet1', { range: 'A1:B2' })).toBe(
      'Table1'
    );
    expect(() =>
      createSpreadsheetTable(doc, 'sheet1', { range: 'D1:E2', name: 'table1' })
    ).toThrow('already uses the name');
    doc.commit();
    validateSpreadsheetDocument(doc);
    expect(readSpreadsheetWorkbook(doc)[0].metadata?.tables).toEqual([
      {
        id: expect.any(String),
        name: 'Table1',
        range: 'A1:B2',
        totalsRow: false,
        bandedRows: true,
        style: 'TableStyleMedium2',
        columnTypes: { 0: 'text', 1: 'number' },
      },
    ]);
  });

  it('types the columns it is asked to by name', () => {
    const doc = document();
    createSpreadsheetTable(doc, 'sheet1', {
      range: 'A1:B2',
      columnTypes: { qty: 'currency', Item: 'dropdown' },
    });
    doc.commit();
    validateSpreadsheetDocument(doc);
    const [sheet] = readSpreadsheetWorkbook(doc);
    expect(sheet.metadata?.tables?.[0].columnTypes).toEqual({
      0: 'dropdown',
      1: 'currency',
    });
    expect(sheet.cells.B2.format).toBe('currency');
    expect(sheet.metadata?.validations?.[0]).toMatchObject({
      range: 'A2',
      formulas: ['"Pens"'],
    });
    expect(() =>
      createSpreadsheetTable(document(), 'sheet1', {
        range: 'A1:B2',
        columnTypes: { Price: 'number' },
      })
    ).toThrow('no column “Price”. Its columns are Item, Qty.');
  });

  it('gives a duplicated sheet new table names that its formulas use', () => {
    const doc = document();
    createSpreadsheetTable(doc, 'sheet1', { range: 'A1:C2', name: 'Sales' });
    doc.commit();
    const copy = duplicateSpreadsheetSheet(doc, 'sheet1');
    const sheet = readSpreadsheetWorkbook(doc).find((item) => item.id === copy);
    expect(sheet?.metadata?.tables?.[0].name).toBe('Table1');
    expect(readSpreadsheetCells(doc, copy).C2.value).toBe('=Table1[@Qty]*2');
    expect(readSpreadsheetCells(doc, 'sheet1').C2.value).toBe('=Sales[@Qty]*2');
  });

  it('keeps a sheet whose tables other sheets use', () => {
    const doc = document();
    createSpreadsheetTable(doc, 'sheet1', { range: 'A1:C2', name: 'Sales' });
    const other = addSpreadsheetSheet(doc, 'Summary');
    writeSpreadsheetCells(doc, { A1: { value: '=SUM(Sales[Qty])' } }, other);
    expect(() => deleteSpreadsheetSheet(doc, 'sheet1')).toThrow(
      'use the table “Sales”'
    );
    writeSpreadsheetCells(doc, { A1: { value: '1' } }, other);
    deleteSpreadsheetSheet(doc, 'sheet1');
    expect(readSpreadsheetWorkbook(doc).map((sheet) => sheet.name)).toEqual([
      'Summary',
    ]);
  });

  it('refuses to append sheets whose table names the workbook uses', () => {
    const doc = document();
    createSpreadsheetTable(doc, 'sheet1', { range: 'A1:C2', name: 'Sales' });
    doc.commit();
    expect(() =>
      importSpreadsheetSheets(doc, [
        {
          name: 'Imported',
          cells: { A1: { value: 'X' } },
          rowCount: 200,
          columnWidths: {},
          metadata: {
            tables: [
              {
                name: 'SALES',
                range: 'A1:A2',
                totalsRow: false,
                bandedRows: true,
              },
            ],
          },
        },
      ])
    ).toThrow('already has a table or name called “SALES”');
  });
});

describe('table storage', () => {
  it('merges collaborators changing different tables of a sheet at once', () => {
    const doc = document();
    writeSpreadsheetCells(doc, {
      E1: { value: 'Name' },
      E2: { value: 'Ada' },
    });
    createSpreadsheetTable(doc, 'sheet1', { range: 'A1:B2', name: 'Left' });
    createSpreadsheetTable(doc, 'sheet1', { range: 'E1:E2', name: 'Right' });
    doc.commit();
    const peer = new LoroDoc();
    documents.push(peer);
    peer.import(doc.export({ mode: 'snapshot' }));
    const metadata = (current: LoroDoc) =>
      readSpreadsheetWorkbook(current)[0].metadata;
    const own = metadata(doc);
    writeSheetMetadata(doc, 'sheet1', {
      ...own,
      tables: own?.tables?.map((table) =>
        table.name === 'Left' ? { ...table, bandedRows: false } : table
      ),
    });
    doc.commit();
    const theirs = metadata(peer);
    writeSheetMetadata(peer, 'sheet1', {
      ...theirs,
      merges: ['G1:H1'],
      tables: theirs?.tables?.map((table) =>
        table.name === 'Right'
          ? { ...table, totalsRow: false, style: 'TableStyleLight1' }
          : table
      ),
    });
    peer.commit();
    doc.import(peer.export({ mode: 'update', from: doc.oplogVersion() }));
    const merged = metadata(doc);
    expect(merged?.merges).toEqual(['G1:H1']);
    expect(
      merged?.tables?.map((table) => [
        table.name,
        table.bandedRows,
        table.style,
      ])
    ).toEqual([
      ['Left', false, 'TableStyleMedium2'],
      ['Right', true, 'TableStyleLight1'],
    ]);
    validateSpreadsheetDocument(doc);
  });

  it('reads tables created at once with one name or overlapping cells the same way everywhere', () => {
    const first = document();
    const second = new LoroDoc();
    documents.push(second);
    second.import(first.export({ mode: 'snapshot' }));
    writeSpreadsheetCells(first, { E1: { value: 'Name' }, E2: { value: 'x' } });
    createSpreadsheetTable(first, 'sheet1', { range: 'A1:B2', name: 'Sales' });
    createSpreadsheetTable(first, 'sheet1', { range: 'E1:E2', name: 'Other' });
    first.commit();
    createSpreadsheetTable(second, 'sheet1', { range: 'A1:A2', name: 'Mine' });
    writeSpreadsheetCells(second, {
      G1: { value: 'Name' },
      G2: { value: 'y' },
    });
    createSpreadsheetTable(second, 'sheet1', { range: 'G1:G2', name: 'Sales' });
    second.commit();
    first.import(second.export({ mode: 'update', from: first.oplogVersion() }));
    second.import(
      first.export({ mode: 'update', from: second.oplogVersion() })
    );
    const tables = (doc: LoroDoc) =>
      readSpreadsheetWorkbook(doc)[0].metadata?.tables?.map((table) => [
        table.name,
        table.range,
      ]);
    expect(tables(first)).toEqual(tables(second));
    const names = tables(first)?.map(([name]) => name.toLowerCase()) ?? [];
    expect(new Set(names).size).toBe(names.length);
    // One of the overlapping A1 tables is kept.
    expect(
      tables(first)?.filter(([, range]) => range.startsWith('A1'))
    ).toHaveLength(1);
  });
});
