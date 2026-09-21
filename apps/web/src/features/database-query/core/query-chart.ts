import type { QueryAnswer } from './query';

export type QueryDisplayMode = 'scalar' | 'table' | 'bar' | 'line' | 'pie';
export type QueryChartMode = 'bar' | 'line' | 'pie';
/** Column aliases, never evaluated expressions or copied result data. */
export type QueryChartConfig = { x: string; y: string[]; title?: string };
export type QueryChartData = {
  config: QueryChartConfig;
  labels: string[];
  /** Numeric and ISO date axes preserve unequal distances between points. */
  positions?: number[];
  series: { name: string; values: (number | null)[] }[];
};

export function isChartMode(mode: string | undefined): mode is QueryChartMode {
  return mode === 'bar' || mode === 'line' || mode === 'pie';
}

export function parseQueryChart(value: unknown): QueryChartConfig | undefined {
  if (!value || typeof value !== 'object') return;
  const chart = value as Record<string, unknown>;
  if (
    typeof chart.x !== 'string' ||
    !chart.x.trim() ||
    !Array.isArray(chart.y) ||
    !chart.y.length ||
    chart.y.length > 5 ||
    !chart.y.every((name) => typeof name === 'string' && name.trim()) ||
    new Set(chart.y).size !== chart.y.length ||
    chart.y.includes(chart.x) ||
    (chart.title !== undefined && typeof chart.title !== 'string')
  )
    return;
  return {
    x: chart.x,
    y: [...chart.y],
    ...(chart.title ? { title: chart.title as string } : {}),
  };
}

function numeric(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

/** Validate the actual answer before drawing: missing values are gaps, never zeroes. */
export function prepareQueryChart(
  answer: QueryAnswer,
  mode: QueryChartMode,
  requested?: QueryChartConfig
): { data: QueryChartData; error?: never } | { data?: never; error: string } {
  const result = answer.results[0];
  if (answer.results.length !== 1 || !result || result.columns.length < 2)
    return {
      error:
        'A chart needs one result with a label column and a number column.',
    };
  if (!result.rows.length)
    return { error: 'There are no matching records to chart.' };
  const names = result.columns.map((column) => column.name);
  const inferred = names.slice(1).filter((_, index) => {
    const values = result.rows.map((row) => numeric(row[index + 1]));
    return (
      values.some((value) => typeof value === 'number') &&
      values.every((value) => value !== undefined)
    );
  });
  const config = requested ?? {
    x: names[0],
    y: inferred.slice(0, mode === 'pie' ? 1 : 5),
  };
  if (
    !parseQueryChart(config) ||
    [config.x, ...config.y].some(
      (name) => names.filter((candidate) => candidate === name).length !== 1
    )
  )
    return {
      error:
        'This chart’s columns are unavailable. Update the question or view the result table.',
    };
  if (result.rows.length > (mode === 'pie' ? 20 : 300))
    return {
      error:
        mode === 'pie'
          ? 'This result has more than 20 categories. Choose Bar or ask for fewer groups.'
          : 'This result has more than 300 points. Ask for a summary or a smaller date range.',
    };
  const series = config.y.map((name) => ({
    name,
    values: result.rows.map((row) => numeric(row[names.indexOf(name)])),
  }));
  if (series.some((entry) => entry.values.some((value) => value === undefined)))
    return {
      error:
        'A chart needs numeric values. View the table or ask for a numeric summary.',
    };
  if (
    !series.some((entry) =>
      entry.values.some((value) => typeof value === 'number')
    )
  )
    return { error: 'There are no numeric values to chart.' };
  if (
    mode === 'pie' &&
    (series.length !== 1 ||
      series[0].values.some(
        (value) => value !== null && value !== undefined && value < 0
      ))
  )
    return {
      error:
        'A pie chart needs one series of nonnegative values. Choose Bar to compare these values.',
    };
  if (
    mode === 'pie' &&
    !series[0].values.some(
      (value) => value !== null && value !== undefined && value > 0
    )
  )
    return { error: 'A pie chart needs at least one value greater than zero.' };
  const categories = result.rows.map((row) => row[names.indexOf(config.x)]);
  const positions = categories.every(
    (value) => typeof value === 'number' && Number.isFinite(value)
  )
    ? (categories as number[])
    : categories.every(
          (value) =>
            typeof value === 'string' &&
            /^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/.test(value) &&
            Number.isFinite(Date.parse(value))
        )
      ? categories.map((value) => Date.parse(String(value)))
      : undefined;
  return {
    data: {
      config,
      labels: result.rows.map((row) =>
        String(row[names.indexOf(config.x)] ?? 'Empty')
      ),
      ...(positions ? { positions } : {}),
      series: series as QueryChartData['series'],
    },
  };
}
