import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync } from '@ironcalc/wasm';
import { createInitializedSpreadsheetCalculator } from '@macro-inc/spreadsheet/calculation';
import { sheetPivotLayouts } from '@macro-inc/spreadsheet/pivot-layout';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SpreadsheetCalculator } from './calculation';
import { chartData } from './chart-data';
import { formatCellAddress } from './spreadsheet-document';
import type { WorkbookFileData } from './workbook-file-types';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';
import { corpusBytes, corpusEntries } from './xlsx-fixtures/corpus';
import { PIVOT_RECORDS_WARNING, PIVOT_VALUES_WARNING } from './xlsx-pivots';

const corpus = (file: string) => {
  const entry = corpusEntries().find((item) => item.file === file);
  if (!entry) throw new Error(`Missing corpus file ${file}`);
  return corpusBytes(entry);
};
const text = (files: Record<string, Uint8Array>, name: string) =>
  strFromU8(files[name]);
const UCL =
  'figshare-ucl-social-enterprise-financial-sustainability-model.xlsx';

describe('Excel pivot tables', () => {
  it('keeps a pivot table that Excel rebuilds from its cells when the download opens', async () => {
    const imported = await decodeXlsx(
      corpus('ironcalc-example-pivots-charts-comments.xlsx')
    );
    expect(imported.warnings).toContain(
      'Pivot tables show their last values in Macro; Excel rebuilds them from their data when the downloaded file opens.'
    );
    const sheet = imported.sheets.find((entry) => entry.name === 'Sheet4');
    // The values Excel last showed stay in the cells.
    expect(sheet?.cells.B13.value).toBe('5935');
    const [pivot] = sheet?.metadata?.pivotTables ?? [];
    // The source was a table, which becomes ordinary cells.
    expect(pivot).toMatchObject({
      location: 'A3:B13',
      source: "'Table'!$A$1:$D$4",
    });
    expect(pivot.cache).toContain(
      '<worksheetSource ref="A1:D4" sheet="Table"/>'
    );
    expect(pivot.cache).toMatch(/saveData="0"/);
    expect(pivot.cache).toMatch(/refreshOnLoad="1"/);
    expect(pivot.cache).not.toMatch(/r:id=/);

    const exported = await encodeXlsx(imported);
    const files = unzipSync(exported.bytes);
    expect(text(files, 'xl/workbook.xml')).toMatch(
      /<calcPr [^>]*\/><pivotCaches><pivotCache cacheId="1" r:id="(rId\d+)"\/><\/pivotCaches><\/workbook>$/
    );
    const id = /<pivotCache cacheId="1" r:id="(rId\d+)"/.exec(
      text(files, 'xl/workbook.xml')
    )?.[1];
    expect(text(files, 'xl/_rels/workbook.xml.rels')).toContain(
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/>`
    );
    expect(text(files, 'xl/pivotTables/pivotTable1.xml')).toMatch(
      /name="PivotTable1" cacheId="1"/
    );
    expect(text(files, 'xl/pivotTables/_rels/pivotTable1.xml.rels')).toContain(
      'Target="../pivotCache/pivotCacheDefinition1.xml"'
    );
    const sheetNumber =
      imported.sheets.findIndex((entry) => entry.name === 'Sheet4') + 1;
    expect(
      text(files, `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`)
    ).toContain('Target="../pivotTables/pivotTable1.xml"');
    const types = text(files, '[Content_Types].xml');
    expect(types).toContain(
      '<Override PartName="/xl/pivotTables/pivotTable1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml"/>'
    );
    expect(types).toContain('/xl/pivotCache/pivotCacheDefinition1.xml');
    // No records part: Excel reads the source again.
    expect(Object.keys(files).some((name) => name.includes('Records'))).toBe(
      false
    );

    const again = await decodeXlsx(exported.bytes);
    expect(
      again.sheets.find((entry) => entry.name === 'Sheet4')?.metadata
        ?.pivotTables
    ).toEqual(sheet?.metadata?.pivotTables);
  });

  it('writes the custom number formats pivot tables use', async () => {
    const imported = await decodeXlsx(
      corpus('libreoffice-forum-mso-de-104083-pivot-weeknum.xlsx')
    );
    const [pivot] = imported.sheets[0].metadata?.pivotTables ?? [];
    expect(pivot.formats).toEqual({
      '164': '#,##0.0000',
      '165': '"KW "00',
      '166': '_-* #,##0\\ _€_-;\\-* #,##0\\ _€_-;_-* "-"??\\ _€_-;_-@_-',
    });
    const files = unzipSync((await encodeXlsx(imported)).bytes);
    const styles = text(files, 'xl/styles.xml');
    const codes = new Map(
      [
        ...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g),
      ].map(([, id, code]) => [
        id,
        code.replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      ])
    );
    const parts = `${text(files, 'xl/pivotTables/pivotTable1.xml')}${text(files, 'xl/pivotCache/pivotCacheDefinition1.xml')}`;
    const used = new Set(
      [...parts.matchAll(/numFmtId="(\d+)"/g)]
        .map(([, id]) => id)
        .filter((id) => Number(id) >= 164)
    );
    expect(used.size).toBeGreaterThan(0);
    for (const id of used)
      expect(Object.values(pivot.formats ?? {})).toContain(codes.get(id));
    // Its pivot chart stays linked to it, and names its series as the pivot
    // table does: by year, not by the cells above them ("Datum 2015").
    const chart = text(files, 'xl/charts/chart1.xml');
    expect(chart).toContain(
      '<c:name>[Summe KW Pivot.xlsx]Tabelle1!PivotTable2</c:name>'
    );
    expect(chart).toContain('<c:pt idx="0"><c:v>2015</c:v></c:pt>');
    const drawing = imported.sheets[0].metadata?.drawings?.[0];
    if (drawing?.type !== 'chart') throw new Error('Expected a chart.');
    expect(drawing.chart.pivot).toBe(true);
    const shown = chartData(drawing.chart, () => undefined);
    expect(shown.plots[0].series.map((series) => series.name)).toEqual([
      '2015',
      '2016',
      '2017',
    ]);
  });

  it('keeps the formats of pivot table areas', async () => {
    const imported = await decodeXlsx(
      corpus('closedxml-template-table-source-pivot-tables.xlsx')
    );
    const pivot = imported.sheets
      .flatMap((sheet) => sheet.metadata?.pivotTables ?? [])
      .find((entry) => entry.table.includes('name="FinalLiabilityPivotTable"'));
    // Differential formats are numbered in order of use.
    expect(pivot?.table).toContain('<format dxfId="0">');
    expect(pivot?.styles).toContainEqual({ numberFormat: '#,##0' });
    const files = unzipSync((await encodeXlsx(imported)).bytes);
    const dxfs = [
      ...text(files, 'xl/styles.xml').matchAll(/<dxf>([\s\S]*?)<\/dxf>/g),
    ].map(([, body]) => body);
    const table = Object.keys(files)
      .filter((name) => /^xl\/pivotTables\/pivotTable\d+\.xml$/.test(name))
      .map((name) => text(files, name))
      .find((part) => part.includes('name="FinalLiabilityPivotTable"'));
    const used = [...(table ?? '').matchAll(/dxfId="(\d+)"/g)].map(([, id]) =>
      Number(id)
    );
    expect(used.length).toBeGreaterThan(0);
    // Each refers to a format the download contains.
    for (const id of used) expect(dxfs[id]).toBeDefined();
    expect(used.some((id) => dxfs[id].includes('formatCode="#,##0"'))).toBe(
      true
    );
  });

  it('keeps pivot tables over other workbooks with the data Excel saved, and their charts linked', async () => {
    const imported = await decodeXlsx(corpus(UCL));
    expect(imported.warnings).toContain(
      'Pivot tables over other workbooks or data connections show their last values in Macro; the download keeps them with the data Excel saved, to refresh in Excel.'
    );
    expect(imported.warnings).not.toContain(PIVOT_VALUES_WARNING);
    const pivots = imported.sheets.flatMap(
      (sheet) => sheet.metadata?.pivotTables ?? []
    );
    expect(pivots).toHaveLength(8);
    for (const pivot of pivots) {
      expect(pivot.workbook).toBe(
        'file:///E:\\MBA%20Project\\Interviews_Revenue_Model.xlsx'
      );
      expect(pivot.records).toMatch(/^<pivotCacheRecords\b/);
      expect(pivot.source).toBeUndefined();
      // Excel shows it from its records; refreshing it is left to Excel.
      expect(pivot.cache).not.toMatch(/refreshOnLoad|saveData="0"|r:id=/);
    }

    const files = unzipSync((await encodeXlsx(imported)).bytes);
    expect(text(files, 'xl/pivotCache/pivotCacheDefinition1.xml')).toMatch(
      /<pivotCacheDefinition [^>]* r:id="rId1"><cacheSource type="worksheet"><worksheetSource r:id="rId2" ref="H1:H1048576" sheet="Labs"\/>/
    );
    expect(
      text(files, 'xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels')
    ).toContain(
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotCacheRecords" Target="pivotCacheRecords1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///E:\\MBA%20Project\\Interviews_Revenue_Model.xlsx" TargetMode="External"/>'
    );
    expect(text(files, 'xl/pivotCache/pivotCacheRecords1.xml')).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${pivots[0].records}`
    );
    expect(text(files, '[Content_Types].xml')).toContain(
      '<Override PartName="/xl/pivotCache/pivotCacheRecords8.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.pivotCacheRecords+xml"/>'
    );
    // Its pivot charts stay pivot charts.
    const charts = Object.keys(files).filter((name) =>
      /^xl\/charts\/chart\d+\.xml$/.test(name)
    );
    expect(charts).toHaveLength(10);
    expect(
      charts.filter((name) => text(files, name).includes('<c:pivotSource>'))
    ).toHaveLength(8);

    const again = await decodeXlsx(zipSync(files));
    expect(
      again.sheets.flatMap((sheet) => sheet.metadata?.pivotTables ?? [])
    ).toEqual(pivots);
  }, 60_000);

  it('keeps pivot tables over data connections, without saved passwords', async () => {
    // Two caches of the workbook read data connections instead: a
    // database, with its password saved, and a Power Query query, which
    // reads parts of the workbook Macro does not keep.
    const files = unzipSync(corpus(UCL));
    const fromConnection = (part: string, id: number) => {
      files[part] = strToU8(
        text(files, part).replace(
          /<cacheSource type="worksheet">[\s\S]*?<\/cacheSource>/,
          `<cacheSource type="external" connectionId="${id}"/>`
        )
      );
    };
    fromConnection('xl/pivotCache/pivotCacheDefinition1.xml', 3);
    fromConnection('xl/pivotCache/pivotCacheDefinition2.xml', 4);
    const revision =
      'http://schemas.microsoft.com/office/spreadsheetml/2017/revision16';
    const compatibility =
      'http://schemas.openxmlformats.org/markup-compatibility/2006';
    files['xl/connections.xml'] = strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="${compatibility}" mc:Ignorable="xr16" xmlns:xr16="${revision}"><connection id="3" xr16:uid="{8A6B0C1E-2F4D-4A54-9C2B-6D7E8F9A0B1C}" name="Clinic survey" type="1" refreshedVersion="6" savePassword="1" background="1" saveData="1"><dbPr connection="DSN=Clinics;UID=analyst;PWD=hunter2;DATABASE=survey" command="SELECT * FROM labs"/></connection><connection id="4" name="Query - Labs" type="5" refreshedVersion="6" background="1" saveData="1"><dbPr connection="Provider=Microsoft.Mashup.OleDb.1;Data Source=$Workbook$;Location=Labs" command="SELECT * FROM [Labs]"/></connection></connections>`
    );
    files['xl/_rels/workbook.xml.rels'] = strToU8(
      text(files, 'xl/_rels/workbook.xml.rels').replace(
        '</Relationships>',
        '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/connections" Target="connections.xml"/></Relationships>'
      )
    );
    const imported = await decodeXlsx(zipSync(files));
    expect(imported.warnings).toContain(
      'Passwords saved with data connections are not kept; Excel asks for them when it refreshes a pivot table.'
    );
    // The query's pivot table keeps only its values.
    expect(imported.warnings).toContain(PIVOT_VALUES_WARNING);
    const pivots = imported.sheets.flatMap(
      (sheet) => sheet.metadata?.pivotTables ?? []
    );
    expect(pivots).toHaveLength(7);
    const connected = pivots.filter((pivot) => pivot.connection);
    expect(connected).toHaveLength(1);
    const [pivot] = connected;
    expect(pivot.workbook).toBeUndefined();
    expect(pivot.records).toMatch(/^<pivotCacheRecords\b/);
    // It declares what the connections part declared for it.
    expect(pivot.connection).toBe(
      `<connection id="0" xr16:uid="{8A6B0C1E-2F4D-4A54-9C2B-6D7E8F9A0B1C}" name="Clinic survey" type="1" refreshedVersion="6" background="1" saveData="1" xmlns:mc="${compatibility}" mc:Ignorable="xr16" xmlns:xr16="${revision}"><dbPr connection="DSN=Clinics;UID=analyst;DATABASE=survey" command="SELECT * FROM labs"/></connection>`
    );

    const exported = unzipSync((await encodeXlsx(imported)).bytes);
    const caches = Object.keys(exported).filter((name) =>
      /^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/.test(name)
    );
    expect(
      caches.filter((name) =>
        text(exported, name).includes(
          '<cacheSource type="external" connectionId="1"/>'
        )
      )
    ).toHaveLength(1);
    expect(text(exported, 'xl/connections.xml')).toBe(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<connections xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pivot.connection?.replace('id="0"', 'id="1"')}</connections>`
    );
    expect(text(exported, '[Content_Types].xml')).toContain(
      '<Override PartName="/xl/connections.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.connections+xml"/>'
    );
    expect(text(exported, 'xl/_rels/workbook.xml.rels')).toMatch(
      /<Relationship Id="rId\d+" Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/connections" Target="connections.xml"\/>/
    );

    const again = await decodeXlsx(zipSync(exported));
    expect(
      again.sheets.flatMap((sheet) => sheet.metadata?.pivotTables ?? [])
    ).toEqual(pivots);
    expect(again.warnings).not.toContain(
      'Passwords saved with data connections are not kept; Excel asks for them when it refreshes a pivot table.'
    );
  }, 60_000);

  it('downloads pivot tables without saved data that does not fit', async () => {
    const files = unzipSync(corpus(UCL));
    const part = 'xl/pivotCache/pivotCacheRecords1.xml';
    // Records over the size Macro keeps.
    files[part] = strToU8(
      text(files, part).replace(
        '</pivotCacheRecords>',
        `${'<r><x v="0"/></r>'.repeat(20_000)}</pivotCacheRecords>`
      )
    );
    const imported = await decodeXlsx(zipSync(files));
    expect(imported.warnings).toContain(PIVOT_RECORDS_WARNING);
    const pivots = imported.sheets.flatMap(
      (sheet) => sheet.metadata?.pivotTables ?? []
    );
    expect(pivots).toHaveLength(8);
    const [bare, ...rest] = pivots.filter((pivot) => !pivot.records);
    expect(rest).toHaveLength(0);
    // Excel shows its layout and fills it again when it refreshes.
    expect(bare.cache).toMatch(/^<pivotCacheDefinition [^>]*saveData="0"/);
    const exported = unzipSync((await encodeXlsx(imported)).bytes);
    expect(
      Object.keys(exported).filter((name) => name.includes('Records'))
    ).toHaveLength(7);
  }, 60_000);
});

describe('GETPIVOTDATA', () => {
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
  const calculate = (workbook: WorkbookFileData) =>
    calculator.calculateWorkbook(
      workbook.sheets.map((sheet, index) => ({
        id: String(index),
        name: sheet.name,
        cells: sheet.cells,
        rowCount: sheet.rowCount,
        metadata: sheet.metadata,
      }))
    );

  it('calculates lookups of the pivot tables Macro keeps, as Excel did', async () => {
    const imported = await decodeXlsx(
      corpus('zenodo-ccs-cement-post-tax-dcf-model.xlsx')
    );
    expect(imported.warnings.join(' ')).not.toContain('GETPIVOTDATA');
    const index = imported.sheets.findIndex((sheet) => sheet.name === 'RQ1');
    const sheet = imported.sheets[index];
    expect(sheet.cells.K19.value).toBe(
      '=GETPIVOTDATA("Transport Cost",$I$7,"Mode of Transport","Barge","Sector Germany","South")'
    );
    const results = calculate(imported)[String(index)];
    // The values Excel calculated.
    expect(results.K19?.number).toBeCloseTo(38.865035714285703, 10);
    expect(results.J20?.number).toBeCloseTo(20.245249999999999, 10);
    expect(results.K20?.number).toBeCloseTo(34.503386363636359, 10);
    expect(results.J21?.number).toBeCloseTo(60.26850000000001, 10);
    expect(results.K21?.number).toBeCloseTo(62.003161764705872, 10);
    // They read the pivot table's cell, so they follow an edit to it.
    sheet.cells.J9 = { ...sheet.cells.J9, value: '40' };
    expect(calculate(imported)[String(index)].K19?.number).toBe(40);
  }, 60_000);

  it('finds every value of every pivot table in the corpus by its items', async () => {
    let found = 0;
    for (const file of [
      'zenodo-ccs-cement-post-tax-dcf-model.xlsx',
      'ironcalc-example-pivots-charts-comments.xlsx',
      'libreoffice-forum-mso-de-104083-pivot-weeknum.xlsx',
      'sheetjs-formula-stress-test.xlsx',
      'closedxml-template-table-source-pivot-tables.xlsx',
    ]) {
      const imported = await decodeXlsx(corpus(file));
      const lookups: { sheet: number; address: string; cell: string }[] = [];
      const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
      for (const [index, sheet] of imported.sheets.entries()) {
        sheet.rowCount = Math.max(sheet.rowCount, 2_000);
        for (const layout of sheetPivotLayouts(sheet.metadata?.pivotTables)) {
          const [top, left] = layout.range;
          for (const row of layout.rows)
            for (const column of layout.columns) {
              const data = row.data ?? column.data ?? 0;
              if (row.data !== undefined && column.data !== undefined) continue;
              if (!layout.data[data]) continue;
              const pairs = [...row.items, ...column.items].flatMap(
                ([field, item]) => {
                  const { text, number } = layout.fields[field].items[item];
                  return [
                    quote(layout.fields[field].names[0]),
                    number === undefined ? quote(text) : String(number),
                  ];
                }
              );
              const address = formatCellAddress(1_000 + lookups.length, 40);
              sheet.cells[address] = {
                value: `=GETPIVOTDATA(${[quote(layout.data[data][0]), formatCellAddress(top - 1, left - 1), ...pairs].join(',')})`,
              };
              lookups.push({
                sheet: index,
                address,
                cell: formatCellAddress(row.at - 1, column.at - 1),
              });
            }
        }
      }
      const results = calculate(imported);
      for (const { sheet, address, cell } of lookups) {
        const shown = results[String(sheet)][cell];
        const value = results[String(sheet)][address];
        // An empty cell shows no value.
        if (!shown) expect(value?.display, cell).toBe('#REF!');
        else if (shown.number !== undefined)
          expect(value?.number, cell).toBe(shown.number);
        else expect(value?.display, cell).toBe(shown.display);
      }
      found += lookups.length;
    }
    expect(found).toBe(735);
  }, 60_000);

  it('keeps the last value of a lookup whose pivot table it cannot keep', async () => {
    const files = unzipSync(corpus('sheetjs-formula-stress-test.xlsx'));
    // Without its relationship, the sheet has no pivot table to keep.
    const rels = 'xl/worksheets/_rels/sheet1.xml.rels';
    files[rels] = strToU8(
      text(files, rels).replace(/<Relationship [^>]*pivotTable[^>]*\/>/, '')
    );
    const imported = await decodeXlsx(zipSync(files));
    const database = imported.sheets.find((sheet) => sheet.name === 'Database');
    expect(database?.cells.B16.value).toBe('57');
    expect(imported.warnings).toContain(
      'Pivot table lookups (GETPIVOTDATA) of pivot tables Macro could not keep are imported as their last calculated values.'
    );
    // With it, the lookup calculates.
    const kept = await decodeXlsx(corpus('sheetjs-formula-stress-test.xlsx'));
    const index = kept.sheets.findIndex((sheet) => sheet.name === 'Database');
    expect(kept.sheets[index].cells.B16.value).toBe(
      '=GETPIVOTDATA("Sum of Qux",B32)'
    );
    expect(calculate(kept)[String(index)].B16?.display).toBe('57');
  });
});
