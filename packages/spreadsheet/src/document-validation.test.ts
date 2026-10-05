import { readFileSync } from 'node:fs';
import { LoroCounter, LoroDoc, LoroMap, LoroText } from 'loro-crdt';
import { afterEach, describe, expect, it } from 'vitest';
import { validateSpreadsheetDocument } from './document-validation';

const docs: LoroDoc[] = [];
function workbook() {
  const doc = new LoroDoc();
  docs.push(doc);
  doc.import(
    readFileSync(
      new URL(
        '../../../static_assets/spreadsheet-golden.1.bin',
        import.meta.url
      )
    )
  );
  return doc;
}
afterEach(() => {
  for (const doc of docs.splice(0)) doc.free();
});

describe('spreadsheet document validation outside sync', () => {
  it('accepts native snapshots and imported financial styles and metadata', () => {
    const doc = workbook();
    for (const [root, value] of [
      ['spreadsheetNumberFormats', '#,##0.00;[Red](#,##0.00);"—"'],
      ['spreadsheetFontNames', 'Calibri'],
      ['spreadsheetBorderBottomStyles', 'double'],
      ['spreadsheetBorderBottomColors', '#123456'],
    ])
      doc.getMap(root).set('A1', value);
    doc
      .getMap('spreadsheetImages')
      .set('0123456789abcdef', 'data:image/png;base64,iVBORw0KGgo=');
    doc.getMap('spreadsheetSheetMetadata').set(
      'sheet1',
      JSON.stringify({
        drawings: [
          {
            id: 'logo',
            type: 'image',
            image: '0123456789abcdef',
            from: { row: 0, column: 0, x: 0, y: 0 },
            width: 120,
            height: 40,
          },
        ],
        merges: ['A1:C1'],
        rowHeights: { 0: 32 },
        hiddenRows: [5],
        hiddenColumns: [5],
        freeze: { rows: 3, columns: 1 },
        definedNames: [{ name: 'Rate', formula: '0.1', local: true }],
      })
    );
    expect(() => validateSpreadsheetDocument(doc)).not.toThrow();
  });

  it.each([
    ['root', 'content', 'bad'],
    ['spreadsheetUnknown', 'A1', 'bad'],
    ['spreadsheetValues', 'XFE1', 'bad'],
    ['spreadsheetValues', 'A100001', 'bad'],
    ['spreadsheetValues', 'A1', 'x'.repeat(10_001)],
    ['spreadsheetValues', 'bad!sheet!A1', 'bad'],
    ['spreadsheetFontSize', 'A1', 'large'],
    ['spreadsheetFormats', 'A1', 'unsupported'],
    ['spreadsheetSheetNames', 'sheet1', ' Untrimmed '],
    ['spreadsheetSheetOrder', 'bad!id', 1],
    [
      'spreadsheetSheetRetentions',
      'sheet1!peer',
      '{"name":"Sheet1","order":0,"revision":-1}',
    ],
    ['spreadsheetColumnWidths', '0', 641],
    ['spreadsheetRowAdditions', 'peer', 100_001],
    ['spreadsheetColumnAdditions', 'peer', 16_385],
    ['spreadsheetColumnWidths', '16384', 100],
    ['spreadsheetMeta', 'formatVersion', 2],
    // Only raster images are stored; SVG can carry scripts.
    [
      'spreadsheetImages',
      '0123456789abcdef',
      'data:image/svg+xml;base64,PHN2Zy8+',
    ],
    ['spreadsheetImages', 'logo', 'data:image/png;base64,iVBORw0KGgo='],
  ])('rejects invalid %s entries', (root, key, value) => {
    const doc = workbook();
    doc.getMap(root as string).set(key as string, value);
    expect(() => validateSpreadsheetDocument(doc)).toThrow(
      'native spreadsheet maps'
    );
  });

  it.each([
    '{"merges":["A1:XFE1"]}',
    '{"merges":["A1:A100001"]}',
    '{"rowHeights":{"100000":32}}',
    '{"hiddenColumns":[16384]}',
    '{"freeze":{"rows":100001,"columns":1}}',
    '{"arrayFormulas":{"A1":"B1:B3"}}',
    '{"definedNames":[{"name":"Rate","formula":false}]}',
    '{"unexpected":true}',
  ])('rejects invalid workbook metadata %s', (metadata) => {
    const doc = workbook();
    doc.getMap('spreadsheetSheetMetadata').set('sheet1', metadata);
    expect(() => validateSpreadsheetDocument(doc)).toThrow();
  });

  it('rejects nested containers even when their deep values look like valid scalars', () => {
    const text = workbook();
    text
      .getMap('spreadsheetValues')
      .setContainer('A1', new LoroText())
      .insert(0, 'looks valid');
    expect(text.toJSON().spreadsheetValues).toEqual({ A1: 'looks valid' });
    expect(() => validateSpreadsheetDocument(text)).toThrow();
    const counter = workbook();
    counter
      .getMap('spreadsheetFontSize')
      .setContainer('A1', new LoroCounter())
      .increment(10);
    expect(() => validateSpreadsheetDocument(counter)).toThrow();
    const map = workbook();
    map.getMap('spreadsheetValues').setContainer('A1', new LoroMap());
    expect(() => validateSpreadsheetDocument(map)).toThrow();
  });

  it('rejects other content types and wrong root container types', () => {
    const markdown = new LoroDoc();
    docs.push(markdown);
    markdown.getText('root').insert(0, 'markdown');
    expect(() => validateSpreadsheetDocument(markdown)).toThrow();
    const doc = workbook();
    doc.getText('spreadsheetValues').insert(0, 'not a map');
    expect(() => validateSpreadsheetDocument(doc)).toThrow();
  });
});
