import { scaleLinear } from 'd3-scale';
import type { ChartData, ChartPlotData, ChartSeriesData } from './chart-data';
import {
  axisDomain,
  type Box,
  CHARACTER_WIDTH,
  type ChartShape,
  DEFAULT_GAP_WIDTHS,
  type Scale,
  tickFormat,
  truncate,
} from './chart-shapes';
import {
  binLabels,
  boxStatistics,
  histogramBins,
  paretoOrder,
  sumByCategory,
  waterfallSteps,
} from './chart-statistics';
import { paletteColor } from './drawingml-colors';

/** A value as its cells show it, to four decimals at most. */
export const valueText = (sample: string | undefined) =>
  tickFormat(sample, 1e-4);

type Frame = {
  scale: Scale;
  /** Percent from 0 to 100% on the right, for a pareto line. */
  percent: Scale;
  center: (index: number) => number;
  band: number;
  box: Box;
  /** Draws the line along zero, over the bars. */
  axis: () => void;
};

/**
 * A value axis with gridlines on the left, categories along the bottom and,
 * if asked, percentages on the right. Undefined when no plot area is left.
 */
function frame(
  shapes: ChartShape[],
  outer: Box,
  categories: string[],
  values: number[],
  options: {
    font: number;
    zoom: number;
    sample?: string;
    zero?: boolean;
    percent?: boolean;
  }
): Frame | undefined {
  const { font, zoom } = options;
  const all = options.zero ? [...values, 0] : values;
  const scale = scaleLinear()
    .domain(
      all.length ? axisDomain(Math.min(...all), Math.max(...all)) : [0, 1]
    )
    .nice(5);
  const ticks = scale.ticks(5);
  const format = tickFormat(
    options.sample,
    ticks.length > 1 ? ticks[1] - ticks[0] : 1
  );
  const percent = scaleLinear().domain([0, 1]);
  const percentTicks = percent.ticks(5);
  const percentFormat = tickFormat('0%', 0.2);
  const widest = (texts: string[]) =>
    Math.max(0, ...texts.map((text) => text.length)) * font * CHARACTER_WIDTH +
    6 * zoom;
  const box = {
    top: outer.top,
    bottom: outer.bottom - font * 1.6,
    left: outer.left + widest(ticks.map(format)),
    right:
      outer.right -
      (options.percent ? widest(percentTicks.map(percentFormat)) : 0),
  };
  if (box.right - box.left < 20 || box.bottom - box.top < 20) return;
  scale.range([box.bottom, box.top]);
  percent.range([box.bottom, box.top]);
  for (const tick of ticks) {
    const y = scale(tick);
    shapes.push({
      type: 'line',
      x1: box.left,
      y1: y,
      x2: box.right,
      y2: y,
      role: 'grid',
    });
    shapes.push({
      type: 'text',
      x: box.left - 4 * zoom,
      y,
      text: format(tick),
      anchor: 'end',
      size: font,
      role: 'label',
      baseline: 'middle',
    });
  }
  if (options.percent)
    for (const tick of percentTicks)
      shapes.push({
        type: 'text',
        x: box.right + 4 * zoom,
        y: percent(tick),
        text: percentFormat(tick),
        anchor: 'start',
        size: font,
        role: 'label',
        baseline: 'middle',
      });
  const count = Math.max(1, categories.length);
  const band = (box.right - box.left) / count;
  const center = (index: number) => box.left + band * (index + 0.5);
  const every = Math.max(
    1,
    Math.ceil(
      (Math.max(1, ...categories.map((label) => label.length)) *
        font *
        CHARACTER_WIDTH +
        4 * zoom) /
        band
    )
  );
  categories.forEach((label, index) => {
    if (index % every) return;
    shapes.push({
      type: 'text',
      x: center(index),
      y: box.bottom + font * 1.2,
      text: truncate(label, band * every - 2 * zoom, font),
      anchor: 'middle',
      size: font,
      role: 'label',
    });
  });
  const [low, high] = scale.domain();
  const zero = scale(Math.max(low, Math.min(0, high)));
  return {
    scale,
    percent,
    center,
    band,
    box,
    axis: () =>
      shapes.push({
        type: 'line',
        x1: box.left,
        y1: zero,
        x2: box.right,
        y2: zero,
        role: 'axis',
      }),
  };
}

/** A bar from `from` to `to` in a category's band, `gap` percent apart. */
function bar(
  frame: Frame,
  index: number,
  from: number,
  to: number,
  gap: number
) {
  const width = frame.band / (1 + gap / 100);
  const a = frame.scale(from);
  const b = frame.scale(to);
  return {
    x: frame.center(index) - width / 2,
    y: Math.min(a, b),
    width,
    height: Math.max(Math.abs(b - a), 0.5),
  };
}

/** What a histogram or pareto chart counts: its bins, or its categories. */
function histogramGroups(
  plot: ChartPlotData,
  series: ChartSeriesData,
  categories: string[]
): { labels: string[]; values: number[] } {
  if (plot.aggregate) {
    const sums = sumByCategory(
      series.values.map((_, index) => categories[index] ?? ''),
      series.values
    );
    return {
      labels: sums.map((sum) => sum.name),
      values: sums.map((sum) => sum.value),
    };
  }
  const bins = histogramBins(
    series.values.filter((value): value is number => value !== null),
    plot.binning ?? {}
  );
  const width = bins.find((bin) => !bin.edge && bin.high > bin.low);
  // Edges one digit finer than the bins are wide, as Excel labels them.
  const format = tickFormat(
    series.sample,
    width ? (width.high - width.low) / 10 : 1
  );
  return {
    labels: binLabels(bins, !!plot.binning?.closedLeft, format),
    values: bins.map((bin) => bin.count),
  };
}

/**
 * A histogram: a bar per bin, touching, as tall as the values in it. A
 * pareto chart sorts the bars largest first under a line of their running
 * share of the total, on a percent axis.
 */
export function histogramChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  box: Box,
  font: number,
  zoom: number
) {
  const series = plot.series[0];
  if (!series) return;
  const groups = histogramGroups(plot, series, data.categories);
  const pareto = plot.kind === 'pareto';
  const { order, cumulative } = paretoOrder(groups.values);
  const shown = pareto ? order : order.map((_, index) => index);
  const labels = shown.map((index) => groups.labels[index]);
  // Sums read like their cells; bins count values.
  const sample = plot.aggregate ? series.sample : undefined;
  const area = frame(shapes, box, labels, groups.values, {
    font,
    zoom,
    sample,
    zero: true,
    percent: pareto,
  });
  if (!area) return;
  const gap = plot.gapWidth ?? DEFAULT_GAP_WIDTHS[plot.kind] ?? 0;
  const format = valueText(sample);
  shown.forEach((index, position) => {
    const value = groups.values[index];
    if (!value) return;
    shapes.push({
      type: 'rect',
      ...bar(area, position, 0, value, gap),
      fill: series.color,
      // Touching bins stay apart, as Excel outlines them.
      ...(gap === 0 && { stroke: 'var(--color-surface)' }),
      tip: `${groups.labels[index]}: ${format(value)}`,
    });
  });
  area.axis();
  if (!pareto || !cumulative.length) return;
  shapes.push({
    type: 'path',
    d: `M${cumulative
      .map(
        (share, position) => `${area.center(position)},${area.percent(share)}`
      )
      .join('L')}`,
    stroke: paletteColor(data.palette, 1),
    strokeWidth: 2 * zoom,
    tip: 'Cumulative %',
  });
}

/**
 * A waterfall: each change floats from the running total, in the increase or
 * decrease color, and totals stand on zero, joined by connector lines.
 */
export function waterfallChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  box: Box,
  font: number,
  zoom: number
) {
  const series = plot.series[0];
  if (!series) return;
  const steps = waterfallSteps(series.values, plot.totals);
  const count = Math.max(data.categories.length, steps.length);
  const categories = Array.from(
    { length: count },
    (_, index) => data.categories[index] ?? `${index + 1}`
  );
  const area = frame(
    shapes,
    box,
    categories,
    steps.flatMap((step) => (step ? [step.from, step.to] : [])),
    { font, zoom, sample: series.sample, zero: true }
  );
  if (!area) return;
  const gap = plot.gapWidth ?? DEFAULT_GAP_WIDTHS.waterfall ?? 0;
  const format = valueText(series.sample);
  const colors = {
    increase: data.palette[0],
    decrease: paletteColor(data.palette, 1),
    total: paletteColor(data.palette, 2),
  };
  let previous: { index: number; level: number } | undefined;
  steps.forEach((step, index) => {
    const raw = series.values[index];
    if (!step || raw === null) return;
    const rect = bar(area, index, step.from, step.to, gap);
    if (previous && !plot.noConnectors) {
      const before = bar(area, previous.index, 0, 0, gap);
      const y = area.scale(previous.level);
      shapes.push({
        type: 'path',
        d: `M${before.x + before.width},${y}H${rect.x}`,
        stroke: 'var(--color-ink-muted)',
        strokeWidth: zoom,
        dash: `${3 * zoom} ${2 * zoom}`,
      });
    }
    previous = { index, level: step.to };
    shapes.push({
      type: 'rect',
      ...rect,
      fill: colors[step.kind],
      tip: `${categories[index]}: ${format(raw)}`,
    });
    if (!plot.labels) return;
    // Outside the bar's end: above a rise, below a fall.
    const below = step.kind === 'decrease' || step.to < 0;
    shapes.push({
      type: 'text',
      x: rect.x + rect.width / 2,
      y: below ? rect.y + rect.height + 2 * zoom : rect.y - 2 * zoom,
      text: format(raw),
      anchor: 'middle',
      size: font * 0.9,
      role: 'label',
      baseline: below ? 'hanging' : 'auto',
    });
  });
  area.axis();
}

/**
 * A box and whisker chart: for each category, a box per series from its
 * first to third quartile with the median across it, whiskers to the last
 * values within 1.5 boxes, the mean marked, and outliers as markers.
 */
export function boxWhiskerChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  box: Box,
  font: number,
  zoom: number
) {
  const groups = data.numbered ? [''] : [...new Set(data.categories)];
  const values = plot.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null)
  );
  const area = frame(shapes, box, groups, values, {
    font,
    zoom,
    sample: plot.series.find((series) => series.sample)?.sample,
  });
  if (!area) return;
  const method = plot.quartiles ?? 'exclusive';
  const slot =
    area.band /
    (plot.series.length +
      (plot.gapWidth ?? DEFAULT_GAP_WIDTHS.boxWhisker ?? 0) / 100);
  plot.series.forEach((series, position) => {
    const format = valueText(series.sample);
    const means: [number, number][] = [];
    groups.forEach((group, index) => {
      const points = series.values.filter(
        (value, point): value is number =>
          value !== null &&
          (data.numbered || (data.categories[point] ?? '') === group)
      );
      if (!points.length) return;
      const stats = boxStatistics(points, method);
      const left =
        area.center(index) - (plot.series.length * slot) / 2 + position * slot;
      const middle = left + slot / 2;
      const y = area.scale;
      const name = group ? `${series.name} · ${group}` : series.name;
      const cap = slot / 4;
      shapes.push({
        type: 'path',
        d: `M${middle},${y(stats.high)}V${y(stats.q3)}M${middle},${y(stats.q1)}V${y(stats.low)}M${middle - cap},${y(stats.high)}H${middle + cap}M${middle - cap},${y(stats.low)}H${middle + cap}`,
        stroke: 'var(--color-ink-muted)',
        strokeWidth: zoom,
      });
      shapes.push({
        type: 'rect',
        x: left,
        y: y(stats.q3),
        width: slot,
        height: Math.max(y(stats.q1) - y(stats.q3), 0.5),
        fill: series.color,
        tip: `${name}: Q1 ${format(stats.q1)}, median ${format(stats.median)}, Q3 ${format(stats.q3)}`,
      });
      shapes.push({
        type: 'path',
        d: `M${left},${y(stats.median)}H${left + slot}`,
        stroke: 'var(--color-surface)',
        strokeWidth: 1.5 * zoom,
      });
      means.push([middle, y(stats.mean)]);
      if (!plot.noMeanMarkers) {
        const size = 3 * zoom;
        const [x, at] = [middle, y(stats.mean)];
        shapes.push({
          type: 'path',
          d: `M${x - size},${at - size}L${x + size},${at + size}M${x - size},${at + size}L${x + size},${at - size}`,
          stroke: 'var(--color-surface)',
          strokeWidth: 1.5 * zoom,
          tip: `${name}: mean ${format(stats.mean)}`,
        });
      }
      const markers = [
        ...(plot.noOutliers ? [] : stats.outliers),
        ...(plot.innerPoints ? stats.inner : []),
      ];
      for (const value of markers)
        shapes.push({
          type: 'circle',
          x: middle,
          y: y(value),
          r: 2.5 * zoom,
          fill: 'var(--color-surface)',
          stroke: series.color,
          tip: `${name}: ${format(value)}`,
        });
    });
    if (plot.meanLine && means.length > 1)
      shapes.push({
        type: 'path',
        d: `M${means.map(([x, at]) => `${x},${at}`).join('L')}`,
        stroke: series.color,
        strokeWidth: 1.5 * zoom,
        tip: `${series.name} mean`,
      });
  });
}
