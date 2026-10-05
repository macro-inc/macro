import {
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';

/** Drawings a sheet holds, at most. */
export const MAX_SHEET_DRAWINGS = 200;
/** An image's encoded size, at most: about 2 MB of image data. */
export const MAX_IMAGE_URL_LENGTH = 2_800_000;
/** A chart part kept for export, at most. */
export const MAX_CHART_SOURCE_LENGTH = 400_000;
/** Fixed values a chart reference holds, at most, written out. */
export const MAX_CHART_LITERAL_LENGTH = 100_000;

/**
 * A corner of a drawing: a cell, and a distance into it in pixels at 100%
 * zoom. Drawings anchored to cells move and stretch with them.
 */
export type DrawingPoint = {
  row: number;
  column: number;
  x: number;
  y: number;
};

export const CHART_KINDS = [
  'column',
  'bar',
  'line',
  'area',
  'pie',
  'doughnut',
  'scatter',
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const CHART_GROUPINGS = [
  'clustered',
  'stacked',
  'percentStacked',
] as const;
export type ChartGrouping = (typeof CHART_GROUPINGS)[number];
export const LEGEND_POSITIONS = ['right', 'left', 'top', 'bottom'] as const;

/** Series refer to ranges by their index in the chart's `references`. */
export type ChartSeries = {
  /** The series name as Excel last showed it. */
  name?: string;
  /** The cell holding the series name. */
  nameRef?: number;
  /** Category labels, or x values of a scatter chart. */
  categories?: number;
  values: number;
  /** #RRGGBB. */
  color?: string;
  /** Bars or areas left unfilled, such as the spacers of a floating bar. */
  noFill?: boolean;
  /** A line or scatter series drawn as markers only. */
  noLine?: boolean;
};

/** Series drawn the same way, on the primary or the secondary value axis. */
export type ChartPlot = {
  kind: ChartKind;
  grouping?: ChartGrouping;
  secondary?: boolean;
  series: ChartSeries[];
};

export type SheetChart = {
  title?: string;
  legend?: (typeof LEGEND_POSITIONS)[number];
  plots: ChartPlot[];
  /**
   * Every range the chart reads, as A1 references with sheet names, or fixed
   * values written as an array constant such as `{1,2,,4}` or `{"Q1","Q2"}`.
   */
  references: string[];
  /** The workbook's theme accents, for series and slices without colors. */
  colors?: string[];
  /**
   * A pivot chart: its series are named as Excel last showed them, as its
   * pivot table names them rather than its cells.
   */
  pivot?: true;
  /**
   * Excel's chart part without cached values, kept so export preserves its
   * formatting. Its data sources (`numRef`, `strRef`, `multiLvlStrRef`,
   * `numLit` and `strLit`) are `references`, in order.
   */
  source?: string;
};

/** A cell's value as charts read it: its displayed text, and its number. */
export type ChartValue = { text: string; number?: number };

/** Whether a chart reference holds fixed values rather than cells. */
export const isChartLiteral = (reference: string) =>
  reference.trimStart().startsWith('{');

/**
 * Fixed values as a chart keeps them: numbers, quoted text (`""` for a
 * quote) and nothing for a blank, as in `{1,"two",,4}`.
 */
export function chartLiteral(
  values: ChartValue[],
  kind: 'number' | 'text'
): string {
  return `{${values
    .map((value) =>
      kind === 'number'
        ? value.number !== undefined && Number.isFinite(value.number)
          ? String(value.number)
          : ''
        : value.text === ''
          ? ''
          : `"${value.text.replace(/"/g, '""')}"`
    )
    .join(',')}}`;
}

/** The values of a fixed chart reference, or undefined if it is not one. */
export function parseChartLiteral(reference: string): ChartValue[] | undefined {
  const text = reference.trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return;
  const end = text.length - 1;
  const values: ChartValue[] = [];
  if (end === 1) return values;
  let index = 1;
  for (;;) {
    if (text[index] === '"') {
      let value = '';
      index++;
      for (;;) {
        if (index >= end) return;
        if (text[index] !== '"') value += text[index++];
        else if (text[index + 1] === '"') {
          value += '"';
          index += 2;
        } else break;
      }
      index++;
      values.push({ text: value });
    } else {
      let token = '';
      while (index < end && text[index] !== ',') token += text[index++];
      token = token.trim();
      const number = Number(token);
      if (token !== '' && !Number.isFinite(number)) return;
      values.push(token === '' ? { text: '' } : { text: token, number });
    }
    if (index === end) return values;
    if (text[index] !== ',') return;
    index++;
  }
}

type DrawingBase = {
  id: string;
  name?: string;
  from: DrawingPoint;
  /** The opposite corner of a drawing that stretches with its cells. */
  to?: DrawingPoint;
  /** The size in pixels of a drawing anchored by one corner. */
  width?: number;
  height?: number;
};

export type SheetDrawing = DrawingBase &
  (
    | {
        type: 'image';
        /** The key of the image in the workbook's images. */
        image: string;
        description?: string;
      }
    | { type: 'chart'; chart: SheetChart }
  );

/** Where a drawing is anchored: a corner and a size, or two corners. */
export type DrawingPlacement = Pick<
  SheetDrawing,
  'from' | 'to' | 'width' | 'height'
>;

const IMAGE_URL =
  /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+=*$/;

/** A stored image: a base64 data URL of a format browsers display. */
export function validImageUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_IMAGE_URL_LENGTH &&
    IMAGE_URL.test(value)
  );
}

/** Image keys are content hashes, so equal images are stored once. */
export const validImageKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);

const text = (value: unknown, limit: number) =>
  value === undefined || (typeof value === 'string' && value.length <= limit);
const color = (value: unknown) =>
  value === undefined ||
  (typeof value === 'string' && /^#[0-9A-F]{6}$/i.test(value));
const pixels = (value: unknown) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100_000;

function validPoint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return (
    Object.keys(point).every((key) =>
      ['row', 'column', 'x', 'y'].includes(key)
    ) &&
    Number.isInteger(point.row) &&
    (point.row as number) >= 0 &&
    (point.row as number) < SPREADSHEET_MAX_ROWS &&
    Number.isInteger(point.column) &&
    (point.column as number) >= 0 &&
    (point.column as number) < SPREADSHEET_MAX_COLUMNS &&
    pixels(point.x) &&
    pixels(point.y)
  );
}

function validSeries(value: unknown, references: number): boolean {
  if (!value || typeof value !== 'object') return false;
  const series = value as Record<string, unknown>;
  const reference = (index: unknown) =>
    Number.isInteger(index) &&
    (index as number) >= 0 &&
    (index as number) < references;
  return (
    Object.keys(series).every((key) =>
      [
        'name',
        'nameRef',
        'categories',
        'values',
        'color',
        'noFill',
        'noLine',
      ].includes(key)
    ) &&
    (series.noFill === undefined || series.noFill === true) &&
    (series.noLine === undefined || series.noLine === true) &&
    text(series.name, 1_000) &&
    (series.nameRef === undefined || reference(series.nameRef)) &&
    (series.categories === undefined || reference(series.categories)) &&
    reference(series.values) &&
    color(series.color)
  );
}

function validPlot(value: unknown, references: number): boolean {
  if (!value || typeof value !== 'object') return false;
  const plot = value as Record<string, unknown>;
  return (
    Object.keys(plot).every((key) =>
      ['kind', 'grouping', 'secondary', 'series'].includes(key)
    ) &&
    (CHART_KINDS as readonly unknown[]).includes(plot.kind) &&
    (plot.grouping === undefined ||
      (CHART_GROUPINGS as readonly unknown[]).includes(plot.grouping)) &&
    (plot.secondary === undefined || typeof plot.secondary === 'boolean') &&
    Array.isArray(plot.series) &&
    plot.series.length <= 255 &&
    plot.series.every((series) => validSeries(series, references))
  );
}

function validChart(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const chart = value as Record<string, unknown>;
  const references = chart.references;
  return (
    Object.keys(chart).every((key) =>
      [
        'title',
        'legend',
        'plots',
        'references',
        'colors',
        'pivot',
        'source',
      ].includes(key)
    ) &&
    (chart.pivot === undefined || chart.pivot === true) &&
    text(chart.title, 1_000) &&
    (chart.legend === undefined ||
      (LEGEND_POSITIONS as readonly unknown[]).includes(chart.legend)) &&
    Array.isArray(references) &&
    references.length <= 2_000 &&
    references.every(
      (reference) =>
        typeof reference === 'string' &&
        reference.length <=
          (isChartLiteral(reference) ? MAX_CHART_LITERAL_LENGTH : 1_000)
    ) &&
    Array.isArray(chart.plots) &&
    chart.plots.length <= 16 &&
    chart.plots.every((plot) => validPlot(plot, references.length)) &&
    (chart.colors === undefined ||
      (Array.isArray(chart.colors) &&
        chart.colors.length <= 12 &&
        chart.colors.every((value) => color(value)))) &&
    text(chart.source, MAX_CHART_SOURCE_LENGTH)
  );
}

function validDrawing(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const drawing = value as Record<string, unknown>;
  const shared = ['id', 'name', 'from', 'to', 'width', 'height', 'type'];
  const allowed =
    drawing.type === 'image'
      ? [...shared, 'image', 'description']
      : [...shared, 'chart'];
  return (
    Object.keys(drawing).every((key) => allowed.includes(key)) &&
    typeof drawing.id === 'string' &&
    drawing.id.length > 0 &&
    drawing.id.length <= 64 &&
    text(drawing.name, 256) &&
    validPoint(drawing.from) &&
    (drawing.to === undefined
      ? pixels(drawing.width) && pixels(drawing.height)
      : validPoint(drawing.to) &&
        drawing.width === undefined &&
        drawing.height === undefined) &&
    (drawing.type === 'image'
      ? validImageKey(drawing.image) && text(drawing.description, 1_000)
      : drawing.type === 'chart' && validChart(drawing.chart))
  );
}

export function validDrawings(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SHEET_DRAWINGS &&
    new Set(value.map((drawing) => drawing?.id)).size === value.length &&
    value.every(validDrawing)
  );
}

export type ChartRange = {
  /** The sheet name, unquoted; undefined for the chart's own sheet. */
  sheet?: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
};

const CHART_REFERENCE =
  /^(?:(?:'((?:[^']|'')+)'|([^'!:\s()]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i;

function columnIndex(letters: string): number {
  let column = 0;
  for (const letter of letters.toUpperCase())
    column = column * 26 + letter.charCodeAt(0) - 64;
  return column - 1;
}

/**
 * A chart reference's sheet and cells: `'Sales 2024'!$B$2:$B$13` or
 * `Sheet1!C4`. Undefined for names and unions, which charts resolve
 * otherwise.
 */
export function parseChartReference(reference: string): ChartRange | undefined {
  const match = CHART_REFERENCE.exec(reference.trim());
  if (!match) return;
  const [, quoted, bare, column1, row1, column2 = column1, row2 = row1] = match;
  const rows = [Number(row1) - 1, Number(row2) - 1];
  const columns = [columnIndex(column1), columnIndex(column2)];
  if (rows.some((row) => row < 0 || row >= SPREADSHEET_MAX_ROWS)) return;
  if (columns.some((column) => column < 0 || column >= SPREADSHEET_MAX_COLUMNS))
    return;
  return {
    sheet: quoted?.replace(/''/g, "'") ?? bare,
    top: Math.min(...rows),
    bottom: Math.max(...rows),
    left: Math.min(...columns),
    right: Math.max(...columns),
  };
}
