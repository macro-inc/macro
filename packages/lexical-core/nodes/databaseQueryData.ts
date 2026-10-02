/**
 * The saved form of a document's database question, shared by every
 * reader of documents. Free of Lexical so services can parse it too.
 */

import { decodeHtmlEntities } from '../utils/html-entities';

export const DATABASE_QUERY_CHART_MODES = [
  'bar',
  'line',
  'area',
  'scatter',
  'pie',
] as const;
export type DatabaseQueryChartMode =
  (typeof DATABASE_QUERY_CHART_MODES)[number];

export const DATABASE_QUERY_DISPLAY_MODES = [
  'scalar',
  'table',
  ...DATABASE_QUERY_CHART_MODES,
] as const;
export type DatabaseQueryDisplayMode =
  (typeof DATABASE_QUERY_DISPLAY_MODES)[number];

/** Most `y` columns one chart draws. */
export const DATABASE_QUERY_MAX_SERIES = 5;

/** Column aliases and plain choices; never renderer options. */
export type DatabaseQueryChart = {
  x: string;
  y: string[];
  title?: string;
  /** A column whose values split the one `y` series into groups. */
  color?: string;
  /** Stack bar or area series instead of grouping or overlapping them. */
  stack?: boolean;
};

/** Points at an immutable saved query; the SQL lives on the server. */
export type DatabaseQueryData = {
  /** Empty while the question is still a draft. */
  queryId: string;
  databaseId?: string;
  /** Default subject for new questions; the saved SQL remains the source. */
  tableId?: string;
  prompt: string;
  title?: string;
  displayMode: DatabaseQueryDisplayMode;
  chart?: DatabaseQueryChart;
  /** Preferred height of the embedded results viewport, in pixels. */
  height?: number;
};

export function isDatabaseQueryChartMode(
  value: unknown
): value is DatabaseQueryChartMode {
  return DATABASE_QUERY_CHART_MODES.some((mode) => mode === value);
}

export function isDatabaseQueryDisplayMode(
  value: unknown
): value is DatabaseQueryDisplayMode {
  return DATABASE_QUERY_DISPLAY_MODES.some((mode) => mode === value);
}

const isOptionalString = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const isNonEmptyName = (name: unknown): name is string =>
  typeof name === 'string' && !!name.trim();

/** `null` reads as absent, as a model following the prompt emits it. */
const absentIfNull = (value: unknown) => (value === null ? undefined : value);

export function parseDatabaseQueryChart(
  value: unknown
): DatabaseQueryChart | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const { x, y } = record;
  const title = absentIfNull(record.title);
  const color = absentIfNull(record.color);
  const stack = absentIfNull(record.stack);
  if (
    !isNonEmptyName(x) ||
    !Array.isArray(y) ||
    !y.length ||
    y.length > DATABASE_QUERY_MAX_SERIES ||
    !y.every(isNonEmptyName) ||
    new Set(y).size !== y.length ||
    y.includes(x) ||
    !isOptionalString(title)
  )
    return;
  if (!isOptionalString(color) || color?.trim() === '') return;
  if (
    color !== undefined &&
    (color === x || y.length !== 1 || y.includes(color))
  )
    return;
  if (stack !== undefined && typeof stack !== 'boolean') return;
  return {
    x,
    y: [...y],
    ...(title ? { title } : {}),
    ...(color ? { color } : {}),
    ...(stack ? { stack: true } : {}),
  };
}

/** Only query source is serialized. Results belong to the current viewer. */
export function parseDatabaseQueryData(
  value: unknown
): DatabaseQueryData | undefined {
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const { queryId, databaseId, tableId, prompt, displayMode } = record;
  const title = absentIfNull(record.title);
  const chart = absentIfNull(record.chart);
  const height = absentIfNull(record.height);
  if (
    typeof queryId !== 'string' ||
    typeof prompt !== 'string' ||
    !isOptionalString(databaseId) ||
    !isOptionalString(tableId) ||
    !isOptionalString(title) ||
    (height !== undefined &&
      (typeof height !== 'number' ||
        !Number.isFinite(height) ||
        height < 96 ||
        height > 1600)) ||
    !isDatabaseQueryDisplayMode(displayMode)
  )
    return;
  const parsedChart =
    chart === undefined ? undefined : parseDatabaseQueryChart(chart);
  if (chart !== undefined && !parsedChart) return;
  // Models write `&` in a title as `&amp;`, as they do in prose, which reads it as `&`.
  return {
    queryId,
    ...(databaseId ? { databaseId } : {}),
    ...(tableId ? { tableId } : {}),
    ...(title ? { title: decodeHtmlEntities(title) } : {}),
    prompt: decodeHtmlEntities(prompt),
    displayMode,
    ...(parsedChart ? { chart: parsedChart } : {}),
    ...(typeof height === 'number' ? { height } : {}),
  };
}
