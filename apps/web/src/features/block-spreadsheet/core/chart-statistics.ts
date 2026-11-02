import type {
  ChartBinning,
  ChartOfPie,
} from '@macro-inc/spreadsheet/sheet-drawings';

/**
 * A histogram bin: values above `low` up to `high`, or the reverse when bins
 * are closed on the left. Underflow and overflow bins gather the values past
 * an edge.
 */
export type HistogramBin = {
  low: number;
  high: number;
  count: number;
  edge?: 'under' | 'over';
};

/** Bins at most, so a tiny width cannot make millions. */
const MAX_BINS = 1_000;

/** A quotient, snapped to a whole number when rounding put it just off one. */
function steps(distance: number, width: number) {
  const quotient = distance / width;
  const whole = Math.round(quotient);
  return Math.abs(quotient - whole) < 1e-9 * Math.max(1, Math.abs(quotient))
    ? whole
    : quotient;
}

function sampleDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squares = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

/**
 * Excel's histogram bins: from the smallest value (or the underflow edge),
 * of the set width, into the set number, or as wide as Scott's normal
 * reference rule, 3.5 standard deviations over the cube root of the count.
 */
export function histogramBins(
  values: number[],
  binning: ChartBinning
): HistogramBin[] {
  if (!values.length) return [];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const start = binning.underflow ?? low;
  const end = Math.max(start, binning.overflow ?? high);
  const width =
    binning.size ??
    (binning.count
      ? (end - start) / binning.count
      : (3.5 * sampleDeviation(values)) / Math.cbrt(values.length));
  const count =
    !(width > 0) || end === start
      ? 1
      : Math.min(
          MAX_BINS,
          binning.count ?? Math.max(1, Math.ceil(steps(end - start, width)))
        );
  const bins: HistogramBin[] = Array.from({ length: count }, (_, index) => ({
    low: start + index * (width > 0 ? width : 0),
    high:
      binning.count && index === count - 1
        ? end
        : width > 0
          ? start + (index + 1) * width
          : end,
    count: 0,
  }));
  const under: HistogramBin | undefined =
    binning.underflow === undefined
      ? undefined
      : { low: start, high: start, count: 0, edge: 'under' };
  const over: HistogramBin | undefined =
    binning.overflow === undefined
      ? undefined
      : { low: end, high: end, count: 0, edge: 'over' };
  const left = !!binning.closedLeft;
  for (const value of values) {
    if (under && (left ? value < start : value <= start)) {
      under.count++;
      continue;
    }
    if (over && (left ? value >= end : value > end)) {
      over.count++;
      continue;
    }
    const at = width > 0 ? steps(value - start, width) : 0;
    const index = left ? Math.floor(at) : Math.ceil(at) - 1;
    bins[Math.max(0, Math.min(count - 1, index))].count++;
  }
  return [...(under ? [under] : []), ...bins, ...(over ? [over] : [])];
}

/** Bins labeled as Excel labels them: `[1, 6]`, `(6, 11]`, `≤3`, `>9`. */
export function binLabels(
  bins: HistogramBin[],
  closedLeft: boolean,
  format: (value: number) => string
): string[] {
  const regular = bins.filter((bin) => !bin.edge);
  const first = regular[0];
  const last = regular.at(-1);
  const underflow = bins.some((bin) => bin.edge === 'under');
  const overflow = bins.some((bin) => bin.edge === 'over');
  return bins.map((bin) => {
    if (bin.edge === 'under')
      return `${closedLeft ? '<' : '≤'}${format(bin.high)}`;
    if (bin.edge === 'over')
      return `${closedLeft ? '≥' : '>'}${format(bin.low)}`;
    const range = `${format(bin.low)}, ${format(bin.high)}`;
    if (closedLeft)
      return bin === last && !overflow ? `[${range}]` : `[${range})`;
    return bin === first && !underflow ? `[${range}]` : `(${range}]`;
  });
}

/** Values summed by category, in the order categories first appear. */
export function sumByCategory(
  categories: string[],
  values: (number | null)[]
): { name: string; value: number }[] {
  const sums = new Map<string, number>();
  categories.forEach((name, index) =>
    sums.set(name, (sums.get(name) ?? 0) + (values[index] ?? 0))
  );
  return [...sums].map(([name, value]) => ({ name, value }));
}

/** A pareto chart's order, largest first, and its running share of the total. */
export function paretoOrder(values: number[]): {
  order: number[];
  cumulative: number[];
} {
  const order = values
    .map((_, index) => index)
    .sort((a, b) => values[b] - values[a]);
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  let running = 0;
  const cumulative = order.map((index) => {
    running += Math.max(0, values[index]);
    return total ? running / total : 0;
  });
  return { order, cumulative };
}

/**
 * A quartile of sorted values, interpolated as QUARTILE.INC, or as
 * QUARTILE.EXC with ranks past either end held at that end.
 */
export function quartile(
  sorted: number[],
  share: number,
  method: 'inclusive' | 'exclusive'
): number {
  const count = sorted.length;
  if (!count) return Number.NaN;
  const rank =
    method === 'inclusive' ? (count - 1) * share : (count + 1) * share - 1;
  if (rank <= 0) return sorted[0];
  if (rank >= count - 1) return sorted[count - 1];
  const below = Math.floor(rank);
  return sorted[below] + (rank - below) * (sorted[below + 1] - sorted[below]);
}

export type BoxStatistics = {
  q1: number;
  median: number;
  q3: number;
  mean: number;
  /** Whisker ends: the outermost values within 1.5 boxes of the box. */
  low: number;
  high: number;
  outliers: number[];
  /** Values within the whiskers. */
  inner: number[];
};

/** A box and its whiskers, as Excel's box and whisker charts draw them. */
export function boxStatistics(
  values: number[],
  method: 'inclusive' | 'exclusive'
): BoxStatistics {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quartile(sorted, 0.25, method);
  const q3 = quartile(sorted, 0.75, method);
  const reach = 1.5 * (q3 - q1);
  const inner = sorted.filter(
    (value) => value >= q1 - reach && value <= q3 + reach
  );
  return {
    q1,
    median: quartile(sorted, 0.5, method),
    q3,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    low: inner[0] ?? q1,
    high: inner.at(-1) ?? q3,
    outliers: sorted.filter(
      (value) => value < q1 - reach || value > q3 + reach
    ),
    inner,
  };
}

export type WaterfallStep = {
  from: number;
  to: number;
  kind: 'increase' | 'decrease' | 'total';
};

/**
 * Each waterfall bar: a change floats from the running total; a total stands
 * on zero at its own value, which the running total then continues from.
 */
export function waterfallSteps(
  values: (number | null)[],
  totals: number[] = []
): (WaterfallStep | undefined)[] {
  let running = 0;
  return values.map((value, index) => {
    if (value === null) return undefined;
    if (totals.includes(index)) {
      running = value;
      return { from: 0, to: value, kind: 'total' };
    }
    const from = running;
    running += value;
    return { from, to: running, kind: value >= 0 ? 'increase' : 'decrease' };
  });
}

export type HierarchyNode = {
  name: string;
  value: number;
  children: HierarchyNode[];
  /** The point a leaf draws. */
  point?: number;
};

/**
 * A tree of each point's path from its root, as treemaps and sunbursts read
 * columns of labels: a blank label continues the row above when a deeper
 * label follows, and otherwise ends the path there. Points without a
 * positive size are left out. Siblings are largest first.
 */
export function hierarchy(
  paths: string[][],
  sizes: (number | null)[]
): HierarchyNode[] {
  const roots: HierarchyNode[] = [];
  let previous: string[] = [];
  paths.forEach((row, point) => {
    const path: string[] = [];
    for (let level = 0; level < row.length; level++) {
      const label = row[level].trim();
      if (label) path.push(label);
      else if (row.slice(level + 1).some((deeper) => deeper.trim()))
        path.push(previous[level] ?? '');
      else break;
    }
    previous = path;
    const size = sizes[point];
    if (!path.length || size === null || size === undefined || !(size > 0))
      return;
    let siblings = roots;
    path.forEach((name, depth) => {
      let node = siblings.find((entry) => entry.name === name);
      if (!node) {
        node = { name, value: 0, children: [] };
        siblings.push(node);
      }
      node.value += size;
      if (depth === path.length - 1) node.point = point;
      siblings = node.children;
    });
  });
  const order = (nodes: HierarchyNode[]) => {
    nodes.sort((a, b) => b.value - a.value);
    for (const node of nodes) order(node.children);
  };
  order(roots);
  return roots;
}

export type Rect = { x: number; y: number; width: number; height: number };

/** The golden ratio d3 squarifies to. */
const RATIO = (1 + Math.sqrt(5)) / 2;

/**
 * Rectangles of `rect` with areas in proportion to `values`, largest first,
 * by the squarified treemap algorithm of Bruls, Huizing and van Wijk.
 */
export function squarify(values: number[], rect: Rect): Rect[] {
  const placed: Rect[] = [];
  let { x, y, width, height } = rect;
  let remaining = values.reduce((sum, value) => sum + value, 0);
  let start = 0;
  while (start < values.length) {
    let end = start;
    let sum = values[end++];
    let smallest = sum;
    let largest = sum;
    const alpha =
      Math.max(height / width, width / height) / (remaining * RATIO);
    let beta = sum * sum * alpha;
    let worst = Math.max(largest / beta, beta / smallest);
    for (; end < values.length; end++) {
      const value = values[end];
      const next = sum + value;
      beta = next * next * alpha;
      const ratio = Math.max(
        Math.max(largest, value) / beta,
        beta / Math.min(smallest, value)
      );
      if (ratio > worst) break;
      sum = next;
      smallest = Math.min(smallest, value);
      largest = Math.max(largest, value);
      worst = ratio;
    }
    const share = remaining ? sum / remaining : 1;
    // A row along the shorter side, filling the rest of the rectangle's length.
    if (width < height) {
      const rowHeight = height * share;
      let left = x;
      for (let index = start; index < end; index++) {
        const piece = sum ? (width * values[index]) / sum : 0;
        placed.push({ x: left, y, width: piece, height: rowHeight });
        left += piece;
      }
      y += rowHeight;
      height -= rowHeight;
    } else {
      const rowWidth = width * share;
      let top = y;
      for (let index = start; index < end; index++) {
        const piece = sum ? (height * values[index]) / sum : 0;
        placed.push({ x, y: top, width: rowWidth, height: piece });
        top += piece;
      }
      x += rowWidth;
      width -= rowWidth;
    }
    remaining -= sum;
    start = end;
  }
  return placed;
}

export type SunburstArc = {
  node: HierarchyNode;
  /** The top-level node the arc descends from. */
  root: HierarchyNode;
  depth: number;
  /** Radians clockwise from twelve o'clock. */
  start: number;
  end: number;
};

/** A sunburst's arcs, parents before their children. */
export function sunburst(roots: HierarchyNode[]): SunburstArc[] {
  const arcs: SunburstArc[] = [];
  const total = roots.reduce((sum, node) => sum + node.value, 0);
  if (!total) return arcs;
  const visit = (
    nodes: HierarchyNode[],
    depth: number,
    start: number,
    span: number,
    sum: number,
    root?: HierarchyNode
  ) => {
    let at = start;
    for (const node of nodes) {
      const sweep = (span * node.value) / sum;
      arcs.push({
        node,
        root: root ?? node,
        depth,
        start: at,
        end: at + sweep,
      });
      visit(node.children, depth + 1, at, sweep, node.value, root ?? node);
      at += sweep;
    }
  };
  visit(roots, 0, 0, 2 * Math.PI, total);
  return arcs;
}

/**
 * The points a pie of pie or bar of pie moves to its second plot. Without a
 * split, Excel's automatic one moves the last third.
 */
export function ofPieSecond(
  values: (number | null)[],
  ofPie: ChartOfPie
): number[] {
  const count = values.length;
  const indexes = values.map((_, index) => index);
  if (ofPie.split === 'custom')
    return indexes.filter((index) => ofPie.custom?.includes(index));
  if (ofPie.split === 'value')
    return indexes.filter(
      (index) => (values[index] ?? 0) < (ofPie.splitAt ?? 0)
    );
  if (ofPie.split === 'percent') {
    const total = values.reduce<number>(
      (sum, value) => sum + Math.max(0, value ?? 0),
      0
    );
    return indexes.filter(
      (index) =>
        total > 0 &&
        (Math.max(0, values[index] ?? 0) / total) * 100 < (ofPie.splitAt ?? 0)
    );
  }
  const moved = Math.min(
    Math.max(0, count - 1),
    ofPie.split === 'position'
      ? (ofPie.splitAt ?? 0)
      : Math.max(1, Math.round(count / 3))
  );
  return indexes.slice(count - moved);
}
