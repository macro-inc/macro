import { t } from '@app/lib/i18n';
import type { Cell } from '@core/database-sql/generated/types';
import {
  DATABASE_QUERY_CHART_MODES,
  DATABASE_QUERY_MAX_SERIES,
  type DatabaseQueryChart,
  type DatabaseQueryChartMode,
  type DatabaseQueryDisplayMode,
  parseDatabaseQueryChart,
} from '@macro-inc/lexical-core/nodes/databaseQueryData';
import {
  type ReferenceNames,
  resultCell,
  resultCellText,
  unknownNames,
} from './answer-cell';
import { CHART_PALETTE } from './chart-palette';
import { formatQueryValue, isScalarAnswer, type QueryAnswer } from './query';

/** Most series one chart colors apart. */
const MAX_CHART_SERIES = CHART_PALETTE.length;
const MAX_POINTS = 300;
const MAX_PIE_CATEGORIES = 20;

export type QueryChartPoint = {
  /** A category label, a number, or a moment, as the x scale reads it. */
  x: string | number | Date;
  /** The x value as the database grid prints it. */
  label: string;
  series: string;
  /** Missing values are gaps, never zeroes. */
  value: number | null;
  tip: string;
};

export type QueryChartData = {
  mark: DatabaseQueryChartMode;
  config: DatabaseQueryChart;
  /** Only bar and area series stack. */
  stack: boolean;
  title: string;
  /** Categories keep row order; numbers and dates keep true distances. */
  scale: 'category' | 'number' | 'date';
  /** Distinct x labels in row order. */
  categories: string[];
  series: string[];
  points: QueryChartPoint[];
  /** Rows left off a number or time axis because their x is empty. */
  omitted: number;
};

export function chartModeLabel(mode: DatabaseQueryChartMode): string {
  return `${mode[0].toUpperCase()}${mode.slice(1)} chart`;
}

const columnLabel = (name: string) => name.replaceAll('_', ' ');

/** A number cell's value; an empty cell is a gap; anything else is not a number. */
function numeric(cell: Cell | null | undefined): number | null | undefined {
  if (!cell) return null;
  return cell.type === 'number' ? cell.value : undefined;
}

type ChartResult =
  | { data: QueryChartData; error?: never }
  | { data?: never; error: string };

/**
 * The displays an answer can take: scalar for a single value, a table, the
 * saved chart, and any chart its columns fit.
 */
export function availableDisplayModes(
  answer: QueryAnswer,
  saved?: { displayMode: DatabaseQueryDisplayMode; chart?: DatabaseQueryChart }
): DatabaseQueryDisplayMode[] {
  return [
    ...(isScalarAnswer(answer) ? (['scalar'] as const) : []),
    'table',
    ...DATABASE_QUERY_CHART_MODES.filter(
      (mode) =>
        mode === saved?.displayMode ||
        (!!saved?.chart &&
          !!prepareQueryChart(answer, mode, saved.chart, unknownNames).data) ||
        !!prepareQueryChart(answer, mode, undefined, unknownNames).data
    ),
  ];
}

/** Validate the actual answer before drawing: missing values are gaps, never zeroes. */
export function prepareQueryChart(
  answer: QueryAnswer,
  mode: DatabaseQueryChartMode,
  requested: DatabaseQueryChart | undefined,
  references: ReferenceNames
): ChartResult {
  if (answer.columns.length < 2)
    return {
      error: t('databaseAnswers.chartNeedsColumns'),
    };
  if (!answer.rows.length)
    return { error: t('databaseAnswers.chartNoRecords') };
  const names = answer.columns.map((column) => column.name);
  const inferred = names.slice(1).filter((_, index) => {
    const values = answer.rows.map((row) => numeric(row[index + 1]));
    return (
      values.some((value) => typeof value === 'number') &&
      values.every((value) => value !== undefined)
    );
  });
  const config = requested ?? {
    x: names[0],
    y: inferred.slice(0, mode === 'pie' ? 1 : DATABASE_QUERY_MAX_SERIES),
  };
  const columnIndex = (name: string) => names.indexOf(name);
  if (
    !parseDatabaseQueryChart(config) ||
    [config.x, ...config.y, ...(config.color ? [config.color] : [])].some(
      (name) => names.filter((candidate) => candidate === name).length !== 1
    )
  )
    return {
      error: t('databaseAnswers.chartColumnsUnavailable'),
    };
  if (answer.rows.length > (mode === 'pie' ? MAX_PIE_CATEGORIES : MAX_POINTS))
    return {
      error:
        mode === 'pie'
          ? t('databaseAnswers.chartTooManyCategories')
          : t('databaseAnswers.chartTooManyPoints'),
    };
  const values = config.y.map((name) =>
    answer.rows.map((row) => numeric(row[columnIndex(name)]))
  );
  if (values.some((column) => column.some((value) => value === undefined)))
    return {
      error: t('databaseAnswers.chartNeedsNumbers'),
    };
  if (
    !values.some((column) => column.some((value) => typeof value === 'number'))
  )
    return { error: t('databaseAnswers.chartNoNumbers') };
  if (mode === 'pie') {
    const shares = values[0];
    if (
      config.y.length !== 1 ||
      config.color ||
      shares.some((value) => value !== null && value !== undefined && value < 0)
    )
      return {
        error: t('databaseAnswers.pieNeedsOneSeries'),
      };
    if (
      !shares.some(
        (value) => value !== null && value !== undefined && value > 0
      )
    )
      return {
        error: t('databaseAnswers.pieNeedsPositive'),
      };
  }

  const cellAt = (row: QueryAnswer['rows'][number], name: string) =>
    resultCell(
      row[columnIndex(name)] ?? null,
      answer.columns[columnIndex(name)]
    );
  const text = (row: QueryAnswer['rows'][number], name: string) => {
    const cell = cellAt(row, name);
    return cell.kind === 'empty'
      ? t('databaseAnswers.empty')
      : resultCellText(cell, references);
  };
  const xCells = answer.rows.map((row) => cellAt(row, config.x));
  const present = xCells.filter((cell) => cell.kind !== 'empty');
  const scale: QueryChartData['scale'] =
    present.length === 0
      ? 'category'
      : present.every((cell) => cell.kind === 'number')
        ? 'number'
        : present.every((cell) => cell.kind === 'date')
          ? 'date'
          : 'category';
  // Only a continuous axis has nowhere to put an empty x; bands label it.
  const continuous = scale !== 'category' && mode !== 'bar' && mode !== 'pie';
  const xOf = (cell: (typeof xCells)[number], label: string) => {
    if (!continuous) return label;
    if (cell.kind === 'number') return cell.value;
    if (cell.kind === 'date') return cell.date;
    return label;
  };

  const points: QueryChartPoint[] = [];
  let omitted = 0;
  answer.rows.forEach((row, rowIndex) => {
    const x = xCells[rowIndex];
    if (continuous && x.kind === 'empty') {
      omitted += 1;
      return;
    }
    const label = text(row, config.x);
    config.y.forEach((name, seriesIndex) => {
      const series = config.color ? text(row, config.color) : columnLabel(name);
      const value = values[seriesIndex][rowIndex] ?? null;
      points.push({
        x: xOf(x, label),
        label,
        series,
        value,
        tip: `${label}\n${series}: ${formatQueryValue(value)}`,
      });
    });
  });
  const series = [...new Set(points.map((point) => point.series))];
  if (series.length > MAX_CHART_SERIES)
    return {
      error: t('databaseAnswers.chartTooManyGroups', { max: MAX_CHART_SERIES }),
    };
  const drawn = mode === 'pie' ? foldPie(points) : points;
  return {
    data: {
      mark: mode,
      config,
      stack: (mode === 'bar' || mode === 'area') && !!config.stack,
      title:
        config.title ||
        (config.color
          ? t('databaseAnswers.chartTitleSplit', {
              values: config.y.map(columnLabel).join(', '),
              label: columnLabel(config.x),
              split: columnLabel(config.color),
            })
          : t('databaseAnswers.chartTitle', {
              values: config.y.map(columnLabel).join(', '),
              label: columnLabel(config.x),
            })),
      scale,
      categories: [...new Set(drawn.map((point) => point.label))],
      series,
      points: drawn,
      omitted,
    },
  };
}

/**
 * A pie has one color per slice, so slices past the palette fold into
 * "Other", smallest first; the rest keep row order.
 */
function foldPie(points: QueryChartPoint[]): QueryChartPoint[] {
  if (points.length <= MAX_CHART_SERIES) return points;
  const kept = new Set(
    [...points]
      .sort((left, right) => (right.value ?? 0) - (left.value ?? 0))
      .slice(0, MAX_CHART_SERIES - 1)
  );
  const rest = points.filter((point) => !kept.has(point));
  const value = rest.reduce((sum, point) => sum + (point.value ?? 0), 0);
  const series = points[0].series;
  return [
    ...points.filter((point) => kept.has(point)),
    {
      x: t('databaseAnswers.chartOther'),
      label: t('databaseAnswers.chartOther'),
      series,
      value,
      tip: `${t('databaseAnswers.chartOtherTip', { count: rest.length })}\n${series}: ${formatQueryValue(value)}`,
    },
  ];
}
