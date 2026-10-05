import type {
  AreaYOptions,
  BarXOptions,
  BarYOptions,
  DotOptions,
  LineYOptions,
  PlotOptions,
  RuleXOptions,
  RuleYOptions,
  ScaleOptions,
} from '@observablehq/plot';
import { formatDate } from '@property/utils/formatting';
import { match } from 'ts-pattern';
import { formatQueryValue } from './query';
import type { QueryChartData, QueryChartPoint } from './query-chart';

type Points = readonly QueryChartPoint[];
/**
 * Plot marks by name, so the whole chart stays plain data until the
 * renderer has loaded Plot and builds each one.
 */
export type PlotMark =
  | { mark: 'barX'; data: Points; options: BarXOptions }
  | { mark: 'barY'; data: Points; options: BarYOptions }
  | { mark: 'lineY'; data: Points; options: LineYOptions }
  | { mark: 'areaY'; data: Points; options: AreaYOptions }
  | { mark: 'dot'; data: Points; options: DotOptions }
  | { mark: 'ruleX'; data: readonly number[]; options: RuleXOptions }
  | { mark: 'ruleY'; data: readonly number[]; options: RuleYOptions };
export type PlotChart = Omit<PlotOptions, 'marks'> & { marks: PlotMark[] };
export type PlotChartLayout = {
  width: number;
  /** Series colors, in the order series are assigned. */
  palette: readonly string[];
};

/** Hover tips in Macro's menu surface; the pie's tip copies these values. */
export const CHART_TIP = {
  fill: 'var(--color-menu)',
  stroke: 'var(--color-edge)',
  fontSize: 12,
  lineHeight: 1.35,
  textPadding: 8,
  pathFilter: 'drop-shadow(0 2px 6px rgb(0 0 0 / 0.12))',
};

const STYLE = {
  fontFamily: 'inherit',
  fontSize: '11px',
  color: 'var(--color-ink-muted)',
  background: 'transparent',
  overflow: 'visible',
};
const LEGEND_STYLE = {
  fontFamily: 'inherit',
  fontSize: '11px',
  color: 'var(--color-ink-muted)',
  marginBottom: '4px',
};
const BASELINE: RuleXOptions & RuleYOptions = { stroke: 'var(--color-edge)' };
/** Average width of an 11px label character, for fitting labels to margins. */
const CHARACTER_WIDTH = 6.5;
const MARGIN_RIGHT = 16;
const VERTICAL_HEIGHT = 240;
/** Beyond this many points per series, line markers become noise. */
const MAX_MARKED_POINTS = 40;
const COMPACT_FROM = 10_000;

function truncate(label: string, limit: number): string {
  return label.length > limit ? `${label.slice(0, limit).trimEnd()}…` : label;
}

function longest(labels: readonly string[]): number {
  return Math.max(0, ...labels.map((label) => label.length));
}

/** Axis numbers read as the grid prints them; large ones shorten to 25K. */
function valueFormat(points: readonly QueryChartPoint[]) {
  const largest = Math.max(
    0,
    ...points.map((point) => Math.abs(point.value ?? 0))
  );
  const compact = new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  return (value: number) =>
    largest >= COMPACT_FROM ? compact.format(value) : formatQueryValue(value);
}

/**
 * Dates read as the grid prints them. When every point falls in one year,
 * ticks in that year drop it; a tick past it, such as a rounded end, keeps it.
 */
function dateFormat(points: readonly QueryChartPoint[]) {
  const years = new Set(
    points.flatMap((point) =>
      point.x instanceof Date ? [point.x.getFullYear()] : []
    )
  );
  return (date: Date) =>
    years.size === 1 && years.has(date.getFullYear())
      ? formatDate(date).replace(/, \d{4}$/, '')
      : formatDate(date);
}

export function plotChart(
  data: QueryChartData,
  layout: PlotChartLayout
): PlotChart {
  const color = {
    domain: data.series,
    range: layout.palette.slice(0, data.series.length),
    legend: data.series.length > 1,
    // Plot's legend styles are unlayered, so only inline styles win.
    style: LEGEND_STYLE,
  };
  const grouped = data.series.length > 1 && !data.stack;
  const base = { className: 'macro-chart', width: layout.width, style: STYLE };
  if (data.mark === 'bar' && data.scale === 'category') {
    // Categories read best as rows of bars with their labels beside them.
    const marginLeft = Math.round(
      Math.min(
        layout.width * 0.4,
        Math.max(48, longest(data.categories) * CHARACTER_WIDTH + 12)
      )
    );
    const limit = Math.floor((marginLeft - 12) / CHARACTER_WIDTH);
    const band = grouped ? data.series.length * 14 + 14 : 28;
    const categoryAxis = {
      label: null,
      domain: data.categories,
      tickSize: 0,
      tickPadding: 8,
      tickFormat: (label: string) => truncate(label, limit),
    };
    return {
      ...base,
      height: Math.max(96, data.categories.length * band + 32),
      marginTop: 8,
      marginRight: MARGIN_RIGHT,
      marginBottom: 24,
      marginLeft,
      x: {
        label: null,
        grid: true,
        nice: true,
        ticks: Math.max(
          2,
          Math.floor((layout.width - marginLeft - MARGIN_RIGHT) / 80)
        ),
        tickFormat: valueFormat(data.points),
      },
      ...(grouped
        ? {
            fy: { ...categoryAxis, padding: 0.2 },
            y: { axis: null, domain: data.series, padding: 0.1 },
          }
        : { y: { ...categoryAxis, padding: 0.3 } }),
      color,
      marks: [
        {
          mark: 'barX',
          data: data.points,
          options: {
            x: 'value',
            ...(grouped ? { y: 'series', fy: 'label' } : { y: 'label' }),
            fill: 'series',
            ...barEdges(data),
            title: 'tip',
            tip: CHART_TIP,
          },
        },
        { mark: 'ruleX', data: [0], options: BASELINE },
      ],
    };
  }

  const formatValue = valueFormat(data.points);
  const valueLabels = data.points.flatMap((point) =>
    point.value === null ? [] : [formatValue(point.value)]
  );
  const marginLeft = Math.round(
    Math.max(36, longest(valueLabels) * CHARACTER_WIDTH + 12)
  );
  const plotWidth = layout.width - marginLeft - MARGIN_RIGHT;
  const vertical = {
    ...base,
    height: VERTICAL_HEIGHT,
    marginTop: 12,
    marginRight: MARGIN_RIGHT,
    marginLeft,
    y: {
      label: null,
      grid: true,
      nice: true,
      ticks: 5,
      tickFormat: formatValue,
    },
    color,
  };
  if (data.mark === 'bar') {
    // Dates and numbers keep reading left to right, as columns.
    const labelWidth = longest(data.categories) * CHARACTER_WIDTH + 8;
    const rotate = data.categories.length * labelWidth > plotWidth;
    const limit = rotate
      ? 16
      : Math.max(
          4,
          Math.floor(plotWidth / data.categories.length / CHARACTER_WIDTH)
        );
    const columnAxis = {
      label: null,
      domain: data.categories,
      tickSize: 0,
      tickFormat: (label: string) => truncate(label, limit),
      ...(rotate ? { tickRotate: -35 } : {}),
    };
    return {
      ...vertical,
      marginBottom: rotate
        ? 12 + Math.min(longest(data.categories), 16) * 4
        : 28,
      ...(grouped
        ? {
            fx: { ...columnAxis, padding: 0.2 },
            x: { axis: null, domain: data.series, padding: 0.1 },
          }
        : { x: { ...columnAxis, padding: 0.2 } }),
      marks: [
        {
          mark: 'barY',
          data: data.points,
          options: {
            ...(grouped ? { x: 'series', fx: 'label' } : { x: 'label' }),
            y: 'value',
            fill: 'series',
            ...barEdges(data),
            title: 'tip',
            tip: CHART_TIP,
          },
        },
        { mark: 'ruleY', data: [0], options: BASELINE },
      ],
    };
  }

  const ticks = Math.max(2, Math.floor(plotWidth / 90));
  const x: ScaleOptions = match(data.scale)
    .with('category', () => ({
      type: 'point' as const,
      label: null,
      domain: data.categories,
      padding: 0.4,
      tickFormat: (label: string) =>
        truncate(
          label,
          Math.max(4, Math.floor(plotWidth / ticks / CHARACTER_WIDTH))
        ),
    }))
    .with('number', () => ({
      label: null,
      nice: true,
      ticks: Math.max(2, Math.floor(plotWidth / 80)),
      tickFormat: valueFormat(
        data.points.map((point) => ({
          ...point,
          value: typeof point.x === 'number' ? point.x : null,
        }))
      ),
    }))
    .with('date', () => ({
      type: 'time' as const,
      label: null,
      // Round to whole intervals so a few ticks still land inside the range.
      nice: true,
      ticks,
      tickFormat: dateFormat(data.points),
    }))
    .exhaustive();
  const line = {
    mark: 'lineY' as const,
    data: data.points,
    options: {
      x: 'x',
      y: 'value',
      z: 'series',
      stroke: 'series',
      strokeWidth: 2,
      title: 'tip',
      tip: CHART_TIP,
    },
  };
  const markers =
    data.points.length / data.series.length <= MAX_MARKED_POINTS
      ? [
          {
            mark: 'dot' as const,
            data: data.points,
            options: { x: 'x', y: 'value', fill: 'series', r: 3 },
          },
        ]
      : [];
  const marks: PlotMark[] = match(data.mark)
    .with('line', () => [line, ...markers])
    .with('area', () =>
      data.stack
        ? [
            {
              mark: 'areaY' as const,
              data: data.points,
              options: {
                x: 'x',
                y: 'value',
                z: 'series',
                fill: 'series',
                fillOpacity: 0.85,
                title: 'tip',
                tip: CHART_TIP,
              },
            },
            { mark: 'ruleY' as const, data: [0], options: BASELINE },
          ]
        : [
            {
              mark: 'areaY' as const,
              data: data.points,
              options: {
                x: 'x',
                y1: 0,
                y2: 'value',
                z: 'series',
                fill: 'series',
                fillOpacity: 0.16,
              },
            },
            line,
            ...markers,
            { mark: 'ruleY' as const, data: [0], options: BASELINE },
          ]
    )
    .with('scatter', () => [
      {
        mark: 'dot' as const,
        data: data.points,
        options: {
          x: 'x',
          y: 'value',
          fill: 'series',
          r: 4,
          fillOpacity: 0.85,
          stroke: 'var(--color-panel)',
          strokeWidth: 1,
          title: 'tip',
          tip: CHART_TIP,
        },
      },
    ])
    .with('pie', () => {
      throw new Error('A pie is drawn by the pie renderer, not Plot');
    })
    .exhaustive();
  return { ...vertical, marginBottom: 28, x, marks };
}

/** Stacked segments part with a hairline of the panel; lone bars round off. */
function barEdges(data: QueryChartData) {
  return data.stack && data.series.length > 1
    ? { stroke: 'var(--color-panel)', strokeWidth: 1 }
    : { rx: 2 };
}
