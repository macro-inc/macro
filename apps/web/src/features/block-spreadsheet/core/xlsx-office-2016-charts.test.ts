import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type {
  SheetChart,
  SheetDrawing,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type ChartReader, chartData } from './chart-data';
import { chartScene } from './chart-scene';
import { formatCellAddress } from './spreadsheet-document';
import type { WorkbookFileData } from './workbook-file-types';
import { decodeXlsx, encodeXlsx } from './xlsx-codec';
import { chartPart, drawingPart, readChart } from './xlsx-drawings';

const fixture = () =>
  new Uint8Array(
    readFileSync(
      createRequire(import.meta.url).resolve(
        './xlsx-fixtures/office-2016-charts.xlsx'
      )
    )
  );

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
        values.push({ text, ...(Number.isFinite(number) && { number }) });
      }
    return values;
  };
}

const charts = (workbook: WorkbookFileData, name: string) =>
  (
    workbook.sheets.find((sheet) => sheet.name === name)?.metadata?.drawings ??
    []
  ).flatMap((drawing) => (drawing.type === 'chart' ? [drawing.chart] : []));

/** What a chart is, without the part kept for export or theme colors. */
const described = ({
  source: _source,
  colors: _colors,
  ...chart
}: SheetChart) => chart;

describe('Excel 2016 charts', () => {
  it('imports each kind from its chartEx part instead of the fallback', async () => {
    const workbook = await decodeXlsx(fixture());
    expect(workbook.warnings).toEqual([]);
    expect(charts(workbook, 'Scores').map(described)).toEqual([
      {
        title: 'Scores',
        plots: [
          {
            kind: 'histogram',
            binning: { size: 10 },
            gapWidth: 0,
            series: [{ name: 'Score', nameRef: 1, values: 0 }],
          },
        ],
        references: ['Scores!$A$2:$A$16', 'Scores!$A$1'],
      },
    ]);
    expect(charts(workbook, 'Defects').map(described)).toEqual([
      {
        title: 'Defects',
        plots: [
          {
            kind: 'pareto',
            aggregate: true,
            gapWidth: 0,
            series: [{ name: 'Count', nameRef: 2, categories: 0, values: 1 }],
          },
        ],
        references: ['Defects!$A$2:$A$6', 'Defects!$B$2:$B$6', 'Defects!$B$1'],
      },
    ]);
    const [waterfall] = charts(workbook, 'Cash');
    expect(waterfall.legend).toBe('top');
    expect(waterfall.plots).toEqual([
      {
        kind: 'waterfall',
        totals: [5],
        labels: true,
        gapWidth: 50,
        series: [{ name: 'Amount', nameRef: 2, categories: 0, values: 1 }],
      },
    ]);
    expect(charts(workbook, 'Pipeline')[0].plots[0]).toMatchObject({
      kind: 'funnel',
      labels: true,
      gapWidth: 6,
    });
    expect(charts(workbook, 'Times')[0].plots[0]).toEqual({
      kind: 'boxWhisker',
      gapWidth: 50,
      series: [{ name: 'Minutes', nameRef: 2, categories: 0, values: 1 }],
    });
    const [treemap, sunburst] = charts(workbook, 'Stores');
    expect(treemap.legend).toBe('right');
    expect(treemap.plots[0]).toMatchObject({
      kind: 'treemap',
      parentLabels: 'banner',
    });
    expect(sunburst.plots[0].kind).toBe('sunburst');
    expect(treemap.references[0]).toBe('Stores!$A$2:$B$6');
    const [pieOfPie, barOfPie] = charts(workbook, 'Share');
    expect(pieOfPie.plots[0]).toMatchObject({
      kind: 'pie',
      ofPie: { type: 'pie', split: 'position', splitAt: 3, size: 75 },
    });
    expect(barOfPie.plots[0]).toMatchObject({
      kind: 'pie',
      ofPie: { type: 'bar', split: 'value', splitAt: 10, size: 75 },
    });
  });

  it('draws imported charts from their cells', async () => {
    const workbook = await decodeXlsx(fixture());
    const data = (sheet: string, index: number) =>
      chartData(charts(workbook, sheet)[index], reader(workbook, sheet));
    const stores = data('Stores', 0);
    expect(stores.paths).toEqual([
      ['North', 'Downtown'],
      ['', 'Airport'],
      ['South', 'Harbor'],
      ['', 'Mall'],
      ['West', ''],
    ]);
    const tips = (shapes: ReturnType<typeof chartScene>['shapes']) =>
      shapes.flatMap((shape) =>
        'tip' in shape && shape.tip ? [shape.tip] : []
      );
    expect(tips(chartScene(stores, 480, 288).shapes)).toEqual(
      expect.arrayContaining([
        'North: 50',
        'North › Airport: 20',
        'South › Mall: 15',
        'West: 10',
      ])
    );
    expect(tips(chartScene(data('Cash', 0), 480, 288).shapes)).toEqual(
      expect.arrayContaining(['Start: 100', 'Costs: -50', 'End: 115'])
    );
    expect(tips(chartScene(data('Times', 0), 480, 288).shapes)).toEqual(
      expect.arrayContaining(['Minutes · East: 41'])
    );
    expect(tips(chartScene(data('Scores', 0), 480, 288).shapes)).toEqual(
      expect.arrayContaining(['[52, 62]: 3', '(62, 72]: 5', '(92, 102]: 1'])
    );
  });

  it('exports chartEx parts behind a fallback, which import again unchanged', async () => {
    const workbook = await decodeXlsx(fixture());
    const exported = await encodeXlsx(workbook);
    expect(exported.warnings).toEqual([]);
    const files = unzipSync(exported.bytes);
    const names = Object.keys(files).filter((name) =>
      name.startsWith('xl/charts/')
    );
    expect(names.filter((name) => name.includes('chartEx'))).toHaveLength(7);
    const types = strFromU8(files['[Content_Types].xml']);
    expect(types).toContain(
      '<Override PartName="/xl/charts/chartEx7.xml" ContentType="application/vnd.ms-office.chartex+xml"/>'
    );
    const drawing = strFromU8(files['xl/drawings/drawing1.xml']);
    expect(drawing).toContain('<mc:Choice xmlns:cx1=');
    expect(drawing).toContain('<mc:Fallback>');
    expect(strFromU8(files['xl/drawings/_rels/drawing1.xml.rels'])).toContain(
      'Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"'
    );
    // The kept part carries caches of the cells' current values.
    const histogram = strFromU8(files['xl/charts/chartEx1.xml']);
    expect(histogram).toContain(
      '<cx:f>Scores!$A$2:$A$16</cx:f><cx:lvl ptCount="15" formatCode="General"><cx:pt idx="0">52</cx:pt>'
    );
    const again = await decodeXlsx(exported.bytes);
    expect(again.warnings).toEqual([]);
    for (const sheet of workbook.sheets)
      expect(charts(again, sheet.name).map(described)).toEqual(
        charts(workbook, sheet.name).map(described)
      );
  });

  it('writes each kind it describes as Excel does and reads it back unchanged', () => {
    const cells = (range: string) => `'Data'!${range}`;
    const series = [{ nameRef: 2, categories: 0, values: 1 }];
    const references = [cells('$A$2:$A$9'), cells('$B$2:$B$9'), cells('$B$1')];
    // A `c:` series names itself before its data.
    const pieSeries = [{ nameRef: 0, categories: 1, values: 2 }];
    const pieReferences = [references[2], references[0], references[1]];
    const kinds: SheetChart[] = [
      {
        plots: [
          {
            kind: 'histogram',
            binning: { count: 4, underflow: 2, overflow: 9, closedLeft: true },
            series: [{ nameRef: 1, values: 0 }],
          },
        ],
        references: references.slice(1),
      },
      {
        plots: [
          {
            kind: 'pareto',
            binning: { size: 5 },
            series: [{ nameRef: 1, values: 0 }],
          },
        ],
        references: references.slice(1),
      },
      {
        title: 'Cash',
        legend: 'bottom',
        plots: [
          {
            kind: 'waterfall',
            totals: [0, 7],
            labels: true,
            noConnectors: true,
            series,
          },
        ],
        references,
      },
      { plots: [{ kind: 'funnel', labels: true, series }], references },
      {
        plots: [
          {
            kind: 'boxWhisker',
            quartiles: 'inclusive',
            meanLine: true,
            noMeanMarkers: true,
            innerPoints: true,
            noOutliers: true,
            series,
          },
        ],
        references,
      },
      {
        plots: [{ kind: 'treemap', parentLabels: 'none', series }],
        references: [cells('$A$2:$B$9'), cells('$C$2:$C$9'), cells('$C$1')],
      },
      { plots: [{ kind: 'sunburst', series }], references },
      {
        plots: [
          {
            kind: 'pie',
            ofPie: { type: 'bar', split: 'custom', custom: [1, 3], size: 50 },
            series: pieSeries,
          },
        ],
        references: pieReferences,
      },
      {
        plots: [{ kind: 'pie', ofPie: { type: 'pie' }, series: pieSeries }],
        references: pieReferences,
      },
    ];
    for (const chart of kinds) {
      const part = chartPart(chart, () => undefined);
      const path = part.includes('<cx:chartSpace')
        ? 'xl/charts/chartEx1.xml'
        : 'xl/charts/chart1.xml';
      const warnings = new Set<string>();
      const again = readChart(
        {
          names: [path],
          read: (name) => (name === path ? strToU8(part) : undefined),
        },
        path,
        [],
        warnings
      );
      expect([...warnings]).toEqual([]);
      expect(again && described(again)).toEqual({
        ...chart,
        plots: chart.plots.map((plot) => ({
          ...plot,
          // Excel saves its default gaps.
          ...(plot.kind === 'histogram' || plot.kind === 'pareto'
            ? { gapWidth: 0 }
            : plot.kind === 'waterfall'
              ? { gapWidth: 50 }
              : plot.kind === 'boxWhisker'
                ? { gapWidth: 100 }
                : plot.kind === 'funnel'
                  ? { gapWidth: 6 }
                  : {}),
        })),
      });
    }
  });

  it('wraps a chartEx frame in compatibility content', () => {
    const drawing: SheetDrawing = {
      id: 'chart',
      type: 'chart',
      name: 'Pipeline',
      from: { row: 0, column: 4, x: 0, y: 0 },
      width: 480,
      height: 288,
      chart: {
        plots: [{ kind: 'funnel', series: [{ values: 0 }] }],
        references: ["'Data'!$B$2:$B$5"],
      },
    };
    const part = drawingPart({
      drawings: [drawing],
      image: () => undefined,
      chart: () => 'xl/charts/chartEx1.xml',
      size: () => ({ width: 480, height: 288 }),
      origin: () => ({ x: 0, y: 0 }),
    });
    // Funnels need Excel's 2016 chartEx revision two.
    expect(part?.xml).toContain(
      '<mc:Choice xmlns:cx2="http://schemas.microsoft.com/office/drawing/2015/10/21/chartex" Requires="cx2">'
    );
    expect(part?.xml).toContain(
      '<a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" r:id="rId1"/>'
    );
    expect(part?.rels).toContain(
      'Type="http://schemas.microsoft.com/office/2014/relationships/chartEx" Target="../charts/chartEx1.xml"'
    );
  });
});
