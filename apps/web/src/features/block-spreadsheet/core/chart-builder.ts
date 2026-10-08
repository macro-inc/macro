import {
  type ChartGrouping,
  type ChartKind,
  type ChartPlot,
  type ChartRange,
  type ChartSeries,
  isChartLiteral,
  parseChartReference,
  type SheetChart,
} from '@macro-inc/spreadsheet/sheet-drawings';
import { formatCellAddress } from './spreadsheet-document';

/**
 * Chart types Macro creates and edits, with their Excel grouping. Types
 * marked `more` are offered after the common ones.
 */
export const CHART_TYPES = [
  { id: 'column', label: 'Column', kind: 'column' },
  {
    id: 'column-stacked',
    label: 'Stacked column',
    kind: 'column',
    grouping: 'stacked',
  },
  {
    id: 'column-percent',
    label: '100% stacked column',
    kind: 'column',
    grouping: 'percentStacked',
  },
  { id: 'bar', label: 'Bar', kind: 'bar' },
  { id: 'bar-stacked', label: 'Stacked bar', kind: 'bar', grouping: 'stacked' },
  {
    id: 'bar-percent',
    label: '100% stacked bar',
    kind: 'bar',
    grouping: 'percentStacked',
    catalog: true,
  },
  { id: 'line', label: 'Line', kind: 'line' },
  {
    id: 'line-stacked',
    label: 'Stacked line',
    kind: 'line',
    grouping: 'stacked',
    catalog: true,
  },
  {
    id: 'line-percent',
    label: '100% stacked line',
    kind: 'line',
    grouping: 'percentStacked',
    catalog: true,
  },
  { id: 'area', label: 'Area', kind: 'area' },
  {
    id: 'area-stacked',
    label: 'Stacked area',
    kind: 'area',
    grouping: 'stacked',
  },
  {
    id: 'area-percent',
    label: '100% stacked area',
    kind: 'area',
    grouping: 'percentStacked',
    catalog: true,
  },
  { id: 'pie', label: 'Pie', kind: 'pie' },
  { id: 'doughnut', label: 'Doughnut', kind: 'doughnut' },
  { id: 'scatter', label: 'Scatter', kind: 'scatter' },
  // Columns for every series but the last, which is a line on its own axis.
  { id: 'combo', label: 'Combo', kind: 'column', combo: true, catalog: true },
  { id: 'radar', label: 'Radar', kind: 'radar', more: true },
  {
    id: 'radar-filled',
    label: 'Filled radar',
    kind: 'radar',
    filled: true,
    more: true,
  },
  { id: 'bubble', label: 'Bubble', kind: 'bubble', more: true },
  { id: 'stock', label: 'Stock', kind: 'stock', more: true },
  { id: 'contour', label: 'Contour', kind: 'surface', more: true },
] as const satisfies readonly {
  id: string;
  label: string;
  kind: ChartKind;
  grouping?: ChartGrouping;
  filled?: true;
  /** Columns plus a line on the secondary axis. */
  combo?: true;
  /**
   * Listed in Edit chart. Kept out of the insert menu so that menu, and its
   * submenu, still fit on screen.
   */
  catalog?: true;
  more?: true;
}[];
export type ChartTypeId = (typeof CHART_TYPES)[number]['id'];
type ChartType = (typeof CHART_TYPES)[number];

const definitionOf = (type: ChartTypeId): ChartType | undefined =>
  CHART_TYPES.find((entry) => entry.id === type);
const groupingOf = (type: ChartType) =>
  'grouping' in type ? type.grouping : undefined;
const filledOf = (type: ChartType) => 'filled' in type && type.filled;
const comboOf = (type: ChartType) => 'combo' in type && type.combo;
/** Kinds whose series all belong in one plot. */
const SINGLE_PLOT: readonly ChartKind[] = [
  'radar',
  'bubble',
  'stock',
  'surface',
];
const isRound = (kind: ChartKind) => kind === 'pie' || kind === 'doughnut';
/** Kinds that plot numbers on both axes. */
const isXy = (kind: ChartKind) => kind === 'scatter' || kind === 'bubble';

/** Columns together with a line, as a combination chart. */
function isCombo(chart: SheetChart): boolean {
  return (
    chart.plots.length > 1 &&
    chart.plots.every(
      (plot) => plot.kind === 'column' || plot.kind === 'line'
    ) &&
    chart.plots.some((plot) => plot.kind === 'column') &&
    chart.plots.some((plot) => plot.kind === 'line')
  );
}

/** The type a chart's first plot shows, as Macro offers it. */
export function chartType(chart: SheetChart): ChartTypeId | undefined {
  if (isCombo(chart)) return 'combo';
  const plot = chart.plots[0];
  return CHART_TYPES.find(
    (type) =>
      !comboOf(type) &&
      type.kind === plot?.kind &&
      groupingOf(type) ===
        (plot.grouping === 'clustered' ? undefined : plot.grouping) &&
      filledOf(type) === !!plot.filled
  )?.id;
}

/**
 * Why charts of a type cannot show this many series, if they cannot: a
 * stock chart reads three or four, as Excel's do.
 */
export function chartTypeProblem(
  type: ChartTypeId,
  series: number
): string | undefined {
  if (definitionOf(type)?.kind === 'stock' && (series < 3 || series > 4))
    return 'A stock chart needs three or four series: high, low and close, or open, high, low and close.';
  if (type === 'combo' && series < 2)
    return 'A combo chart needs at least two series: columns, and a line on the secondary axis.';
}

export type CellBounds = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

/**
 * How a chart reads a block of cells: each series is a column or a row, and
 * the first row and first column may hold series names and category labels
 * (a scatter chart's x values).
 */
export type ChartLayout = {
  range: CellBounds;
  orientation: 'columns' | 'rows';
  firstRow: boolean;
  firstColumn: boolean;
};

/** A cell as charts read it. */
type CellValue = { text: string; number?: number } | undefined;

/**
 * The block of filled cells around a cell, as Excel charts by default: it
 * grows while a neighboring row or column has a filled cell.
 */
export function dataRegion(
  filled: (row: number, column: number) => boolean,
  start: CellBounds,
  limits: { rows: number; columns: number }
): CellBounds | undefined {
  const area = { ...start };
  const rowFilled = (row: number, from: number, to: number) => {
    for (
      let column = Math.max(0, from);
      column <= Math.min(limits.columns - 1, to);
      column++
    )
      if (filled(row, column)) return true;
    return false;
  };
  const columnFilled = (column: number, from: number, to: number) => {
    for (
      let row = Math.max(0, from);
      row <= Math.min(limits.rows - 1, to);
      row++
    )
      if (filled(row, column)) return true;
    return false;
  };
  // A selection of several cells is charted as it is.
  if (area.top !== area.bottom || area.left !== area.right) return area;
  if (
    !filled(area.top, area.left) &&
    !rowFilled(area.top - 1, area.left - 1, area.right + 1) &&
    !rowFilled(area.top + 1, area.left - 1, area.right + 1) &&
    !columnFilled(area.left - 1, area.top, area.bottom) &&
    !columnFilled(area.left + 1, area.top, area.bottom)
  )
    return;
  for (let changed = true; changed; ) {
    changed = false;
    if (
      area.top > 0 &&
      rowFilled(area.top - 1, area.left - 1, area.right + 1)
    ) {
      area.top--;
      changed = true;
    }
    if (
      area.bottom < limits.rows - 1 &&
      rowFilled(area.bottom + 1, area.left - 1, area.right + 1)
    ) {
      area.bottom++;
      changed = true;
    }
    if (
      area.left > 0 &&
      columnFilled(area.left - 1, area.top - 1, area.bottom + 1)
    ) {
      area.left--;
      changed = true;
    }
    if (
      area.right < limits.columns - 1 &&
      columnFilled(area.right + 1, area.top - 1, area.bottom + 1)
    ) {
      area.right++;
      changed = true;
    }
  }
  return area;
}

/**
 * Excel's reading of a block: text in the first column (or a blank corner)
 * makes it labels, text in the first row makes it names, and series follow
 * the longer side.
 */
export function guessLayout(
  range: CellBounds,
  value: (row: number, column: number) => CellValue,
  type?: ChartTypeId
): ChartLayout {
  const text = (row: number, column: number) => {
    const cell = value(row, column);
    return !!cell && cell.text.trim() !== '' && cell.number === undefined;
  };
  const blank = (row: number, column: number) =>
    !value(row, column)?.text.trim();
  const rows = range.bottom - range.top + 1;
  const columns = range.right - range.left + 1;
  const corner = blank(range.top, range.left);
  let firstColumn = columns > 1 && corner;
  for (let row = range.top + 1; !firstColumn && row <= range.bottom; row++)
    firstColumn = columns > 1 && text(row, range.left);
  let firstRow = rows > 1 && corner;
  for (
    let column = range.left + (firstColumn ? 1 : 0);
    !firstRow && column <= range.right;
    column++
  )
    firstRow = rows > 1 && text(range.top, column);
  const dataRows = rows - (firstRow ? 1 : 0);
  const dataColumns = columns - (firstColumn ? 1 : 0);
  const orientation = dataRows >= dataColumns ? 'columns' : 'rows';
  // Scatter and bubble charts read x values from the first column (or
  // row) even when they are numbers, as Excel does.
  const kind = type && definitionOf(type)?.kind;
  if (kind && isXy(kind)) {
    if (orientation === 'columns' && columns > 1) firstColumn = true;
    if (orientation === 'rows' && rows > 1) firstRow = true;
  }
  return { range, orientation, firstRow, firstColumn };
}

const quote = (sheet: string) => `'${sheet.replaceAll("'", "''")}'`;

function reference(sheet: string, area: CellBounds) {
  const start = formatCellAddress(area.top, area.left).replace(
    /^([A-Z]+)(\d+)$/,
    '$$$1$$$2'
  );
  const end = formatCellAddress(area.bottom, area.right).replace(
    /^([A-Z]+)(\d+)$/,
    '$$$1$$$2'
  );
  return `${quote(sheet)}!${start === end ? start : `${start}:${end}`}`;
}

/**
 * A chart of a block of cells, or undefined when the block has no values
 * beside its names and labels.
 */
export function chartFromLayout(
  type: ChartTypeId,
  sheet: string,
  layout: ChartLayout,
  previous?: SheetChart
): SheetChart | undefined {
  const definition = definitionOf(type);
  if (!definition) return;
  const { range, orientation, firstRow, firstColumn } = layout;
  const dataTop = range.top + (firstRow ? 1 : 0);
  const dataLeft = range.left + (firstColumn ? 1 : 0);
  if (dataTop > range.bottom || dataLeft > range.right) return;
  const references: string[] = [];
  const add = (area: CellBounds) => {
    references.push(reference(sheet, area));
    return references.length - 1;
  };
  const series: ChartSeries[] = [];
  const lines =
    orientation === 'columns'
      ? range.right - dataLeft + 1
      : range.bottom - dataTop + 1;
  // A bubble series reads its values and then its sizes.
  const bubble = definition.kind === 'bubble';
  const step = bubble && lines > 1 ? 2 : 1;
  const count = Math.ceil(lines / step);
  // Pie and doughnut charts show one series.
  const shown = isRound(definition.kind) ? 1 : Math.min(count, 255);
  const colors = previous?.plots.flatMap((plot) =>
    plot.series.map((value) => value.color)
  );
  /** The `index`th line of data: a column or a row of values. */
  const line = (index: number): CellBounds =>
    orientation === 'columns'
      ? {
          top: dataTop,
          bottom: range.bottom,
          left: dataLeft + index,
          right: dataLeft + index,
        }
      : {
          top: dataTop + index,
          bottom: dataTop + index,
          left: dataLeft,
          right: range.right,
        };
  for (let index = 0; index < shown; index++) {
    const at = index * step;
    const name =
      orientation === 'columns'
        ? firstRow && {
            top: range.top,
            bottom: range.top,
            left: dataLeft + at,
            right: dataLeft + at,
          }
        : firstColumn && {
            top: dataTop + at,
            bottom: dataTop + at,
            left: range.left,
            right: range.left,
          };
    const labels =
      orientation === 'columns'
        ? firstColumn && {
            top: dataTop,
            bottom: range.bottom,
            left: range.left,
            right: range.left,
          }
        : firstRow && {
            top: range.top,
            bottom: range.top,
            left: dataLeft,
            right: range.right,
          };
    const color = colors?.[index];
    series.push({
      ...(name && { nameRef: add(name) }),
      ...(labels && { categories: add(labels) }),
      values: add(line(at)),
      ...(bubble && at + 1 < lines && { sizes: add(line(at + 1)) }),
      ...(color && { color }),
      // Prices are drawn by their high-low lines and bars, not series lines.
      // A scatter chart plots markers; connecting them would invent an order.
      ...((definition.kind === 'stock' || definition.kind === 'scatter') && {
        noLine: true as const,
      }),
    });
  }
  const shell = {
    ...(previous?.title && { title: previous.title }),
    ...(previous
      ? previous.legend && { legend: previous.legend }
      : (series.length > 1 ||
          isRound(definition.kind) ||
          definition.kind === 'surface' ||
          comboOf(definition)) && { legend: 'bottom' as const }),
    references,
    ...(previous?.colors && { colors: previous.colors }),
  };
  // The last series uses its own axis, as Excel's column-and-line chart does.
  if (comboOf(definition)) {
    const line = series.at(-1);
    if (!line || series.length < 2) return;
    return {
      ...shell,
      plots: [
        { kind: 'column', series: series.slice(0, -1) },
        { kind: 'line', secondary: true, series: [line] },
      ],
    };
  }
  const plot: ChartPlot = {
    kind: definition.kind,
    ...('grouping' in definition && { grouping: definition.grouping }),
    ...(filledOf(definition) && { filled: true }),
    ...(definition.kind === 'stock' && {
      hiLow: true,
      ...(series.length === 4 && { upDown: true }),
    }),
    series,
  };
  return { ...shell, plots: [plot] };
}

/** How many series a block of cells makes in a chart of a type. */
export function layoutSeries(type: ChartTypeId, layout: ChartLayout): number {
  const { range, orientation, firstRow, firstColumn } = layout;
  const lines = Math.max(
    0,
    orientation === 'columns'
      ? range.right - range.left + 1 - (firstColumn ? 1 : 0)
      : range.bottom - range.top + 1 - (firstRow ? 1 : 0)
  );
  return definitionOf(type)?.kind === 'bubble' && lines > 1
    ? Math.ceil(lines / 2)
    : lines;
}

/**
 * The block of cells a chart reads and how, when its ranges form one block
 * on one sheet, as charts Macro makes do.
 */
export function chartLayout(
  chart: SheetChart,
  home: string
): { sheet: string; layout: ChartLayout } | undefined {
  const ranges = chart.references
    .filter((value) => !isChartLiteral(value))
    .map((value) => parseChartReference(value.replace(/^\[0\]!/, '')));
  if (!ranges.length || ranges.some((value) => !value)) return;
  const sheets = new Set(
    (ranges as ChartRange[]).map((value) => (value.sheet ?? home).toLowerCase())
  );
  if (sheets.size !== 1) return;
  const parsed = ranges as ChartRange[];
  const range = {
    top: Math.min(...parsed.map((value) => value.top)),
    left: Math.min(...parsed.map((value) => value.left)),
    bottom: Math.max(...parsed.map((value) => value.bottom)),
    right: Math.max(...parsed.map((value) => value.right)),
  };
  const all = chart.plots.flatMap((plot) => plot.series);
  const first = all[0];
  const values = first && parseChartReference(chart.references[first.values]);
  if (!values) return;
  const orientation =
    values.top === values.bottom && values.left !== values.right
      ? 'rows'
      : 'columns';
  const names = all.some((series) => series.nameRef !== undefined);
  const labels = all.some((series) => series.categories !== undefined);
  return {
    sheet: parsed[0].sheet ?? home,
    layout: {
      range,
      orientation,
      firstRow: orientation === 'columns' ? names : labels,
      firstColumn: orientation === 'columns' ? labels : names,
    },
  };
}

/**
 * A chart with another type for each of its plots, keeping its data; one
 * plot for types that combine with no other. Undefined when the type
 * cannot show the chart's series.
 */
export function withChartType(
  chart: SheetChart,
  type: ChartTypeId
): SheetChart | undefined {
  const definition = definitionOf(type);
  if (!definition) return chart;
  const kind = definition.kind;
  // Stock and scatter series have no lines of their own; other kinds draw theirs.
  const shown = (series: ChartSeries, from: ChartKind): ChartSeries => {
    if (kind === 'stock' || kind === 'scatter')
      return { ...series, noLine: true };
    if (from !== 'stock' && from !== 'scatter') return series;
    const { noLine: _noLine, ...rest } = series;
    return rest;
  };
  const all = chart.plots.flatMap((plot) =>
    plot.series.map((series) => shown(series, plot.kind))
  );
  if (chartTypeProblem(type, all.length)) return;
  if (comboOf(definition)) {
    const line = all.at(-1);
    if (!line) return;
    return {
      ...chart,
      plots: [
        { kind: 'column', series: all.slice(0, -1) },
        { kind: 'line', secondary: true, series: [line] },
      ],
    };
  }
  const flags = (count: number) => ({
    ...('grouping' in definition && { grouping: definition.grouping }),
    ...(filledOf(definition) && { filled: true as const }),
    ...(kind === 'stock' && {
      hiLow: true as const,
      ...(count === 4 && { upDown: true as const }),
    }),
  });
  if (isRound(kind))
    return {
      ...chart,
      plots: [{ kind, ...flags(1), series: all.slice(0, 1) }],
    };
  if (SINGLE_PLOT.includes(kind))
    return {
      ...chart,
      plots: [{ kind, ...flags(all.length), series: all }],
    };
  return {
    ...chart,
    plots: chart.plots.map((plot) => ({
      kind,
      ...flags(plot.series.length),
      ...(plot.secondary && { secondary: true }),
      series: plot.series.map((series) => shown(series, plot.kind)),
    })),
  };
}

/** What the chart dialog shows and changes. */
export type ChartSettings = {
  type: ChartTypeId | undefined;
  title: string;
  legend: NonNullable<SheetChart['legend']> | 'none';
  /** The cells charted, as `A1:C7` or `'Sheet'!A1:C7`; empty when they are several ranges. */
  range: string;
  orientation: ChartLayout['orientation'];
  firstRow: boolean;
  firstColumn: boolean;
};
