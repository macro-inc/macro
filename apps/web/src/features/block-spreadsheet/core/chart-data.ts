import {
  type ChartGrouping,
  type ChartKind,
  parseChartReference,
  type SheetChart,
} from '@macro-inc/spreadsheet/sheet-drawings';

/** A cell's value as charts read it: its displayed text, and its number. */
export type ChartValue = { text: string; number?: number };
/**
 * Reads a reference that names a sheet and cells, row by row, up to
 * `MAX_CHART_POINTS` values.
 */
export type ChartReader = (
  range: NonNullable<ReturnType<typeof parseChartReference>>
) => ChartValue[] | undefined;

export type ChartSeriesData = {
  name: string;
  color: string;
  values: (number | null)[];
  /** The x values of a scatter series. */
  x?: (number | null)[];
  noFill?: boolean;
  noLine?: boolean;
  /** How the first value displays, to format the axis like the cells. */
  sample?: string;
};

export type ChartPlotData = {
  kind: ChartKind;
  grouping?: ChartGrouping;
  secondary?: boolean;
  series: ChartSeriesData[];
};

export type ChartData = {
  title?: string;
  legend?: SheetChart['legend'];
  categories: string[];
  plots: ChartPlotData[];
  /** Colors of pie and doughnut slices. */
  palette: string[];
};

/** Office's default accents, for charts without the workbook's. */
const DEFAULT_PALETTE = [
  '#4472C4',
  '#ED7D31',
  '#A5A5A5',
  '#FFC000',
  '#5B9BD5',
  '#70AD47',
];
/** Points a series draws, at most; readers stop there. */
export const MAX_CHART_POINTS = 5_000;

/**
 * A reference as charts write it: `[0]!` marks a name in the same
 * workbook, and a name may stand for a range.
 */
function range(
  reference: string,
  names: { name: string; formula: string }[]
): ReturnType<typeof parseChartReference> {
  const text = reference.replace(/^\[0\]!/, '').trim();
  const direct = parseChartReference(text);
  if (direct) return direct;
  const local = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/.exec(text);
  const bare = local?.[3] ?? text;
  const name = names.find(
    (entry) => entry.name.toLowerCase() === bare.toLowerCase()
  );
  return name ? parseChartReference(name.formula.replace(/^=/, '')) : undefined;
}

/** The data a chart draws, read through its references. */
export function chartData(
  chart: SheetChart,
  read: ChartReader,
  names: { name: string; formula: string }[] = []
): ChartData {
  const values = (index: number | undefined) => {
    if (index === undefined) return;
    const target = range(chart.references[index] ?? '', names);
    return target ? read(target)?.slice(0, MAX_CHART_POINTS) : undefined;
  };
  const palette = chart.colors?.length ? chart.colors : DEFAULT_PALETTE;
  let categories: string[] | undefined;
  let count = 0;
  const plots = chart.plots.map((plot) => ({
    kind: plot.kind,
    ...(plot.grouping && { grouping: plot.grouping }),
    ...(plot.secondary && { secondary: true }),
    series: plot.series.map((series) => {
      const index = count++;
      const points = values(series.values) ?? [];
      const labels = values(series.categories);
      if (plot.kind !== 'scatter' && labels && !categories)
        categories = labels.map((value) => value.text);
      const name =
        values(series.nameRef)
          ?.map((value) => value.text.trim())
          .filter(Boolean)
          .join(' ') ||
        series.name ||
        `Series ${index + 1}`;
      return {
        name,
        color: series.color ?? palette[index % palette.length],
        values: points.map((value) => value.number ?? null),
        ...(plot.kind === 'scatter' && {
          x: labels
            ? labels.map((value) => value.number ?? null)
            : points.map((_, point) => point + 1),
        }),
        ...(series.noFill && { noFill: true }),
        ...(series.noLine && { noLine: true }),
        ...(points.find((value) => value.number !== undefined) && {
          sample: points.find((value) => value.number !== undefined)?.text,
        }),
      };
    }),
  }));
  const longest = Math.max(
    0,
    ...plots.flatMap((plot) =>
      plot.series.map((series) => series.values.length)
    )
  );
  return {
    ...(chart.title && { title: chart.title }),
    ...(chart.legend && { legend: chart.legend }),
    categories:
      categories ??
      Array.from({ length: longest }, (_, index) => `${index + 1}`),
    plots,
    palette,
  };
}
