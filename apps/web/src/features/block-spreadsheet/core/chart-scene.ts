import { scaleLinear } from 'd3-scale';
import { arc, pie } from 'd3-shape';
import type { ChartData, ChartPlotData, ChartSeriesData } from './chart-data';

/** Shapes a chart draws, in pixels within its box; the view only paints. */
export type ChartShape =
  | {
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      tip?: string;
    }
  | {
      type: 'path';
      d: string;
      /** Where the path's origin is drawn. */
      translate?: [number, number];
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      opacity?: number;
      tip?: string;
    }
  | {
      type: 'circle';
      x: number;
      y: number;
      r: number;
      fill: string;
      opacity?: number;
      stroke?: string;
      tip?: string;
    }
  | {
      type: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      /** Gridlines and axes use theme colors. */
      role: 'grid' | 'axis';
    }
  | {
      type: 'text';
      x: number;
      y: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
      size: number;
      role: 'title' | 'label';
      baseline?: 'middle' | 'hanging' | 'auto';
    };

export type ChartScene = { shapes: ChartShape[] };

const CHARACTER_WIDTH = 0.6;

function truncate(text: string, width: number, size: number): string {
  const fits = Math.max(1, Math.floor(width / (size * CHARACTER_WIDTH)));
  return text.length > fits ? `${text.slice(0, Math.max(1, fits - 1))}…` : text;
}

/** Tick labels formatted like the series' cells: percentages, currency. */
function tickFormat(sample: string | undefined, step: number) {
  const digits = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  const percent = !!sample?.trim().endsWith('%');
  const currency = /^-?\(?([$€£¥])/.exec(sample?.trim() ?? '')?.[1];
  const format = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: percent ? Math.max(0, digits - 2) : digits,
    ...(percent && { style: 'percent' }),
  });
  return (value: number) => {
    const text = format.format(value);
    if (!currency) return text;
    return value < 0 ? `-${currency}${text.slice(1)}` : `${currency}${text}`;
  };
}

/** The extent a value axis spans for the plots drawn on it. */
function extent(plots: ChartPlotData[], categories: number): [number, number] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  const see = (value: number) => {
    low = Math.min(low, value);
    high = Math.max(high, value);
  };
  for (const plot of plots) {
    if (plot.grouping === 'percentStacked') {
      see(0);
      see(
        plot.series.some((series) =>
          series.values.some((value) => (value ?? 0) < 0)
        )
          ? -1
          : 1
      );
      continue;
    }
    if (plot.grouping === 'stacked')
      for (let index = 0; index < categories; index++) {
        let positive = 0;
        let negative = 0;
        for (const series of plot.series) {
          const value = series.values[index] ?? 0;
          if (value >= 0) positive += value;
          else negative += value;
        }
        see(positive);
        see(negative);
      }
    else
      for (const series of plot.series)
        for (const value of series.values) if (value !== null) see(value);
    // Bars and areas grow from zero; lines and prices need not.
    if (plot.kind === 'column' || plot.kind === 'bar' || plot.kind === 'area')
      see(0);
  }
  if (!Number.isFinite(low)) return [0, 1];
  // Like Excel, an axis starts at zero unless the values sit far from it.
  if (low > 0 && (high - low) / high >= 1 / 6) low = 0;
  if (high < 0 && (low - high) / low >= 1 / 6) high = 0;
  if (low === high)
    return low === 0 ? [0, 1] : [Math.min(0, low), Math.max(0, high)];
  return [low, high];
}

const sample = (plots: ChartPlotData[]) =>
  plots.flatMap((plot) => plot.series).find((series) => series.sample)?.sample;

/**
 * Lay out a chart in a box of `width` by `height` pixels; `scale` is the
 * grid's zoom, which text follows.
 */
export function chartScene(
  data: ChartData,
  width: number,
  height: number,
  scale = 1
): ChartScene {
  const shapes: ChartShape[] = [];
  const font = 10 * scale;
  const pad = 8 * scale;
  let top = pad;
  let bottom = height - pad;
  let left = pad;
  let right = width - pad;
  if (data.title) {
    const size = 13 * scale;
    shapes.push({
      type: 'text',
      x: width / 2,
      y: top + size * 0.8,
      text: truncate(data.title, width - 2 * pad, size),
      anchor: 'middle',
      size,
      role: 'title',
    });
    top += size * 1.5;
  }
  const round = data.plots.find(
    (plot) => plot.kind === 'pie' || plot.kind === 'doughnut'
  );
  const surface = data.plots.find((plot) => plot.kind === 'surface');
  const bands = surface && surfaceBands(surface, data.palette);
  // Legend entries: slices of a pie, bands of a surface, otherwise series.
  const entries = round
    ? data.categories.map((name, index) => ({
        name,
        color: data.palette[index % data.palette.length],
        line: false,
      }))
    : bands
      ? bands.entries
      : data.plots.flatMap((plot) =>
          plot.series
            // Prices draw as high-low lines and bars, not as their series.
            .filter(
              (series) =>
                plot.kind !== 'stock' &&
                (!series.noFill || plot.kind === 'line')
            )
            .map((series) => ({
              name: series.name,
              color: series.color,
              line:
                plot.kind === 'line' ||
                plot.kind === 'scatter' ||
                (plot.kind === 'radar' && !plot.filled),
            }))
        );
  if (data.legend && entries.length) {
    const swatch = 8 * scale;
    const row = font * 1.6;
    if (data.legend === 'right' || data.legend === 'left') {
      const widest = Math.max(...entries.map((entry) => entry.name.length));
      const legendWidth = Math.min(
        width * 0.35,
        swatch + 6 * scale + widest * font * CHARACTER_WIDTH
      );
      const x = data.legend === 'right' ? right - legendWidth : left;
      const shown = entries.slice(0, Math.floor((bottom - top) / row));
      let y = (top + bottom) / 2 - (shown.length * row) / 2;
      for (const entry of shown) {
        legendSwatch(shapes, entry, x, y + row / 2, swatch);
        shapes.push({
          type: 'text',
          x: x + swatch + 4 * scale,
          y: y + row / 2,
          text: truncate(entry.name, legendWidth - swatch - 4 * scale, font),
          anchor: 'start',
          size: font,
          role: 'label',
          baseline: 'middle',
        });
        y += row;
      }
      if (data.legend === 'right') right -= legendWidth + pad;
      else left += legendWidth + pad;
    } else {
      // Entries flow in rows across the width.
      const widths = entries.map(
        (entry) =>
          swatch +
          4 * scale +
          entry.name.length * font * CHARACTER_WIDTH +
          10 * scale
      );
      const lines: { entries: typeof entries; width: number }[] = [];
      let line = { entries: [] as typeof entries, width: 0 };
      entries.forEach((entry, index) => {
        if (line.entries.length && line.width + widths[index] > right - left) {
          lines.push(line);
          line = { entries: [], width: 0 };
        }
        line.entries.push(entry);
        line.width += widths[index];
      });
      lines.push(line);
      const shown = lines.slice(0, 2);
      const legendHeight = shown.length * row;
      let y = data.legend === 'top' ? top : bottom - legendHeight;
      for (const current of shown) {
        let x = (left + right) / 2 - current.width / 2;
        for (const entry of current.entries) {
          legendSwatch(shapes, entry, x, y + row / 2, swatch);
          shapes.push({
            type: 'text',
            x: x + swatch + 4 * scale,
            y: y + row / 2,
            text: entry.name,
            anchor: 'start',
            size: font,
            role: 'label',
            baseline: 'middle',
          });
          x += widths[entries.indexOf(entry)];
        }
        y += row;
      }
      if (data.legend === 'top') top += legendHeight + 2 * scale;
      else bottom -= legendHeight + 2 * scale;
    }
  }
  if (right - left < 20 || bottom - top < 20) return { shapes };
  if (round) {
    roundChart(shapes, round, data, { top, bottom, left, right });
    return { shapes };
  }
  const radar = data.plots.filter((plot) => plot.kind === 'radar');
  if (radar.length) {
    radarChart(shapes, radar, data, { top, bottom, left, right }, font, scale);
    return { shapes };
  }
  if (surface && bands) {
    surfaceChart(
      shapes,
      surface,
      data,
      { top, bottom, left, right },
      font,
      bands
    );
    return { shapes };
  }
  const primary = data.plots.filter((plot) => !plot.secondary);
  const secondary = data.plots.filter((plot) => plot.secondary);
  const horizontal = primary.some((plot) => plot.kind === 'bar');
  const scatter = data.plots.find(
    (plot) => plot.kind === 'scatter' || plot.kind === 'bubble'
  );
  const count = Math.max(1, data.categories.length);
  const valueScale = (plots: ChartPlotData[], range: [number, number]) => {
    const scale = scaleLinear()
      .domain(extent(plots, count))
      .range(range)
      .nice(5);
    const ticks = scale.ticks(5);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    return { scale, ticks, format: tickFormat(sample(plots), step) };
  };
  // Axis label space, measured with the widest tick label.
  const measure = (plots: ChartPlotData[]) => {
    if (!plots.length) return 0;
    const { ticks, format } = valueScale(plots, [0, 1]);
    return (
      Math.max(...ticks.map((tick) => format(tick).length)) *
        font *
        CHARACTER_WIDTH +
      6 * scale
    );
  };
  if (horizontal) {
    const labelWidth = Math.min(
      (right - left) * 0.35,
      Math.max(...data.categories.map((label) => label.length), 1) *
        font *
        CHARACTER_WIDTH +
        6 * scale
    );
    left += labelWidth;
    bottom -= font * 1.6;
  } else {
    left += measure(primary.length ? primary : data.plots);
    right -= measure(secondary);
    bottom -= font * 1.6;
  }
  if (right - left < 20 || bottom - top < 20) return { shapes };
  const box = { top, bottom, left, right };
  if (scatter) {
    scatterChart(shapes, data, box, font, scale, valueScale);
    return { shapes };
  }
  const values = valueScale(
    primary.length ? primary : data.plots,
    horizontal ? [left, right] : [bottom, top]
  );
  // Gridlines and value labels.
  for (const tick of values.ticks) {
    const at = values.scale(tick);
    shapes.push(
      horizontal
        ? { type: 'line', x1: at, y1: top, x2: at, y2: bottom, role: 'grid' }
        : { type: 'line', x1: left, y1: at, x2: right, y2: at, role: 'grid' }
    );
    shapes.push(
      horizontal
        ? {
            type: 'text',
            x: at,
            y: bottom + font * 1.2,
            text: values.format(tick),
            anchor: 'middle',
            size: font,
            role: 'label',
          }
        : {
            type: 'text',
            x: left - 4 * scale,
            y: at,
            text: values.format(tick),
            anchor: 'end',
            size: font,
            role: 'label',
            baseline: 'middle',
          }
    );
  }
  const secondaryValues = secondary.length
    ? valueScale(secondary, [bottom, top])
    : undefined;
  if (secondaryValues)
    for (const tick of secondaryValues.ticks)
      shapes.push({
        type: 'text',
        x: right + 4 * scale,
        y: secondaryValues.scale(tick),
        text: secondaryValues.format(tick),
        anchor: 'start',
        size: font,
        role: 'label',
        baseline: 'middle',
      });
  // Category bands; horizontal bars list the first category at the bottom.
  const span = horizontal ? bottom - top : right - left;
  const band = span / count;
  const center = (index: number) =>
    horizontal ? bottom - band * (index + 0.5) : left + band * (index + 0.5);
  const every = Math.max(
    1,
    Math.ceil(
      (horizontal
        ? font * 1.4
        : Math.max(...data.categories.map((label) => label.length), 1) *
            font *
            CHARACTER_WIDTH +
          4 * scale) / band
    )
  );
  data.categories.forEach((label, index) => {
    if (index % every) return;
    shapes.push(
      horizontal
        ? {
            type: 'text',
            x: left - 4 * scale,
            y: center(index),
            text: truncate(label, left - pad - 4 * scale, font),
            anchor: 'end',
            size: font,
            role: 'label',
            baseline: 'middle',
          }
        : {
            type: 'text',
            x: center(index),
            y: bottom + font * 1.2,
            text: truncate(label, band * every - 2 * scale, font),
            anchor: 'middle',
            size: font,
            role: 'label',
          }
    );
  });
  // Bars first, so lines draw over them, as in Excel's combination charts.
  const ordered = [...data.plots].sort(
    (a, b) => Number(a.kind === 'line') - Number(b.kind === 'line')
  );
  for (const plot of ordered) {
    const axis = plot.secondary && secondaryValues ? secondaryValues : values;
    if (plot.kind === 'column' || plot.kind === 'bar')
      bars(
        shapes,
        plot,
        data,
        axis.scale,
        center,
        band,
        horizontal,
        axis.format
      );
    else if (plot.kind === 'stock')
      stocks(shapes, plot, data, axis.scale, center, band, axis.format, scale);
    else lines(shapes, plot, data, axis.scale, center, axis.format, scale);
  }
  shapes.push(
    horizontal
      ? {
          type: 'line',
          x1: values.scale(0),
          y1: top,
          x2: values.scale(0),
          y2: bottom,
          role: 'axis',
        }
      : {
          type: 'line',
          x1: left,
          y1: values.scale(
            Math.max(
              values.scale.domain()[0],
              Math.min(0, values.scale.domain()[1])
            )
          ),
          x2: right,
          y2: values.scale(
            Math.max(
              values.scale.domain()[0],
              Math.min(0, values.scale.domain()[1])
            )
          ),
          role: 'axis',
        }
  );
  return { shapes };
}

function legendSwatch(
  shapes: ChartShape[],
  entry: { color: string; line: boolean },
  x: number,
  y: number,
  size: number
) {
  shapes.push(
    entry.line
      ? {
          type: 'path',
          d: `M${x},${y}H${x + size}`,
          stroke: entry.color,
          strokeWidth: 2,
        }
      : {
          type: 'rect',
          x,
          y: y - size / 2,
          width: size,
          height: size,
          fill: entry.color,
        }
  );
}

type Box = { top: number; bottom: number; left: number; right: number };
type Scale = ReturnType<typeof scaleLinear<number, number>>;

function bars(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  scale: Scale,
  center: (index: number) => number,
  band: number,
  horizontal: boolean,
  format: (value: number) => string
) {
  const stacked =
    plot.grouping === 'stacked' || plot.grouping === 'percentStacked';
  const groups = stacked ? 1 : plot.series.length;
  // Excel's default gap is 150% of a bar's width.
  const barWidth = band / (groups + 1.5);
  data.categories.forEach((category, index) => {
    let positive = 0;
    let negative = 0;
    const total = plot.series.reduce(
      (sum, series) => sum + Math.abs(series.values[index] ?? 0),
      0
    );
    plot.series.forEach((series, position) => {
      const raw = series.values[index];
      if (raw === null || raw === undefined) return;
      const value =
        plot.grouping === 'percentStacked' ? (total ? raw / total : 0) : raw;
      let from = 0;
      let to = value;
      if (stacked) {
        from = value >= 0 ? positive : negative;
        to = from + value;
        if (value >= 0) positive = to;
        else negative = to;
      }
      if (series.noFill) return;
      const offset = stacked ? 0 : position;
      const start = center(index) - (groups * barWidth) / 2 + offset * barWidth;
      const a = scale(from);
      const b = scale(to);
      const tip = `${series.name} · ${category}: ${format(raw)}`;
      shapes.push(
        horizontal
          ? {
              type: 'rect',
              x: Math.min(a, b),
              // Horizontal bars draw upward from the band's bottom.
              y:
                center(index) +
                (groups * barWidth) / 2 -
                (offset + 1) * barWidth,
              width: Math.max(Math.abs(b - a), 0.5),
              height: barWidth,
              fill: series.color,
              tip,
            }
          : {
              type: 'rect',
              x: start,
              y: Math.min(a, b),
              width: barWidth,
              height: Math.max(Math.abs(b - a), 0.5),
              fill: series.color,
              tip,
            }
      );
    });
  });
}

function lines(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  scale: Scale,
  center: (index: number) => number,
  format: (value: number) => string,
  zoom: number
) {
  const stacked =
    plot.grouping === 'stacked' || plot.grouping === 'percentStacked';
  const totals = data.categories.map((_, index) =>
    plot.series.reduce(
      (sum, series) => sum + Math.abs(series.values[index] ?? 0),
      0
    )
  );
  const base = data.categories.map(() => 0);
  const markers = data.categories.length <= 40;
  for (const series of plot.series) {
    const points = series.values.map((raw, index) => {
      if (raw === null) return undefined;
      let value =
        plot.grouping === 'percentStacked'
          ? totals[index]
            ? raw / totals[index]
            : 0
          : raw;
      if (stacked) value += base[index];
      return { x: center(index), y: scale(value), raw, index };
    });
    if (plot.kind === 'area' && !series.noFill) {
      const present = points.filter((point) => point !== undefined);
      if (present.length) {
        const floor = present
          .map(
            (point) => `L${point.x},${scale(stacked ? base[point.index] : 0)}`
          )
          .reverse()
          .join('');
        shapes.push({
          type: 'path',
          d: `M${present.map((point) => `${point.x},${point.y}`).join('L')}${floor}Z`,
          fill: series.color,
          opacity: stacked ? 1 : 0.85,
          tip: series.name,
        });
      }
    }
    if (stacked)
      series.values.forEach((raw, index) => {
        base[index] +=
          plot.grouping === 'percentStacked'
            ? totals[index]
              ? (raw ?? 0) / totals[index]
              : 0
            : (raw ?? 0);
      });
    if (plot.kind !== 'line') continue;
    // Gaps in the data break the line, as Excel shows blanks.
    let path = '';
    let open = false;
    for (const point of points) {
      if (!point) {
        open = false;
        continue;
      }
      path += `${open ? 'L' : 'M'}${point.x},${point.y}`;
      open = true;
    }
    if (path && !series.noLine)
      shapes.push({
        type: 'path',
        d: path,
        stroke: series.color,
        strokeWidth: 2 * zoom,
        tip: series.name,
      });
    if (markers || series.noLine)
      for (const point of points)
        if (point)
          shapes.push({
            type: 'circle',
            x: point.x,
            y: point.y,
            r: 2.5 * zoom,
            fill: series.color,
            tip: `${series.name} · ${data.categories[point.index]}: ${format(point.raw)}`,
          });
  }
}

function scatterChart(
  shapes: ChartShape[],
  data: ChartData,
  box: Box,
  font: number,
  zoom: number,
  valueScale: (
    plots: ChartPlotData[],
    range: [number, number]
  ) => { scale: Scale; ticks: number[]; format: (value: number) => string }
) {
  const plots = data.plots.filter(
    (plot) => plot.kind === 'scatter' || plot.kind === 'bubble'
  );
  // The largest bubble's radius: a quarter of the smaller side across, as
  // Excel draws bubbles at its default scale.
  const bubble = plots.some((plot) => plot.kind === 'bubble')
    ? Math.min(box.right - box.left, box.bottom - box.top) / 8
    : 0;
  /** An axis over values, widened so the largest bubble fits inside. */
  const axis = (
    values: (number | null)[],
    format: string | undefined,
    range: [number, number]
  ) => {
    const over = (extra: number[]) =>
      valueScale(
        [
          {
            kind: 'scatter',
            series: [
              {
                name: '',
                color: '',
                values: [...values, ...extra],
                sample: format,
              } satisfies ChartSeriesData,
            ],
          },
        ],
        range
      );
    const first = over([]);
    const numbers = values.filter((value): value is number => value !== null);
    if (!bubble || !numbers.length) return first;
    const [low, high] = first.scale.domain();
    const margin = (bubble * (high - low)) / Math.abs(range[1] - range[0]);
    return over([Math.min(...numbers) - margin, Math.max(...numbers) + margin]);
  };
  const x = axis(
    plots.flatMap((plot) => plot.series.flatMap((series) => series.x ?? [])),
    undefined,
    [box.left, box.right]
  );
  const y = axis(
    plots.flatMap((plot) => plot.series.flatMap((series) => series.values)),
    sample(plots),
    [box.bottom, box.top]
  );
  for (const tick of y.ticks) {
    shapes.push({
      type: 'line',
      x1: box.left,
      y1: y.scale(tick),
      x2: box.right,
      y2: y.scale(tick),
      role: 'grid',
    });
    shapes.push({
      type: 'text',
      x: box.left - 4 * zoom,
      y: y.scale(tick),
      text: y.format(tick),
      anchor: 'end',
      size: font,
      role: 'label',
      baseline: 'middle',
    });
  }
  for (const tick of x.ticks) {
    shapes.push({
      type: 'line',
      x1: x.scale(tick),
      y1: box.top,
      x2: x.scale(tick),
      y2: box.bottom,
      role: 'grid',
    });
    shapes.push({
      type: 'text',
      x: x.scale(tick),
      y: box.bottom + font * 1.2,
      text: x.format(tick),
      anchor: 'middle',
      size: font,
      role: 'label',
    });
  }
  // Bubble areas follow their sizes.
  const largest = Math.max(
    0,
    ...plots.flatMap((plot) =>
      plot.series.flatMap((series) =>
        (series.sizes ?? []).map((size) => Math.abs(size ?? 0))
      )
    )
  );
  for (const plot of plots)
    for (const series of plot.series) {
      const points = series.values.flatMap((value, index) => {
        const at = series.x?.[index];
        return value === null || at === null || at === undefined
          ? []
          : [{ x: x.scale(at), y: y.scale(value), value, at, index }];
      });
      if (plot.kind === 'bubble') {
        for (const point of points) {
          const size = series.sizes?.[point.index];
          const radius =
            size === null || size === undefined || !largest
              ? bubble / 2
              : Math.sqrt(Math.abs(size) / largest) * bubble;
          if (radius > 0)
            shapes.push({
              type: 'circle',
              x: point.x,
              y: point.y,
              r: radius,
              fill: series.color,
              opacity: 0.75,
              stroke: 'var(--color-surface)',
              tip: `${series.name}: (${x.format(point.at)}, ${y.format(point.value)})${size === null || size === undefined ? '' : `, ${size}`}`,
            });
        }
        continue;
      }
      if (!series.noLine && points.length > 1)
        shapes.push({
          type: 'path',
          d: `M${points.map((point) => `${point.x},${point.y}`).join('L')}`,
          stroke: series.color,
          strokeWidth: 2 * zoom,
          tip: series.name,
        });
      for (const point of points)
        shapes.push({
          type: 'circle',
          x: point.x,
          y: point.y,
          r: 2.5 * zoom,
          fill: series.color,
          tip: `${series.name}: (${x.format(point.at)}, ${y.format(point.value)})`,
        });
    }
}

function roundChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  box: Box
) {
  const series = plot.series[0];
  if (!series) return;
  const radius = Math.max(
    0,
    Math.min(box.right - box.left, box.bottom - box.top) / 2
  );
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const slices = pie<number>()
    .sort(null)
    .value((value) => Math.max(0, value))(
    series.values.map((value) => value ?? 0)
  );
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const shape = arc<(typeof slices)[number]>()
    .innerRadius(plot.kind === 'doughnut' ? radius * 0.5 : 0)
    .outerRadius(radius);
  slices.forEach((slice, index) => {
    const d = shape(slice);
    if (!d || !slice.value) return;
    shapes.push({
      type: 'path',
      // Arcs are centered at the origin.
      d,
      translate: [cx, cy],
      fill: data.palette[index % data.palette.length],
      stroke: 'var(--color-surface)',
      strokeWidth: 1,
      tip: `${data.categories[index] ?? ''}: ${Math.round((slice.value / (total || 1)) * 1000) / 10}%`,
    });
  });
}

const polygon = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${x},${y}`).join('L')}Z`;

/** A radar chart: one spoke per category, values outward from the center. */
function radarChart(
  shapes: ChartShape[],
  plots: ChartPlotData[],
  data: ChartData,
  box: Box,
  font: number,
  zoom: number
) {
  const count = Math.max(
    3,
    data.categories.length,
    ...plots.flatMap((plot) =>
      plot.series.map((series) => series.values.length)
    )
  );
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const radius =
    Math.min(box.right - box.left, box.bottom - box.top) / 2 - font * 1.6;
  if (radius < 10) return;
  const values = plots.flatMap((plot) =>
    plot.series.flatMap((series) =>
      series.values.filter((value): value is number => value !== null)
    )
  );
  const scale = scaleLinear()
    .domain([Math.min(0, ...values), Math.max(0, ...values) || 1])
    .range([0, radius])
    .nice(5);
  const ticks = scale.ticks(5);
  const format = tickFormat(
    sample(plots),
    ticks.length > 1 ? ticks[1] - ticks[0] : 1
  );
  const angle = (index: number) => -Math.PI / 2 + (2 * Math.PI * index) / count;
  const at = (index: number, distance: number): [number, number] => [
    cx + distance * Math.cos(angle(index)),
    cy + distance * Math.sin(angle(index)),
  ];
  for (const tick of ticks) {
    const distance = scale(tick);
    if (distance <= 0) continue;
    shapes.push({
      type: 'path',
      d: polygon(
        Array.from({ length: count }, (_, index) => at(index, distance))
      ),
      stroke: 'var(--color-edge-muted)',
      strokeWidth: 1,
    });
    shapes.push({
      type: 'text',
      x: cx + 3 * zoom,
      y: cy - distance,
      text: format(tick),
      anchor: 'start',
      size: font * 0.9,
      role: 'label',
      baseline: 'middle',
    });
  }
  for (let index = 0; index < count; index++) {
    const [x, y] = at(index, radius);
    shapes.push({ type: 'line', x1: cx, y1: cy, x2: x, y2: y, role: 'grid' });
    const [labelX, labelY] = at(index, radius + font * 0.9);
    const cosine = Math.cos(angle(index));
    shapes.push({
      type: 'text',
      x: labelX,
      y: labelY,
      text: truncate(data.categories[index] ?? `${index + 1}`, radius, font),
      anchor: Math.abs(cosine) < 0.3 ? 'middle' : cosine > 0 ? 'start' : 'end',
      size: font,
      role: 'label',
      baseline: 'middle',
    });
  }
  for (const plot of plots)
    for (const series of plot.series) {
      const points = series.values.flatMap((value, index) =>
        value === null ? [] : [{ at: at(index, scale(value)), value, index }]
      );
      if (!points.length) continue;
      shapes.push({
        type: 'path',
        d: polygon(points.map((point) => point.at)),
        stroke: series.color,
        strokeWidth: (plot.filled ? 1 : 2) * zoom,
        ...(plot.filled && { fill: series.color, opacity: 0.5 }),
        tip: series.name,
      });
      if (!plot.filled)
        for (const point of points)
          shapes.push({
            type: 'circle',
            x: point.at[0],
            y: point.at[1],
            r: 2.5 * zoom,
            fill: series.color,
            tip: `${series.name} · ${data.categories[point.index] ?? point.index + 1}: ${format(point.value)}`,
          });
    }
}

/**
 * Stock prices, as Excel draws them: a line from each category's highest
 * value to its lowest, and a bar from the first series (open) to the last
 * (close), white when it rose, or else a tick at the close.
 */
function stocks(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  scale: Scale,
  center: (index: number) => number,
  band: number,
  format: (value: number) => string,
  zoom: number
) {
  const first = plot.series[0];
  const last = plot.series.at(-1);
  const width = Math.max(3 * zoom, band * 0.5);
  const count = Math.max(
    data.categories.length,
    ...plot.series.map((series) => series.values.length)
  );
  for (let index = 0; index < count; index++) {
    const label = data.categories[index] ?? `${index + 1}`;
    const x = center(index);
    const values = plot.series
      .map((series) => series.values[index])
      .filter(
        (value): value is number => value !== null && value !== undefined
      );
    if (!values.length) continue;
    const high = Math.max(...values);
    const low = Math.min(...values);
    if (high !== low)
      shapes.push({
        type: 'path',
        d: `M${x},${scale(high)}V${scale(low)}`,
        stroke: 'var(--color-ink-muted)',
        strokeWidth: zoom,
        tip: `${label}: high ${format(high)}, low ${format(low)}`,
      });
    const open = first?.values[index] ?? null;
    const close = last?.values[index] ?? null;
    if (plot.upDown && open !== null && close !== null) {
      const top = scale(Math.max(open, close));
      const bottom = Math.max(top + 1, scale(Math.min(open, close)));
      shapes.push({
        type: 'path',
        d: `M${x - width / 2},${top}H${x + width / 2}V${bottom}H${x - width / 2}Z`,
        fill: close >= open ? 'var(--color-surface)' : 'var(--color-ink)',
        stroke: 'var(--color-ink)',
        strokeWidth: zoom,
        tip: `${label}: open ${format(open)}, close ${format(close)}`,
      });
    } else if (close !== null)
      shapes.push({
        type: 'path',
        d: `M${x},${scale(close)}H${x + width / 2}`,
        stroke: 'var(--color-ink)',
        strokeWidth: 1.5 * zoom,
        tip: `${last?.name ?? 'Close'} · ${label}: ${format(close)}`,
      });
  }
}

/** A surface's value bands, as a legend shows them, and each value's band. */
function surfaceBands(plot: ChartPlotData, palette: string[]) {
  const values = plot.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null)
  );
  const scale = scaleLinear()
    .domain([Math.min(0, ...values), Math.max(...values, 1)])
    .nice(Math.min(8, palette.length));
  const ticks = scale.ticks(Math.min(8, palette.length));
  const format = tickFormat(
    sample([plot]),
    ticks.length > 1 ? ticks[1] - ticks[0] : 1
  );
  const count = Math.max(1, ticks.length - 1);
  return {
    entries: Array.from({ length: count }, (_, index) => ({
      name: `${format(ticks[index])}–${format(ticks[index + 1] ?? ticks[index])}`,
      color: palette[index % palette.length],
      line: false,
    })),
    band: (value: number) => {
      let index = 0;
      while (index < count - 1 && value >= ticks[index + 1]) index++;
      return index;
    },
    format,
  };
}

/**
 * A surface seen from above, as Excel's contour charts show it: a cell per
 * category and series, colored by its value's band.
 */
function surfaceChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  box: Box,
  font: number,
  bands: ReturnType<typeof surfaceBands>
) {
  const rows = plot.series.length;
  const columns = Math.max(
    1,
    data.categories.length,
    ...plot.series.map((series) => series.values.length)
  );
  if (!rows) return;
  const labelWidth = Math.min(
    (box.right - box.left) * 0.3,
    Math.max(...plot.series.map((series) => series.name.length), 1) *
      font *
      CHARACTER_WIDTH +
      6
  );
  const left = box.left + labelWidth;
  const bottom = box.bottom - font * 1.6;
  const width = (box.right - left) / columns;
  const height = (bottom - box.top) / rows;
  if (width <= 0 || height <= 0) return;
  // The first series is at the bottom, as on Excel's series axis.
  plot.series.forEach((series, row) => {
    const y = bottom - (row + 1) * height;
    series.values.forEach((value, column) => {
      if (value === null) return;
      shapes.push({
        type: 'rect',
        x: left + column * width,
        y,
        width: width + 0.5,
        height: height + 0.5,
        fill: bands.entries[bands.band(value)].color,
        tip: `${series.name} · ${data.categories[column] ?? column + 1}: ${bands.format(value)}`,
      });
    });
    shapes.push({
      type: 'text',
      x: left - 4,
      y: y + height / 2,
      text: truncate(series.name, labelWidth - 6, font),
      anchor: 'end',
      size: font,
      role: 'label',
      baseline: 'middle',
    });
  });
  const every = Math.max(
    1,
    Math.ceil(
      (Math.max(...data.categories.map((label) => label.length), 1) *
        font *
        CHARACTER_WIDTH +
        4) /
        width
    )
  );
  data.categories.forEach((label, column) => {
    if (column % every) return;
    shapes.push({
      type: 'text',
      x: left + (column + 0.5) * width,
      y: bottom + font * 1.2,
      text: truncate(label, width * every - 2, font),
      anchor: 'middle',
      size: font,
      role: 'label',
    });
  });
}
