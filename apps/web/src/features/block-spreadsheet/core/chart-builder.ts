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

/** Chart types Macro creates and edits, with their Excel grouping. */
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
  { id: 'line', label: 'Line', kind: 'line' },
  { id: 'area', label: 'Area', kind: 'area' },
  {
    id: 'area-stacked',
    label: 'Stacked area',
    kind: 'area',
    grouping: 'stacked',
  },
  { id: 'pie', label: 'Pie', kind: 'pie' },
  { id: 'doughnut', label: 'Doughnut', kind: 'doughnut' },
  { id: 'scatter', label: 'Scatter', kind: 'scatter' },
] as const satisfies readonly {
  id: string;
  label: string;
  kind: ChartKind;
  grouping?: ChartGrouping;
}[];
export type ChartTypeId = (typeof CHART_TYPES)[number]['id'];

/** The type a chart's first plot shows, as Macro offers it. */
export function chartType(chart: SheetChart): ChartTypeId | undefined {
  const plot = chart.plots[0];
  return CHART_TYPES.find(
    (type) =>
      type.kind === plot?.kind &&
      ('grouping' in type ? type.grouping : undefined) ===
        (plot.grouping === 'clustered' ? undefined : plot.grouping)
  )?.id;
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
  value: (row: number, column: number) => CellValue
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
  return {
    range,
    orientation: dataRows >= dataColumns ? 'columns' : 'rows',
    firstRow,
    firstColumn,
  };
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
  const definition = CHART_TYPES.find((entry) => entry.id === type);
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
  const count =
    orientation === 'columns'
      ? range.right - dataLeft + 1
      : range.bottom - dataTop + 1;
  // Pie and doughnut charts show one series.
  const shown =
    definition.kind === 'pie' || definition.kind === 'doughnut'
      ? 1
      : Math.min(count, 255);
  const colors = previous?.plots.flatMap((plot) =>
    plot.series.map((value) => value.color)
  );
  for (let index = 0; index < shown; index++) {
    const name =
      orientation === 'columns'
        ? firstRow && {
            top: range.top,
            bottom: range.top,
            left: dataLeft + index,
            right: dataLeft + index,
          }
        : firstColumn && {
            top: dataTop + index,
            bottom: dataTop + index,
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
    const values =
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
    const color = colors?.[index];
    series.push({
      ...(name && { nameRef: add(name) }),
      ...(labels && { categories: add(labels) }),
      values: add(values),
      ...(color && { color }),
    });
  }
  const plot: ChartPlot = {
    kind: definition.kind,
    ...('grouping' in definition && { grouping: definition.grouping }),
    series,
  };
  return {
    ...(previous?.title && { title: previous.title }),
    ...(previous
      ? previous.legend && { legend: previous.legend }
      : (series.length > 1 ||
          definition.kind === 'pie' ||
          definition.kind === 'doughnut') && { legend: 'bottom' as const }),
    plots: [plot],
    references,
    ...(previous?.colors && { colors: previous.colors }),
  };
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

/** A chart with another type for each of its plots, keeping its data. */
export function withChartType(
  chart: SheetChart,
  type: ChartTypeId
): SheetChart {
  const definition = CHART_TYPES.find((entry) => entry.id === type);
  if (!definition) return chart;
  const round = definition.kind === 'pie' || definition.kind === 'doughnut';
  return {
    ...chart,
    plots: chart.plots.slice(0, round ? 1 : chart.plots.length).map((plot) => ({
      kind: definition.kind,
      ...('grouping' in definition && { grouping: definition.grouping }),
      ...(!round && plot.secondary && { secondary: true }),
      series: round ? plot.series.slice(0, 1) : plot.series,
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
