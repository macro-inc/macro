import { arc, pie } from 'd3-shape';
import { valueText } from './chart-axis-scenes';
import type { ChartData, ChartPlotData } from './chart-data';
import {
  type Box,
  CHARACTER_WIDTH,
  type ChartShape,
  DEFAULT_GAP_WIDTHS,
  truncate,
} from './chart-shapes';
import {
  type HierarchyNode,
  hierarchy,
  ofPieSecond,
  type Rect,
  squarify,
  sunburst,
} from './chart-statistics';

const fits = (text: string, width: number, size: number) =>
  text.length * size * CHARACTER_WIDTH + 4 <= width;

/**
 * A funnel: a bar per category from the top down, centered, as wide as its
 * value against the largest, its value written inside.
 */
export function funnelChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  outer: Box,
  font: number,
  zoom: number
) {
  const count = Math.max(
    data.categories.length,
    ...plot.series.map((series) => series.values.length)
  );
  if (!count) return;
  const categories = Array.from(
    { length: count },
    (_, index) => data.categories[index] ?? `${index + 1}`
  );
  const labelWidth = Math.min(
    (outer.right - outer.left) * 0.3,
    Math.max(1, ...categories.map((label) => label.length)) *
      font *
      CHARACTER_WIDTH +
      6 * zoom
  );
  const left = outer.left + labelWidth;
  const width = outer.right - left;
  const totals = categories.map((_, index) =>
    plot.series.reduce(
      (sum, series) => sum + Math.max(0, series.values[index] ?? 0),
      0
    )
  );
  const largest = Math.max(0, ...totals);
  if (width < 20 || !largest) return;
  const band = (outer.bottom - outer.top) / count;
  const height =
    band / (1 + (plot.gapWidth ?? DEFAULT_GAP_WIDTHS.funnel ?? 0) / 100);
  const middle = left + width / 2;
  categories.forEach((category, index) => {
    const y = outer.top + band * index + (band - height) / 2;
    shapes.push({
      type: 'text',
      x: left - 4 * zoom,
      y: y + height / 2,
      text: truncate(category, labelWidth - 6 * zoom, font),
      anchor: 'end',
      size: font,
      role: 'label',
      baseline: 'middle',
    });
    let x = middle - ((totals[index] / largest) * width) / 2;
    for (const series of plot.series) {
      const value = series.values[index];
      if (value === null || value === undefined || value <= 0) continue;
      const piece = (value / largest) * width;
      const text = valueText(series.sample)(value);
      shapes.push({
        type: 'rect',
        x,
        y,
        width: piece,
        height,
        fill: series.color,
        tip: `${plot.series.length > 1 ? `${series.name} · ` : ''}${category}: ${text}`,
      });
      if (plot.labels && fits(text, piece, font))
        shapes.push({
          type: 'text',
          x: x + piece / 2,
          y: y + height / 2,
          text,
          anchor: 'middle',
          size: font,
          role: 'inside',
          baseline: 'middle',
        });
      x += piece;
    }
  });
}

/** A treemap's or sunburst's tree, from its first series. */
export function chartTree(plot: ChartPlotData, data: ChartData) {
  const series = plot.series[0];
  return series
    ? hierarchy(
        data.paths ?? data.categories.map((category) => [category]),
        series.values
      )
    : [];
}

/** The color of each top-level branch, from the palette in order. */
const branchColor = (roots: HierarchyNode[], palette: string[]) => {
  const colors = new Map(
    roots.map((root, index) => [root, palette[index % palette.length]])
  );
  return (root: HierarchyNode) => colors.get(root) ?? palette[0];
};

/**
 * A treemap: rectangles in proportion to sizes, nested by level and colored
 * by top-level branch. Parents are named over their children's top-left
 * corner, in a banner above them, or not at all.
 */
export function treemapChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  outer: Box,
  font: number,
  zoom: number
) {
  const roots = chartTree(plot, data);
  const color = branchColor(roots, data.palette);
  const format = valueText(plot.series[0]?.sample);
  const banner = font * 1.6;
  const leafLabels: ChartShape[] = [];
  const parentLabels: ChartShape[] = [];
  const place = (
    nodes: HierarchyNode[],
    rect: Rect,
    path: string[],
    root: HierarchyNode | undefined,
    /** The corner a parent's name is written in, under `overlapping`. */
    corner?: { x: number; y: number }
  ) => {
    const rects = squarify(
      nodes.map((node) => node.value),
      rect
    );
    nodes.forEach((node, index) => {
      const at = rects[index];
      const branch = root ?? node;
      const names = [...path, node.name];
      const tip = `${names.join(' › ')}: ${format(node.value)}`;
      if (node.children.length) {
        if (plot.parentLabels === 'banner' && at.height > banner * 2) {
          shapes.push({
            type: 'rect',
            ...at,
            height: banner,
            fill: color(branch),
            stroke: 'var(--color-surface)',
            tip,
          });
          parentLabels.push({
            type: 'text',
            x: at.x + 4 * zoom,
            y: at.y + banner / 2,
            text: truncate(node.name, at.width - 8 * zoom, font),
            anchor: 'start',
            size: font,
            role: 'inside',
            baseline: 'middle',
            bold: true,
          });
          place(
            node.children,
            { ...at, y: at.y + banner, height: at.height - banner },
            names,
            branch
          );
          return;
        }
        const named =
          plot.parentLabels !== 'none' && fits(node.name, at.width, font);
        place(
          node.children,
          at,
          names,
          branch,
          named ? { x: at.x, y: at.y } : corner
        );
        if (named)
          parentLabels.push({
            type: 'text',
            x: at.x + 4 * zoom,
            y: at.y + 4 * zoom,
            text: node.name,
            anchor: 'start',
            size: font * 1.15,
            role: 'inside',
            baseline: 'hanging',
            bold: true,
          });
        return;
      }
      shapes.push({
        type: 'rect',
        ...at,
        fill: color(branch),
        stroke: 'var(--color-surface)',
        tip,
      });
      // A leaf in the corner a parent is named in writes its name below.
      const shifted =
        !!corner &&
        Math.abs(at.x - corner.x) < 0.5 &&
        Math.abs(at.y - corner.y) < 0.5;
      const top = at.y + 4 * zoom + (shifted ? font * 1.5 : 0);
      if (top + font <= at.y + at.height && fits(node.name, at.width, font))
        leafLabels.push({
          type: 'text',
          x: at.x + 4 * zoom,
          y: top,
          text: node.name,
          anchor: 'start',
          size: font,
          role: 'inside',
          baseline: 'hanging',
        });
    });
  };
  place(
    roots,
    {
      x: outer.left,
      y: outer.top,
      width: outer.right - outer.left,
      height: outer.bottom - outer.top,
    },
    [],
    undefined
  );
  shapes.push(...leafLabels, ...parentLabels);
}

/**
 * A sunburst: a ring per level from the center out, each arc as wide as its
 * share of its parent, starting at twelve o'clock and colored by branch.
 */
export function sunburstChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  outer: Box,
  font: number
) {
  const roots = chartTree(plot, data);
  const arcs = sunburst(roots);
  if (!arcs.length) return;
  const color = branchColor(roots, data.palette);
  const format = valueText(plot.series[0]?.sample);
  const levels = Math.max(...arcs.map((value) => value.depth)) + 1;
  const radius =
    Math.min(outer.right - outer.left, outer.bottom - outer.top) / 2;
  // An empty center half a ring wide, as Excel leaves one.
  const ring = radius / (levels + 0.5);
  const center: [number, number] = [
    (outer.left + outer.right) / 2,
    (outer.top + outer.bottom) / 2,
  ];
  // Each arc's names from its root, parents coming before their children.
  const names = new Map<HierarchyNode, string[]>();
  for (const root of roots) names.set(root, [root.name]);
  const shape = arc();
  const labels: ChartShape[] = [];
  for (const value of arcs) {
    const path = names.get(value.node) ?? [value.node.name];
    for (const child of value.node.children)
      names.set(child, [...path, child.name]);
    const inner = ring / 2 + value.depth * ring;
    const geometry = {
      innerRadius: inner,
      outerRadius: inner + ring,
      startAngle: value.start,
      endAngle: value.end,
    };
    const d = shape(geometry);
    if (!d) continue;
    shapes.push({
      type: 'path',
      d,
      translate: center,
      fill: color(value.root),
      stroke: 'var(--color-surface)',
      strokeWidth: 1,
      tip: `${path.join(' › ')}: ${format(value.node.value)}`,
    });
    const length = (value.end - value.start) * (inner + ring / 2);
    const text = value.node.name;
    if (ring >= font * 1.4 && fits(text, length, font * 0.9)) {
      const [x, y] = shape.centroid(geometry);
      labels.push({
        type: 'text',
        x: center[0] + x,
        y: center[1] + y,
        text,
        anchor: 'middle',
        size: font * 0.9,
        role: 'inside',
        baseline: 'middle',
      });
    }
  }
  shapes.push(...labels);
}

/**
 * A pie of pie or bar of pie: the split points gathered into one slice of
 * the first pie, facing a smaller pie or a stacked bar that shows them, with
 * lines joining the two.
 */
export function ofPieChart(
  shapes: ChartShape[],
  plot: ChartPlotData,
  data: ChartData,
  outer: Box
) {
  const series = plot.series[0];
  const ofPie = plot.ofPie;
  if (!series || !ofPie) return;
  const values = series.values.map((value) => Math.max(0, value ?? 0));
  const second = new Set(ofPieSecond(series.values, ofPie));
  const total = values.reduce((sum, value) => sum + value, 0);
  const share = (value: number) =>
    `${Math.round((value / (total || 1)) * 1000) / 10}%`;
  const color = (index: number) => data.palette[index % data.palette.length];
  const label = (index: number) => data.categories[index] ?? `${index + 1}`;
  const main = values.flatMap((value, index) =>
    second.has(index) ? [] : [{ value, index }]
  );
  const moved = values.flatMap((value, index) =>
    second.has(index) ? [{ value, index }] : []
  );
  const other = moved.reduce((sum, entry) => sum + entry.value, 0);
  const ratio = (ofPie.size ?? 75) / 100;
  // The gap between the plots is 40% of the first pie's radius.
  const width = outer.right - outer.left;
  const height = outer.bottom - outer.top;
  const radius = Math.max(0, Math.min(height / 2, width / (2.4 + 2 * ratio)));
  const smaller = radius * ratio;
  const span = 2.4 * radius + 2 * smaller;
  const cy = (outer.top + outer.bottom) / 2;
  const cx = outer.left + (width - span) / 2 + radius;
  const cx2 = cx + 1.4 * radius + smaller;
  const slices = [...main, { value: other, index: -1 }];
  // The gathered slice faces the second plot, centered at three o'clock.
  const sweep = total ? (2 * Math.PI * other) / total : 0;
  const start = Math.PI / 2 + sweep / 2 - 2 * Math.PI;
  const angles = pie<{ value: number; index: number }>()
    .sort(null)
    .value((entry) => entry.value)
    .startAngle(start)
    .endAngle(start + 2 * Math.PI)(slices);
  const shape = arc<(typeof angles)[number]>()
    .innerRadius(0)
    .outerRadius(radius);
  angles.forEach((slice) => {
    const d = shape(slice);
    if (!d || !slice.value) return;
    const gathered = slice.data.index < 0;
    shapes.push({
      type: 'path',
      d,
      translate: [cx, cy],
      fill: color(gathered ? values.length : slice.data.index),
      stroke: 'var(--color-surface)',
      strokeWidth: 1,
      tip: `${gathered ? 'Other' : label(slice.data.index)}: ${share(slice.value)}`,
    });
  });
  if (!other) return;
  const edge = (angle: number): [number, number] => [
    cx + radius * Math.sin(angle),
    cy - radius * Math.cos(angle),
  ];
  const [upper, lower] = [Math.PI / 2 - sweep / 2, Math.PI / 2 + sweep / 2].map(
    edge
  );
  let joins: [[number, number], [number, number]];
  if (ofPie.type === 'bar') {
    const barWidth = smaller * 0.8;
    const x = cx2 - barWidth / 2;
    let y = cy - smaller;
    for (const entry of moved) {
      const piece = (entry.value / other) * 2 * smaller;
      shapes.push({
        type: 'rect',
        x,
        y,
        width: barWidth,
        height: piece,
        fill: color(entry.index),
        stroke: 'var(--color-surface)',
        tip: `${label(entry.index)}: ${share(entry.value)}`,
      });
      y += piece;
    }
    joins = [
      [x, cy - smaller],
      [x, cy + smaller],
    ];
  } else {
    // The second pie's slices are centered at nine o'clock, facing the first.
    const secondAngles = pie<{ value: number; index: number }>()
      .sort(null)
      .value((entry) => entry.value)
      .startAngle(Math.PI / 2)
      .endAngle(Math.PI / 2 + 2 * Math.PI)(moved);
    const secondShape = arc<(typeof secondAngles)[number]>()
      .innerRadius(0)
      .outerRadius(smaller);
    for (const slice of secondAngles) {
      const d = secondShape(slice);
      if (!d || !slice.value) continue;
      shapes.push({
        type: 'path',
        d,
        translate: [cx2, cy],
        fill: color(slice.data.index),
        stroke: 'var(--color-surface)',
        strokeWidth: 1,
        tip: `${label(slice.data.index)}: ${share(slice.value)}`,
      });
    }
    joins = [
      [cx2, cy - smaller],
      [cx2, cy + smaller],
    ];
  }
  for (const [from, to] of [
    [upper, joins[0]],
    [lower, joins[1]],
  ])
    shapes.push({
      type: 'path',
      d: `M${from[0]},${from[1]}L${to[0]},${to[1]}`,
      stroke: 'var(--color-ink-muted)',
      strokeWidth: 1,
    });
}
