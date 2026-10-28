import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type {
  SheetChart,
  SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type ChartReader, chartData } from './chart-data';
import { chartScene } from './chart-scene';
import { formatCellAddress } from './spreadsheet-document';
import type { WorkbookFileData } from './workbook-file-types';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';
import { chartPart, readChart } from './xlsx-drawings';
import { withLightness } from './xlsx-stylesheet';

const fixture = () =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve('./xlsx-fixtures/drawings.xlsx')
    )
  );

/** Reads literal cells, as the grid does before calculation. */
function reader(workbook: WorkbookFileData, home: string): ChartReader {
  return (range) => {
    const sheet = workbook.sheets.find(
      (entry) => entry.name === (range.sheet ?? home)
    );
    if (!sheet) return;
    const values = [];
    for (let row = range.top; row <= range.bottom; row++)
      for (let column = range.left; column <= range.right; column++) {
        const text = sheet.cells[formatCellAddress(row, column)]?.value ?? '';
        const number = text === '' ? Number.NaN : Number(text);
        values.push({
          text,
          ...(Number.isFinite(number) && { number }),
        });
      }
    return values;
  };
}

/** An EMF of a header and its end: a metafile that draws nothing. */
function emfHeader() {
  const bytes = new Uint8Array(108 + 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 108, true);
  view.setInt32(16, 99, true);
  view.setInt32(20, 99, true);
  view.setInt32(32, 2646, true);
  view.setInt32(36, 2646, true);
  view.setUint32(40, 0x464d4520, true);
  view.setUint32(44, 0x10000, true);
  view.setUint32(48, bytes.length, true);
  view.setUint32(52, 2, true);
  view.setInt32(72, 1920, true);
  view.setInt32(76, 1080, true);
  view.setInt32(80, 508, true);
  view.setInt32(84, 286, true);
  view.setUint32(108, 14, true);
  view.setUint32(112, 20, true);
  return bytes;
}

const drawingsOf = (workbook: WorkbookFileData, name: string) =>
  workbook.sheets.find((sheet) => sheet.name === name)?.metadata?.drawings ??
  [];

/** Drawings as a round trip should keep them: imported parts are rewritten. */
const comparable = (drawings: SheetDrawing[]) =>
  drawings.map((drawing) =>
    drawing.type !== 'chart'
      ? drawing
      : {
          ...drawing,
          chart: {
            ...drawing.chart,
            source: undefined,
            plots: drawing.chart.plots.map((plot) => ({
              ...plot,
              // Exports cache series names that cells give.
              series: plot.series.map(({ name, ...series }) =>
                series.nameRef === undefined ? { name, ...series } : series
              ),
            })),
          },
        }
  );

describe('Excel drawings', () => {
  it('imports charts and images anchored to cells', async () => {
    const imported = await decodeXlsx(fixture());
    expect(imported.warnings).toEqual([]);
    const sales = drawingsOf(imported, 'Sales');
    expect(
      sales.map((drawing) =>
        drawing.type === 'chart'
          ? `${drawing.chart.plots.map((plot) => `${plot.kind}${plot.grouping ? `/${plot.grouping}` : ''}`)}: ${drawing.chart.title}`
          : `image ${drawing.width}x${drawing.height}`
      )
    ).toEqual([
      'column: Revenue and costs',
      'line: Profit',
      'pie: Share by region',
      'bar/stacked: Stacked costs',
      'area: Revenue area',
      'scatter: Revenue vs costs',
      'image 160x60',
    ]);
    expect(sales[0]).toMatchObject({
      from: { row: 1, column: 8, x: 0, y: 0 },
      width: 454,
      height: 265,
      chart: {
        legend: 'right',
        references: [
          "'Sales'!B1",
          "'Sales'!$A$2:$A$7",
          "'Sales'!$B$2:$B$7",
          "'Sales'!C1",
          "'Sales'!$A$2:$A$7",
          "'Sales'!$C$2:$C$7",
        ],
        // The workbook theme's accents.
        colors: [
          '#4F81BD',
          '#C0504D',
          '#9BBB59',
          '#8064A2',
          '#4BACC6',
          '#F79646',
        ],
      },
    });
    const logo = sales[6];
    expect(logo).toMatchObject({ type: 'image', from: { row: 9, column: 0 } });
    expect(logo.type === 'image' && imported.images?.[logo.image]).toMatch(
      /^data:image\/png;base64,iVBORw0KGgo/
    );
    // A line on Excel's secondary axis, beside columns.
    const [doughnut, combination] = drawingsOf(imported, 'Summary');
    expect(doughnut).toMatchObject({
      chart: { plots: [{ kind: 'doughnut' }] },
    });
    expect(combination.type === 'chart' && combination.chart.plots).toEqual([
      {
        kind: 'column',
        series: [{ values: 2, nameRef: 0, categories: 1 }],
      },
      { kind: 'line', series: [{ values: 4, nameRef: 3 }], secondary: true },
    ]);
  });

  it('draws charts from the cells they reference, on any sheet', async () => {
    const imported = await decodeXlsx(fixture());
    const read = (sheet: string, index: number) => {
      const drawing = drawingsOf(imported, sheet)[index];
      if (drawing.type !== 'chart') throw new Error('Expected a chart.');
      return chartData(drawing.chart, reader(imported, sheet));
    };
    const columns = read('Sales', 0);
    expect(columns.categories).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
    ]);
    expect(
      columns.plots[0].series.map(({ name, color, values }) => ({
        name,
        color,
        values,
      }))
    ).toEqual([
      {
        name: 'Revenue',
        color: '#4F81BD',
        values: [1000, 1250, 1500, 1750, 2000, 2250],
      },
      {
        name: 'Costs',
        color: '#C0504D',
        values: [700, 820, 940, 1060, 1180, 1300],
      },
    ]);
    const scatter = read('Sales', 5).plots[0].series[0];
    expect(scatter.x).toEqual([1000, 1250, 1500, 1750, 2000, 2250]);
    expect(scatter.values).toEqual([700, 820, 940, 1060, 1180, 1300]);
    const doughnut = read('Summary', 0);
    expect(doughnut.categories).toEqual(['North', 'South', 'East', 'West']);
    expect(doughnut.plots[0].series[0].values).toEqual([40, 25, 20, 15]);

    // Bars are proportional to their values, on a zero-based axis.
    const bars = chartScene(columns, 454, 265).shapes.filter(
      (shape) => shape.type === 'rect' && shape.tip
    );
    expect(bars).toHaveLength(12);
    const height = (tip: string) => {
      const bar = bars.find(
        (shape) => shape.type === 'rect' && shape.tip === tip
      );
      return bar?.type === 'rect' ? bar.height : Number.NaN;
    };
    expect(
      height('Revenue · Jun: 2,250') / height('Revenue · Jan: 1,000')
    ).toBeCloseTo(2.25);
    const slices = chartScene(doughnut, 378, 265).shapes.filter(
      (shape) => shape.type === 'path' && shape.translate
    );
    expect(slices.map((shape) => shape.type === 'path' && shape.tip)).toEqual([
      'North: 40%',
      'South: 25%',
      'East: 20%',
      'West: 15%',
    ]);
  });

  it('exports drawings with current values that import again unchanged', async () => {
    const imported = await decodeXlsx(fixture());
    // The first month's revenue changed since the import.
    const sales = imported.sheets[0];
    const exported = await encodeXlsx({
      ...imported,
      sheets: [
        {
          ...sales,
          cells: { ...sales.cells, B2: { ...sales.cells.B2, value: '5000' } },
        },
        imported.sheets[1],
      ],
    });
    expect(exported.warnings).toEqual([]);
    const files = unzipSync(exported.bytes);
    const original = unzipSync(fixture());
    // One copy of the image, byte for byte.
    expect(
      Object.keys(files).filter((name) => name.startsWith('xl/media/'))
    ).toEqual(['xl/media/image1.png']);
    expect(files['xl/media/image1.png']).toEqual(
      original['xl/media/image1.png']
    );
    expect(
      Object.keys(files)
        .filter((name) => name.startsWith('xl/charts/'))
        .sort()
    ).toHaveLength(8);
    const types = strFromU8(files['[Content_Types].xml']);
    expect(types).toContain(
      '<Default Extension="png" ContentType="image/png"/>'
    );
    expect(types).toContain('/xl/charts/chart8.xml');
    expect(types).toContain('/xl/drawings/drawing2.xml');
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toMatch(
      /<drawing r:id="rId1"\/><\/worksheet>$/
    );
    // Imported chart parts are kept, with caches of the cells' values.
    const chart = strFromU8(files['xl/charts/chart1.xml']);
    expect(chart).toContain("<f>'Sales'!$B$2:$B$7</f><numCache>");
    expect(chart).toContain('<pt idx="0"><v>5000</v></pt>');
    expect(chart).toContain(
      '<strCache><ptCount val="1"/><pt idx="0"><v>Revenue</v>'
    );

    const again = await decodeXlsx(exported.bytes);
    expect(again.warnings).toEqual([]);
    for (const name of ['Sales', 'Summary'])
      expect(comparable(drawingsOf(again, name))).toEqual(
        comparable(drawingsOf(imported, name))
      );
    expect(again.images).toEqual(imported.images);
  });

  it('writes charts Macro describes when the imported part cannot be kept', async () => {
    const imported = await decodeXlsx(fixture());
    const withoutSources = {
      ...imported,
      sheets: imported.sheets.map((sheet) => ({
        ...sheet,
        metadata: {
          ...sheet.metadata,
          drawings: sheet.metadata?.drawings?.map((drawing) =>
            drawing.type === 'chart'
              ? { ...drawing, chart: { ...drawing.chart, source: undefined } }
              : drawing
          ),
        },
      })),
    };
    const exported = await encodeXlsx(withoutSources);
    expect(
      strFromU8(unzipSync(exported.bytes)['xl/charts/chart8.xml'])
    ).toContain('<c:crosses val="max"/>');
    const again = await decodeXlsx(exported.bytes);
    const shape = (drawings: SheetDrawing[]) =>
      drawings.map((drawing) =>
        drawing.type === 'chart'
          ? {
              title: drawing.chart.title,
              legend: drawing.chart.legend,
              references: drawing.chart.references,
              plots: drawing.chart.plots.map((plot) => ({
                kind: plot.kind,
                grouping: plot.grouping,
                secondary: plot.secondary,
                series: plot.series.map((series) => [
                  series.nameRef,
                  series.categories,
                  series.values,
                ]),
              })),
            }
          : drawing
      );
    for (const name of ['Sales', 'Summary'])
      expect(shape(drawingsOf(again, name))).toEqual(
        shape(drawingsOf(imported, name))
      );
  });

  it('reads theme colors, absolute anchors and compatibility fallbacks, and reports what it skips', async () => {
    const files = unzipSync(fixture());
    const xdr = (body: string) =>
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">${body}</xdr:wsDr>`;
    const marker = (local: string, column: number, row: number, offset = 0) =>
      `<xdr:${local}><xdr:col>${column}</xdr:col><xdr:colOff>${offset}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${offset * 2}</xdr:rowOff></xdr:${local}>`;
    const picture = (id: string, description = '') =>
      `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"${description ? ` descr="${description}"` : ''}/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${id}"/></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="476250"/></a:xfrm></xdr:spPr></xdr:pic>`;
    const shape =
      '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="3" name="Note box"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp>';
    files['xl/drawings/drawing2.xml'] = strToU8(
      xdr(
        // Excel 2010 content with a fallback: only the fallback is read.
        `<mc:AlternateContent><mc:Choice Requires="a14"><xdr:twoCellAnchor>${marker('from', 0, 0)}${marker('to', 2, 2)}${shape}<xdr:clientData/></xdr:twoCellAnchor></mc:Choice><mc:Fallback><xdr:twoCellAnchor editAs="oneCell">${marker('from', 1, 2, 9525)}${marker('to', 3, 6)}${picture('rId1', 'Company logo')}<xdr:clientData/></xdr:twoCellAnchor></mc:Fallback></mc:AlternateContent>` +
          // A copy of the same picture in another part shares its stored image.
          `<xdr:oneCellAnchor>${marker('from', 6, 2)}<xdr:ext cx="190500" cy="95250"/>${picture('rId2')}<xdr:clientData/></xdr:oneCellAnchor>` +
          `<xdr:absoluteAnchor><xdr:pos x="${200 * 9525}" y="${50 * 9525}"/><xdr:ext cx="${300 * 9525}" cy="${150 * 9525}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="4" name="Plan"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId3"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor>` +
          `<xdr:oneCellAnchor>${marker('from', 0, 20)}<xdr:ext cx="95250" cy="95250"/>${shape}<xdr:clientData/></xdr:oneCellAnchor>` +
          `<xdr:oneCellAnchor>${marker('from', 0, 24)}<xdr:ext cx="95250" cy="95250"/>${picture('rId4')}<xdr:clientData/></xdr:oneCellAnchor>` +
          `<xdr:oneCellAnchor>${marker('from', 0, 28)}<xdr:ext cx="95250" cy="95250"/>${picture('rId5')}<xdr:clientData/></xdr:oneCellAnchor>`
      )
    );
    const relationship = (id: string, type: string, target: string) =>
      `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    files['xl/drawings/_rels/drawing2.xml.rels'] = strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship('rId1', 'image', '../media/image1.png')}${relationship('rId2', 'image', '../media/copy.png')}${relationship('rId3', 'chart', '../charts/plan.xml')}${relationship('rId4', 'image', '../media/vector.emf')}${relationship('rId5', 'image', '../media/scan.tiff')}</Relationships>`
    );
    files['xl/media/copy.png'] = files['xl/media/image1.png'];
    files['xl/media/vector.emf'] = emfHeader();
    files['xl/media/scan.tiff'] = new Uint8Array([
      0x49, 0x49, 0x2a, 0, 8, 0, 0, 0,
    ]);
    const series = (name: string, properties: string, column: string) =>
      `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${name}</c:v></c:tx><c:spPr>${properties}</c:spPr><c:val><c:numRef><c:f>Sales!$${column}$2:$${column}$7</c:f></c:numRef></c:val></c:ser>`;
    files['xl/charts/plan.xml'] = strToU8(
      `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart><c:autoTitleDeleted val="1"/><c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="percentStacked"/>${series('Plan', '<a:solidFill><a:schemeClr val="accent2"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>', 'B')}${series('Gap', '<a:noFill/><a:ln><a:noFill/></a:ln>', 'C')}<c:axId val="1"/><c:axId val="2"/></c:barChart><c:radarChart><c:radarStyle val="marker"/>${series('Radar', '', 'D')}<c:axId val="1"/><c:axId val="2"/></c:radarChart><c:catAx><c:axId val="1"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx></c:plotArea><c:legend><c:legendPos val="b"/></c:legend></c:chart><c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
    );
    files['[Content_Types].xml'] = strToU8(
      strFromU8(files['[Content_Types].xml']).replace(
        '</Types>',
        '<Default Extension="emf" ContentType="image/x-emf"/><Default Extension="tiff" ContentType="image/tiff"/><Override PartName="/xl/charts/plan.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>'
      )
    );
    const imported = await decodeXlsx(zipSync(files));
    expect(imported.warnings).toEqual([
      'Images in formats Macro cannot read, such as TIFF, are not imported.',
    ]);
    // The PNG, shared by two pictures, and the EMF, kept for export.
    expect(
      Object.values(imported.images ?? {}).map((url) => url.slice(0, 20))
    ).toEqual(['data:image/png;base6', 'data:image/x-emf;bas']);
    const [logo, copy, plan, note, vector, ...rest] = drawingsOf(
      imported,
      'Summary'
    );
    expect(rest).toEqual([]);
    // A shape without a frame fills its anchor.
    expect(note).toMatchObject({
      type: 'shape',
      name: 'Note box',
      shape: { parts: [{ x: 0, y: 0, width: 1, height: 1 }] },
    });
    // No canvas outside browsers: the metafile has no picture to show.
    expect(vector).toMatchObject({ type: 'image', width: 10, height: 10 });
    expect(vector.type === 'image' && vector.preview).toBeUndefined();
    // A picture that moves but does not size with its cells keeps its size.
    expect(logo).toEqual({
      id: 'drawing-1',
      name: 'Logo',
      type: 'image',
      image: copy.type === 'image' ? copy.image : '',
      description: 'Company logo',
      from: { row: 2, column: 1, x: 1, y: 2 },
      width: 100,
      height: 50,
    });
    expect(copy).toMatchObject({ width: 20, height: 10 });
    // Absolute positions are placed in the sheet's cells: 64-pixel columns
    // and 20-pixel rows.
    expect(plan).toMatchObject({
      name: 'Plan',
      from: { row: 2, column: 3, x: 8, y: 10 },
      width: 300,
      height: 150,
    });
    if (plan.type !== 'chart') throw new Error('Expected a chart.');
    expect(plan.chart).toMatchObject({
      legend: 'bottom',
      plots: [
        {
          kind: 'column',
          grouping: 'percentStacked',
          series: [
            {
              name: 'Plan',
              color: `#${withLightness('C0504D', (lightness) => lightness * 0.75)}`,
            },
            { name: 'Gap', noFill: true, noLine: true },
          ],
        },
        { kind: 'radar', series: [{ name: 'Radar' }] },
      ],
    });
    expect(plan.chart.title).toBeUndefined();
    // The kept part names the theme color it used, and drops the embedded
    // workbook it referred to.
    expect(plan.chart.source).toContain(
      '<a:srgbClr val="C0504D"><a:lumMod val="75000"/></a:srgbClr>'
    );
    expect(plan.chart.source).not.toContain('externalData');
  });
});

describe('fixed chart values', () => {
  it('keeps fixed values, writing names as text and titles as rich text', async () => {
    const imported = await decodeXlsx(fixture());
    const sales = imported.sheets[0];
    // As after its data sheet was deleted: the chart keeps what it showed.
    const drawings = (sales.metadata?.drawings ?? []).map((drawing, index) =>
      index === 0 && drawing.type === 'chart'
        ? {
            ...drawing,
            chart: {
              ...drawing.chart,
              references: [
                '{"Revenue"}',
                '{"Jan","Feb"}',
                '{1000,1250}',
                '{"Costs"}',
                '{"Jan","Feb"}',
                '{700,}',
              ],
            },
          }
        : drawing
    );
    const exported = await encodeXlsx({
      ...imported,
      sheets: [
        { ...sales, metadata: { ...sales.metadata, drawings } },
        imported.sheets[1],
      ],
    });
    const chart = strFromU8(unzipSync(exported.bytes)['xl/charts/chart1.xml']);
    expect(chart).toContain('<tx><v>Revenue</v></tx>');
    expect(chart).toContain(
      '<val><numLit><formatCode>General</formatCode><ptCount val="2"/><pt idx="0"><v>1000</v></pt><pt idx="1"><v>1250</v></pt></numLit></val>'
    );
    expect(chart).toContain(
      '<cat><strLit><ptCount val="2"/><pt idx="0"><v>Jan</v></pt><pt idx="1"><v>Feb</v></pt></strLit></cat>'
    );
    const again = drawingsOf(await decodeXlsx(exported.bytes), 'Sales')[0];
    if (again.type !== 'chart') throw new Error('Expected a chart.');
    // Names written as text are names again; values and labels stay fixed.
    expect(again.chart.references).toEqual([
      '{"Jan","Feb"}',
      '{1000,1250}',
      '{"Jan","Feb"}',
      '{700,}',
    ]);
    const shown = chartData(again.chart, () => undefined);
    expect(shown.categories).toEqual(['Jan', 'Feb']);
    expect(
      shown.plots[0].series.map(({ name, values }) => ({ name, values }))
    ).toEqual([
      { name: 'Revenue', values: [1000, 1250] },
      { name: 'Costs', values: [700, null] },
    ]);
  });

  it('writes a fixed title as rich text', () => {
    const namespaces =
      'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';
    const part = chartPart(
      {
        plots: [{ kind: 'column', series: [{ nameRef: 1, values: 2 }] }],
        references: ['{"Plan"}', '{"Budget"}', '{1,2}'],
        source: `<c:chartSpace ${namespaces}><c:chart><c:title><c:tx><c:strRef><c:f>Old!$A$1</c:f></c:strRef></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Old!$B$1</c:f></c:strRef></c:tx><c:val><c:numRef><c:f>Old!$B$2:$B$3</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
      },
      () => undefined
    );
    expect(part).toContain(
      '<c:title><c:tx><c:rich xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:bodyPr/><a:p><a:r><a:t>Plan</a:t></a:r></a:p></c:rich></c:tx></c:title>'
    );
    expect(part).toContain('<c:tx><c:v>Budget</c:v></c:tx>');
    expect(part).toContain('<c:numLit>');
  });
});

describe('radar, bubble, stock and contour charts', () => {
  const cells = (column: string) => `'Data'!$${column}$2:$${column}$5`;
  /** A chart part read back as Macro reads Excel's. */
  const reread = (part: string) => {
    const path = 'xl/charts/chart1.xml';
    const warnings = new Set<string>();
    const chart = readChart(
      {
        names: [path],
        read: (name) => (name === path ? strToU8(part) : undefined),
      },
      path,
      [],
      warnings
    );
    expect([...warnings]).toEqual([]);
    return chart;
  };
  /** Series of columns after labels in column A, as Macro makes them. */
  const columns = (names: string[]) => ({
    series: names.map((column, index) => ({
      name: column,
      categories: index * 2,
      values: index * 2 + 1,
    })),
    references: names.flatMap((column) => [cells('A'), cells(column)]),
  });
  const radar = columns(['B', 'C']);
  const prices = columns(['B', 'C', 'D', 'E']);
  // Stock series have no lines of their own.
  const stock = {
    ...prices,
    series: prices.series.map((series) => ({ ...series, noLine: true })),
  };
  const surface = columns(['B', 'C']);
  const charts: SheetChart[] = [
    {
      plots: [{ kind: 'radar', filled: true, series: radar.series }],
      references: radar.references,
    },
    {
      plots: [
        { kind: 'bubble', series: [{ categories: 0, values: 1, sizes: 2 }] },
      ],
      references: [cells('A'), cells('B'), cells('C')],
    },
    {
      plots: [
        { kind: 'stock', hiLow: true, upDown: true, series: stock.series },
      ],
      references: stock.references,
    },
    {
      plots: [{ kind: 'surface', series: surface.series }],
      references: surface.references,
    },
  ];

  it('writes each kind as Excel does and reads it back unchanged', () => {
    for (const chart of charts) {
      const part = chartPart(chart, () => undefined);
      const again = reread(part);
      expect(again?.references).toEqual(chart.references);
      expect(
        again?.plots.map(({ series, ...plot }) => ({
          ...plot,
          series: series.map(({ color: _color, ...rest }) => rest),
        }))
      ).toEqual(chart.plots);
    }
    const [radar, bubble, stock, surface] = charts.map((chart) =>
      chartPart(chart, () => undefined)
    );
    expect(radar).toContain('<c:radarStyle val="filled"/>');
    expect(bubble).toContain(
      `<c:bubbleSize><c:numRef><c:f>'Data'!$C$2:$C$5</c:f></c:numRef></c:bubbleSize>`
    );
    expect(stock).toMatch(/<c:hiLowLines\/><c:upDownBars>/);
    // Excel saves a contour chart as a surface seen from above.
    expect(surface).toContain('<c:view3D><c:rotX val="90"/>');
    expect(surface).toContain('<c:serAx><c:axId val="5"/>');
  });

  it('formats axes like their cells, and spaces stock dates evenly', () => {
    const part = chartPart(charts[2], (reference) =>
      reference === cells('A')
        ? [{ text: 'Mar 4', number: 45355, format: 'mmm d' }]
        : [{ text: '$102.00', number: 102, format: '"$"#,##0.00' }]
    );
    expect(part).toContain(
      '<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="mmm d" sourceLinked="1"/>'
    );
    expect(part).toContain('<c:auto val="0"/>');
    expect(part).toContain(
      '<c:numFmt formatCode="&quot;$&quot;#,##0.00" sourceLinked="1"/>'
    );
    expect(part).toContain(
      '<c:numCache><c:formatCode>&quot;$&quot;#,##0.00</c:formatCode>'
    );
  });

  it('writes stacked, scatter, line and combo charts as Excel opens them', () => {
    const part = (chart: SheetChart) => chartPart(chart, () => undefined);
    const percent = part({
      plots: [
        {
          kind: 'bar',
          grouping: 'percentStacked',
          series: columns(['B', 'C']).series,
        },
      ],
      references: columns(['B', 'C']).references,
    });
    expect(percent).toContain(
      '<c:barDir val="bar"/><c:grouping val="percentStacked"/>'
    );
    expect(percent).toContain('formatCode="0%"');
    expect(reread(percent)?.plots[0].grouping).toBe('percentStacked');
    const stacked = part({
      plots: [
        {
          kind: 'line',
          grouping: 'stacked',
          series: columns(['B', 'C']).series,
        },
      ],
      references: columns(['B', 'C']).references,
    });
    expect(stacked).toContain('<c:grouping val="stacked"/>');
    expect(stacked).toContain('<c:marker><c:symbol val="circle"/>');
    expect(reread(stacked)?.plots[0]).toMatchObject({
      kind: 'line',
      grouping: 'stacked',
    });
    const points = part({
      plots: [
        {
          kind: 'scatter',
          series: [{ categories: 0, values: 1, noLine: true }],
        },
      ],
      references: [cells('A'), cells('B')],
    });
    expect(points).toContain('<c:scatterStyle val="marker"/>');
    expect(reread(points)?.plots[0].series[0].noLine).toBe(true);
    const combo = part({
      plots: [
        { kind: 'column', series: [columns(['B']).series[0]] },
        {
          kind: 'line',
          secondary: true,
          series: [columns(['C']).series[0]],
        },
      ],
      references: [...columns(['B']).references, ...columns(['C']).references],
    });
    expect(combo).toContain('<c:barChart>');
    expect(combo).toContain('<c:lineChart>');
    expect(combo).toContain('<c:crosses val="max"/>');
    expect(reread(combo)?.plots).toMatchObject([
      { kind: 'column' },
      { kind: 'line', secondary: true },
    ]);
  });

  it('writes a stock chart Excel cannot open as lines', () => {
    const part = chartPart(
      {
        plots: [
          {
            kind: 'stock',
            hiLow: true,
            series: [
              { categories: 0, values: 1 },
              { categories: 2, values: 3 },
            ],
          },
        ],
        references: [cells('A'), cells('B'), cells('A'), cells('C')],
      },
      () => undefined
    );
    expect(part).not.toContain('stockChart');
    expect(reread(part)?.plots[0].kind).toBe('line');
  });
});
