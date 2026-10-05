import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { chartData } from './chart-data';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';
import { corpusBytes, corpusEntries } from './xlsx-fixtures/corpus';

const corpus = (file: string) => {
  const entry = corpusEntries().find((item) => item.file === file);
  if (!entry) throw new Error(`Missing corpus file ${file}`);
  return corpusBytes(entry);
};
const text = (files: Record<string, Uint8Array>, name: string) =>
  strFromU8(files[name]);

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

  it('keeps only the values of pivot tables over other workbooks, and unlinks their charts', async () => {
    const imported = await decodeXlsx(
      corpus(
        'figshare-ucl-social-enterprise-financial-sustainability-model.xlsx'
      )
    );
    expect(imported.warnings).toContain(
      'Pivot tables from other workbooks, data connections or very large layouts keep only their last values.'
    );
    expect(imported.sheets.some((sheet) => sheet.metadata?.pivotTables)).toBe(
      false
    );
    const files = unzipSync((await encodeXlsx(imported)).bytes);
    const charts = Object.keys(files).filter((name) =>
      name.startsWith('xl/charts/')
    );
    expect(charts).toHaveLength(10);
    for (const name of charts)
      expect(text(files, name)).not.toMatch(/pivotSource|pivotOptions/);
  });
});
