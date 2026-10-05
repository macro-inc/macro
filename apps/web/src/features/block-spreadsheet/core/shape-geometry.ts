/**
 * Outlines of Excel's preset shapes as SVG paths in a box of `width` by
 * `height` pixels, following the formulas of DrawingML's preset shape
 * definitions closely enough to read as the same shape. Presets Macro does
 * not know are drawn as their box.
 */

export type ShapeOutline = {
  /** Filled and stroked, unless `open`. */
  d: string;
  /** Edges drawn over the shape without fill, such as a cube's. */
  detail?: string;
  /** Lines, arcs and brackets: stroked only. */
  open?: true;
  /** Holes, as a frame's or a donut's, are cut by the even-odd rule. */
  evenOdd?: true;
  /** Where an open outline starts and ends, and its direction there. */
  start?: Tip;
  end?: Tip;
};

/** A point and the direction a line points there, in radians. */
export type Tip = { x: number; y: number; angle: number };

type Point = [number, number];

const polygon = (points: Point[]) =>
  `M${points.map(([x, y]) => `${round(x)},${round(y)}`).join('L')}Z`;
const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

function roundedRect(
  w: number,
  h: number,
  [topLeft, topRight, bottomRight, bottomLeft]: number[]
): string {
  const limit = Math.min(w, h) / 2;
  const [a, b, c, d] = [topLeft, topRight, bottomRight, bottomLeft].map(
    (radius) => clamp(radius, 0, limit)
  );
  return [
    `M${a},0H${w - b}`,
    b ? `A${b},${b} 0 0,1 ${w},${b}` : '',
    `V${h - c}`,
    c ? `A${c},${c} 0 0,1 ${w - c},${h}` : '',
    `H${d}`,
    d ? `A${d},${d} 0 0,1 0,${h - d}` : '',
    `V${a}`,
    a ? `A${a},${a} 0 0,1 ${a},0` : '',
    'Z',
  ].join('');
}

function snippedRect(
  w: number,
  h: number,
  [topLeft, topRight, bottomRight, bottomLeft]: number[]
): string {
  const limit = Math.min(w, h) / 2;
  const [a, b, c, d] = [topLeft, topRight, bottomRight, bottomLeft].map(
    (size) => clamp(size, 0, limit)
  );
  return polygon([
    [a, 0],
    [w - b, 0],
    [w, b],
    [w, h - c],
    [w - c, h],
    [d, h],
    [0, h - d],
    [0, a],
  ]);
}

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx},${cy}A${rx},${ry} 0 1,1 ${cx + rx},${cy}A${rx},${ry} 0 1,1 ${cx - rx},${cy}Z`;

/** A point on the ellipse filling the box, at an angle in degrees. */
function onEllipse(w: number, h: number, degrees: number): Point {
  const angle = (degrees * Math.PI) / 180;
  // DrawingML's angles are of the circle the ellipse is stretched from.
  const t = Math.atan2(w * Math.sin(angle), h * Math.cos(angle));
  return [w / 2 + (w / 2) * Math.cos(t), h / 2 + (h / 2) * Math.sin(t)];
}

function regular(w: number, h: number, sides: number, offset = -90): string {
  return polygon(
    Array.from({ length: sides }, (_, index) => {
      const angle = ((offset + (360 * index) / sides) * Math.PI) / 180;
      return [
        w / 2 + (w / 2) * Math.cos(angle),
        h / 2 + (h / 2) * Math.sin(angle),
      ];
    })
  );
}

function star(w: number, h: number, points: number, inner: number): string {
  return polygon(
    Array.from({ length: points * 2 }, (_, index) => {
      const angle = -Math.PI / 2 + (Math.PI * index) / points;
      const radius = index % 2 ? inner : 1;
      return [
        w / 2 + (w / 2) * radius * Math.cos(angle),
        h / 2 + (h / 2) * radius * Math.sin(angle),
      ];
    })
  );
}

/** An arrow pointing right in a box, as `rightArrow` draws it. */
function arrowRight(
  w: number,
  h: number,
  shaft: number,
  head: number
): Point[] {
  const ss = Math.min(w, h);
  const y1 = h / 2 - (h * clamp(shaft, 0, 100_000)) / 200_000;
  const y2 = h - y1;
  const x1 = w - clamp((ss * head) / 100_000, 0, w);
  return [
    [0, y1],
    [x1, y1],
    [x1, 0],
    [w, h / 2],
    [x1, h],
    [x1, y2],
    [0, y2],
  ];
}

/** Points turned to another direction within the box. */
function turned(
  points: Point[],
  w: number,
  h: number,
  direction: 'left' | 'up' | 'down'
): Point[] {
  if (direction === 'left') return points.map(([x, y]) => [w - x, y]);
  // Drawn pointing right in the transposed box, then turned.
  return points.map(([x, y]) => (direction === 'down' ? [y, x] : [y, h - x]));
}

function callout(
  w: number,
  h: number,
  tipX: number,
  tipY: number,
  body: 'rect' | 'round' | 'ellipse'
): string {
  const inside = tipX >= 0 && tipX <= w && tipY >= 0 && tipY <= h;
  const radius = body === 'round' ? Math.min(w, h) / 6 : 0;
  if (inside)
    return body === 'ellipse'
      ? ellipse(w / 2, h / 2, w / 2, h / 2)
      : roundedRect(w, h, [radius, radius, radius, radius]);
  if (body === 'ellipse') {
    // The pointer leaves the ellipse 10 degrees either side of the tip.
    const angle =
      (Math.atan2((tipY - h / 2) / h, (tipX - w / 2) / w) * 180) / Math.PI;
    const [x1, y1] = onEllipse(w, h, angle + 10);
    const [x2, y2] = onEllipse(w, h, angle - 10);
    return `M${round(x1)},${round(y1)}A${w / 2},${h / 2} 0 1,1 ${round(x2)},${round(y2)}L${round(tipX)},${round(tipY)}Z`;
  }
  const r = radius;
  const corner = (x: number, y: number, sweepX: number, sweepY: number) =>
    r ? `A${r},${r} 0 0,1 ${x + sweepX},${y + sweepY}` : '';
  const below = tipY > h;
  const above = tipY < 0;
  const side = below ? 'bottom' : above ? 'top' : tipX < 0 ? 'left' : 'right';
  const along = side === 'bottom' || side === 'top' ? w : h;
  const at = clamp(
    side === 'bottom' || side === 'top' ? tipX : tipY,
    along / 6,
    (along * 5) / 6
  );
  const half = along / 12;
  const tip = `L${round(tipX)},${round(tipY)}`;
  return [
    `M${r},0`,
    side === 'top' ? `H${at - half}${tip}L${at + half},0` : '',
    `H${w - r}`,
    corner(w - r, 0, r, r),
    side === 'right' ? `V${at - half}${tip}L${w},${at + half}` : '',
    `V${h - r}`,
    corner(w, h - r, -r, r),
    side === 'bottom' ? `H${at + half}${tip}L${at - half},${h}` : '',
    `H${r}`,
    corner(r, h, -r, -r),
    side === 'left' ? `V${at + half}${tip}L0,${at - half}` : '',
    `V${r}`,
    corner(0, r, r, -r),
    'Z',
  ].join('');
}

function wave(w: number, h: number, depth: number, double: boolean): string {
  const y1 = clamp((h * depth) / 100_000, 0, h / 3);
  if (double)
    return `M0,${y1}C${w / 6},${-y1} ${w / 3},${3 * y1} ${w / 2},${y1}C${(2 * w) / 3},${-y1} ${(5 * w) / 6},${3 * y1} ${w},${y1}V${h - y1}C${(5 * w) / 6},${h + y1} ${(2 * w) / 3},${h - 3 * y1} ${w / 2},${h - y1}C${w / 3},${h + y1} ${w / 6},${h - 3 * y1} 0,${h - y1}Z`;
  return `M0,${y1}C${w / 3},${-y1} ${(2 * w) / 3},${3 * y1} ${w},${y1}V${h - y1}C${(2 * w) / 3},${h + y1} ${w / 3},${h - 3 * y1} 0,${h - y1}Z`;
}

/** An arc of the ellipse filling the box, between angles in degrees. */
function arcPath(w: number, h: number, start: number, end: number) {
  const sweep = (((end - start) % 360) + 360) % 360 || 360;
  const [x1, y1] = onEllipse(w, h, start);
  const [x2, y2] = onEllipse(w, h, start + sweep);
  return {
    d: `M${round(x1)},${round(y1)}A${w / 2},${h / 2} 0 ${sweep > 180 ? 1 : 0},1 ${round(x2)},${round(y2)}`,
    from: [x1, y1] as Point,
    to: [x2, y2] as Point,
    sweep,
  };
}

const angleOf = (from: Point, to: Point) =>
  Math.atan2(to[1] - from[1], to[0] - from[0]);

/** An open outline through points, with its tips. */
function openPath(points: Point[]): ShapeOutline {
  const last = points.length - 1;
  return {
    d: `M${points.map(([x, y]) => `${round(x)},${round(y)}`).join('L')}`,
    open: true,
    start: {
      x: points[0][0],
      y: points[0][1],
      angle: angleOf(points[1], points[0]),
    },
    end: {
      x: points[last][0],
      y: points[last][1],
      angle: angleOf(points[last - 1], points[last]),
    },
  };
}

/** A lightning bolt, in the 21,600-unit box Excel defines it in. */
const LIGHTNING: Point[] = [
  [8458, 0],
  [0, 3923],
  [7564, 8416],
  [4993, 9720],
  [12197, 13904],
  [9987, 14934],
  [21600, 21600],
  [14768, 12911],
  [16558, 12016],
  [11030, 6840],
  [12831, 6120],
];

export function presetOutline(
  name: string | undefined,
  w: number,
  h: number,
  adjust: Record<string, number> = {}
): ShapeOutline {
  const ss = Math.min(w, h);
  const a = (guide: string, fallback: number) => adjust[guide] ?? fallback;
  const box = polygon([
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]);
  switch (name) {
    case undefined:
    case 'rect':
    case 'flowChartProcess':
    case 'actionButtonBlank':
      return { d: box };
    case 'roundRect': {
      const r = (ss * a('adj', 16_667)) / 100_000;
      return { d: roundedRect(w, h, [r, r, r, r]) };
    }
    case 'round1Rect': {
      const r = (ss * a('adj', 16_667)) / 100_000;
      return { d: roundedRect(w, h, [0, r, 0, 0]) };
    }
    case 'round2SameRect': {
      const top = (ss * a('adj1', 16_667)) / 100_000;
      const bottom = (ss * a('adj2', 0)) / 100_000;
      return { d: roundedRect(w, h, [top, top, bottom, bottom]) };
    }
    case 'round2DiagRect': {
      const first = (ss * a('adj1', 16_667)) / 100_000;
      const second = (ss * a('adj2', 0)) / 100_000;
      return { d: roundedRect(w, h, [first, second, first, second]) };
    }
    case 'flowChartAlternateProcess':
      return { d: roundedRect(w, h, Array(4).fill(ss / 6)) };
    case 'flowChartTerminator':
      return { d: roundedRect(w, h, Array(4).fill(ss / 2)) };
    case 'snip1Rect': {
      const size = (ss * a('adj', 16_667)) / 100_000;
      return { d: snippedRect(w, h, [0, size, 0, 0]) };
    }
    case 'snip2SameRect': {
      const top = (ss * a('adj1', 16_667)) / 100_000;
      const bottom = (ss * a('adj2', 0)) / 100_000;
      return { d: snippedRect(w, h, [top, top, bottom, bottom]) };
    }
    case 'snip2DiagRect': {
      const first = (ss * a('adj1', 0)) / 100_000;
      const second = (ss * a('adj2', 16_667)) / 100_000;
      return { d: snippedRect(w, h, [first, second, first, second]) };
    }
    case 'snipRoundRect':
    case 'flowChartPunchedCard': {
      const size =
        name === 'flowChartPunchedCard'
          ? ss / 5
          : (ss * a('adj2', 16_667)) / 100_000;
      return { d: snippedRect(w, h, [size, 0, 0, 0]) };
    }
    case 'ellipse':
    case 'flowChartConnector':
    case 'flowChartMagneticTape':
      return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'flowChartOr':
    case 'flowChartSummingJunction': {
      const r = Math.SQRT1_2 / 2;
      return {
        d: ellipse(w / 2, h / 2, w / 2, h / 2),
        detail:
          name === 'flowChartOr'
            ? `M${w / 2},0V${h}M0,${h / 2}H${w}`
            : `M${w * (0.5 - r)},${h * (0.5 - r)}L${w * (0.5 + r)},${h * (0.5 + r)}M${w * (0.5 + r)},${h * (0.5 - r)}L${w * (0.5 - r)},${h * (0.5 + r)}`,
      };
    }
    case 'triangle':
    case 'flowChartExtract':
    case 'isoscelesTriangle': {
      const x =
        name === 'flowChartExtract' ? w / 2 : (w * a('adj', 50_000)) / 100_000;
      return {
        d: polygon([
          [0, h],
          [x, 0],
          [w, h],
        ]),
      };
    }
    case 'flowChartMerge':
      return {
        d: polygon([
          [0, 0],
          [w, 0],
          [w / 2, h],
        ]),
      };
    case 'rtTriangle':
      return {
        d: polygon([
          [0, 0],
          [0, h],
          [w, h],
        ]),
      };
    case 'diamond':
    case 'flowChartDecision':
    case 'flowChartSort':
      return {
        d: polygon([
          [w / 2, 0],
          [w, h / 2],
          [w / 2, h],
          [0, h / 2],
        ]),
        ...(name === 'flowChartSort' && { detail: `M0,${h / 2}H${w}` }),
      };
    case 'parallelogram':
    case 'flowChartInputOutput': {
      const x =
        name === 'flowChartInputOutput'
          ? w / 5
          : clamp((ss * a('adj', 25_000)) / 100_000, 0, w);
      return {
        d: polygon([
          [0, h],
          [x, 0],
          [w, 0],
          [w - x, h],
        ]),
      };
    }
    case 'trapezoid': {
      const x = clamp((ss * a('adj', 25_000)) / 100_000, 0, w / 2);
      return {
        d: polygon([
          [0, h],
          [x, 0],
          [w - x, 0],
          [w, h],
        ]),
      };
    }
    case 'flowChartManualOperation':
      return {
        d: polygon([
          [0, 0],
          [w, 0],
          [(w * 4) / 5, h],
          [w / 5, h],
        ]),
      };
    case 'flowChartManualInput':
      return {
        d: polygon([
          [0, h / 5],
          [w, 0],
          [w, h],
          [0, h],
        ]),
      };
    case 'flowChartOffpageConnector':
      return {
        d: polygon([
          [0, 0],
          [w, 0],
          [w, (h * 4) / 5],
          [w / 2, h],
          [0, (h * 4) / 5],
        ]),
      };
    case 'pentagon':
      return {
        d: polygon([
          [w / 2, 0],
          [w, h * 0.382],
          [w * 0.809, h],
          [w * 0.191, h],
          [0, h * 0.382],
        ]),
      };
    case 'hexagon':
    case 'flowChartPreparation': {
      const x =
        name === 'flowChartPreparation'
          ? w / 5
          : clamp((ss * a('adj', 25_000)) / 100_000, 0, w / 2);
      return {
        d: polygon([
          [0, h / 2],
          [x, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [x, h],
        ]),
      };
    }
    case 'heptagon':
      return { d: regular(w, h, 7) };
    case 'decagon':
      return { d: regular(w, h, 10, 0) };
    case 'dodecagon':
      return { d: regular(w, h, 12, 15) };
    case 'octagon': {
      const x = clamp((ss * a('adj', 29_289)) / 100_000, 0, ss / 2);
      return {
        d: polygon([
          [x, 0],
          [w - x, 0],
          [w, x],
          [w, h - x],
          [w - x, h],
          [x, h],
          [0, h - x],
          [0, x],
        ]),
      };
    }
    case 'plus':
    case 'mathPlus':
    case 'cross': {
      const x =
        name === 'mathPlus'
          ? ss * 0.38
          : clamp((ss * a('adj', 25_000)) / 100_000, 0, ss / 2);
      return {
        d: polygon([
          [x, 0],
          [w - x, 0],
          [w - x, x],
          [w, x],
          [w, h - x],
          [w - x, h - x],
          [w - x, h],
          [x, h],
          [x, h - x],
          [0, h - x],
          [0, x],
          [x, x],
        ]),
      };
    }
    case 'mathMinus':
      return {
        d: polygon([
          [0, h * 0.38],
          [w, h * 0.38],
          [w, h * 0.62],
          [0, h * 0.62],
        ]),
      };
    case 'mathEqual':
      return {
        d: `${polygon([
          [0, h * 0.24],
          [w, h * 0.24],
          [w, h * 0.42],
          [0, h * 0.42],
        ])}${polygon([
          [0, h * 0.58],
          [w, h * 0.58],
          [w, h * 0.76],
          [0, h * 0.76],
        ])}`,
      };
    case 'mathMultiply': {
      const t = ss * 0.13;
      return {
        d: polygon([
          [t, 0],
          [w / 2, h / 2 - t],
          [w - t, 0],
          [w, t],
          [w / 2 + t, h / 2],
          [w, h - t],
          [w - t, h],
          [w / 2, h / 2 + t],
          [t, h],
          [0, h - t],
          [w / 2 - t, h / 2],
          [0, t],
        ]),
      };
    }
    case 'star4':
      return { d: star(w, h, 4, a('adj', 12_500) / 50_000) };
    case 'star5':
      return { d: star(w, h, 5, a('adj', 19_098) / 50_000) };
    case 'star6':
      return { d: star(w, h, 6, a('adj', 28_868) / 50_000) };
    case 'star7':
      return { d: star(w, h, 7, a('adj', 34_601) / 50_000) };
    case 'star8':
      return { d: star(w, h, 8, a('adj', 38_250) / 50_000) };
    case 'star10':
      return { d: star(w, h, 10, a('adj', 42_533) / 50_000) };
    case 'star12':
    case 'irregularSeal1':
      return { d: star(w, h, 12, a('adj', 37_500) / 50_000) };
    case 'star16':
    case 'irregularSeal2':
    case 'sun':
      return { d: star(w, h, 16, a('adj', 37_500) / 50_000) };
    case 'star24':
      return { d: star(w, h, 24, a('adj', 37_500) / 50_000) };
    case 'star32':
      return { d: star(w, h, 32, a('adj', 37_500) / 50_000) };
    case 'rightArrow':
    case 'stripedRightArrow':
      return {
        d: polygon(arrowRight(w, h, a('adj1', 50_000), a('adj2', 50_000))),
      };
    case 'leftArrow':
      return {
        d: polygon(
          turned(
            arrowRight(w, h, a('adj1', 50_000), a('adj2', 50_000)),
            w,
            h,
            'left'
          )
        ),
      };
    case 'downArrow':
    case 'upArrow':
      return {
        d: polygon(
          turned(
            arrowRight(h, w, a('adj1', 50_000), a('adj2', 50_000)),
            w,
            h,
            name === 'downArrow' ? 'down' : 'up'
          )
        ),
      };
    case 'notchedRightArrow': {
      const points = arrowRight(w, h, a('adj1', 50_000), a('adj2', 50_000));
      const notch = (w - points[1][0]) * ((h / 2 - points[0][1]) / (h / 2));
      return { d: polygon([...points, [notch, h / 2]]) };
    }
    case 'leftRightArrow': {
      const y1 = h / 2 - (h * clamp(a('adj1', 50_000), 0, 100_000)) / 200_000;
      const x = clamp((ss * a('adj2', 50_000)) / 100_000, 0, w / 2);
      return {
        d: polygon([
          [0, h / 2],
          [x, 0],
          [x, y1],
          [w - x, y1],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [w - x, h - y1],
          [x, h - y1],
          [x, h],
        ]),
      };
    }
    case 'upDownArrow': {
      const x1 = w / 2 - (w * clamp(a('adj1', 50_000), 0, 100_000)) / 200_000;
      const y = clamp((ss * a('adj2', 50_000)) / 100_000, 0, h / 2);
      return {
        d: polygon([
          [w / 2, 0],
          [w, y],
          [w - x1, y],
          [w - x1, h - y],
          [w, h - y],
          [w / 2, h],
          [0, h - y],
          [x1, h - y],
          [x1, y],
          [0, y],
        ]),
      };
    }
    case 'chevron': {
      const x = clamp((ss * a('adj', 50_000)) / 100_000, 0, w);
      return {
        d: polygon([
          [0, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [0, h],
          [x, h / 2],
        ]),
      };
    }
    case 'homePlate': {
      const x = clamp((ss * a('adj', 50_000)) / 100_000, 0, w);
      return {
        d: polygon([
          [0, 0],
          [w - x, 0],
          [w, h / 2],
          [w - x, h],
          [0, h],
        ]),
      };
    }
    case 'rightArrowCallout':
    case 'leftArrowCallout':
    case 'upArrowCallout':
    case 'downArrowCallout': {
      // A box with an arrow out of one side.
      const vertical = name === 'upArrowCallout' || name === 'downArrowCallout';
      const [bw, bh] = vertical ? [h, w] : [w, h];
      const head = clamp(
        (Math.min(bw, bh) * a('adj3', 25_000)) / 100_000,
        0,
        bw
      );
      const body = clamp((bw * a('adj4', 64_977)) / 100_000, 0, bw - head);
      const shaft = (bh * a('adj1', 25_000)) / 200_000;
      const wing = (bh * a('adj2', 25_000)) / 100_000;
      const points: Point[] = [
        [0, 0],
        [body, 0],
        [body, bh / 2 - wing],
        [bw - head, bh / 2 - wing],
        [bw - head, bh / 2 - wing - shaft / 2],
        [bw, bh / 2],
        [bw - head, bh / 2 + wing + shaft / 2],
        [bw - head, bh / 2 + wing],
        [body, bh / 2 + wing],
        [body, bh],
        [0, bh],
      ];
      return {
        d: polygon(
          name === 'rightArrowCallout'
            ? points
            : name === 'leftArrowCallout'
              ? turned(points, w, h, 'left')
              : turned(
                  points,
                  w,
                  h,
                  name === 'downArrowCallout' ? 'down' : 'up'
                )
        ),
      };
    }
    case 'line':
    case 'straightConnector1':
      return openPath([
        [0, 0],
        [w, h],
      ]);
    case 'bentConnector2':
      return openPath([
        [0, 0],
        [w, 0],
        [w, h],
      ]);
    case 'bentConnector3':
    case 'bentConnector4':
    case 'bentConnector5': {
      const x = (w * a('adj1', 50_000)) / 100_000;
      return openPath([
        [0, 0],
        [x, 0],
        [x, h],
        [w, h],
      ]);
    }
    case 'curvedConnector2':
      return {
        d: `M0,0C${w / 2},0 ${w},${h / 2} ${w},${h}`,
        open: true,
        start: { x: 0, y: 0, angle: Math.PI },
        end: { x: w, y: h, angle: Math.PI / 2 },
      };
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': {
      const x = (w * a('adj1', 50_000)) / 100_000;
      return {
        d: `M0,0C${x},0 ${x},${h} ${w},${h}`,
        open: true,
        start: { x: 0, y: 0, angle: Math.PI },
        end: { x: w, y: h, angle: 0 },
      };
    }
    case 'arc': {
      const arc = arcPath(
        w,
        h,
        a('adj1', 16_200_000) / 60_000,
        a('adj2', 0) / 60_000
      );
      const angle = (point: Point, ahead: number) =>
        Math.atan2(point[1] - h / 2, point[0] - w / 2) + ahead;
      return {
        d: arc.d,
        open: true,
        start: {
          x: arc.from[0],
          y: arc.from[1],
          angle: angle(arc.from, -Math.PI / 2),
        },
        end: { x: arc.to[0], y: arc.to[1], angle: angle(arc.to, Math.PI / 2) },
      };
    }
    case 'pie':
    case 'chord': {
      const arc = arcPath(
        w,
        h,
        a('adj1', name === 'pie' ? 0 : 2_700_000) / 60_000,
        a('adj2', 16_200_000) / 60_000
      );
      return { d: `${arc.d}${name === 'pie' ? `L${w / 2},${h / 2}` : ''}Z` };
    }
    case 'pieWedge':
      return { d: `M0,${h}A${w},${h} 0 0,1 ${w},0V${h}Z` };
    case 'blockArc': {
      const thickness = clamp((ss * a('adj3', 25_000)) / 100_000, 0, ss / 2);
      const [rx, ry] = [w / 2, h / 2];
      return {
        d: `M0,${ry}A${rx},${ry} 0 0,1 ${w},${ry}H${w - thickness}A${rx - thickness},${ry - thickness} 0 0,0 ${thickness},${ry}Z`,
      };
    }
    case 'donut':
    case 'noSmoking': {
      const thickness = clamp((ss * a('adj', 18_750)) / 100_000, 0, ss / 2);
      return {
        d: `${ellipse(w / 2, h / 2, w / 2, h / 2)}${ellipse(w / 2, h / 2, w / 2 - thickness, h / 2 - thickness)}`,
        evenOdd: true,
        ...(name === 'noSmoking' && {
          detail: `M${w * 0.22},${h * 0.22}L${w * 0.78},${h * 0.78}`,
        }),
      };
    }
    case 'frame': {
      const x = clamp((ss * a('adj1', 12_500)) / 100_000, 0, ss / 2);
      return {
        d: `${box}${polygon([
          [x, x],
          [x, h - x],
          [w - x, h - x],
          [w - x, x],
        ])}`,
        evenOdd: true,
      };
    }
    case 'bevel': {
      const x = clamp((ss * a('adj', 12_500)) / 100_000, 0, ss / 2);
      return {
        d: box,
        detail: `${polygon([
          [x, x],
          [w - x, x],
          [w - x, h - x],
          [x, h - x],
        ])}M0,0L${x},${x}M${w},0L${w - x},${x}M${w},${h}L${w - x},${h - x}M0,${h}L${x},${h - x}`,
      };
    }
    case 'corner': {
      const dy = clamp((ss * a('adj1', 50_000)) / 100_000, 0, h);
      const dx = clamp((ss * a('adj2', 50_000)) / 100_000, 0, w);
      return {
        d: polygon([
          [0, 0],
          [dx, 0],
          [dx, h - dy],
          [w, h - dy],
          [w, h],
          [0, h],
        ]),
      };
    }
    case 'plaque': {
      const x = clamp((ss * a('adj', 16_667)) / 100_000, 0, ss / 2);
      return {
        d: `M0,${x}A${x},${x} 0 0,0 ${x},0H${w - x}A${x},${x} 0 0,0 ${w},${x}V${h - x}A${x},${x} 0 0,0 ${w - x},${h}H${x}A${x},${x} 0 0,0 0,${h - x}Z`,
      };
    }
    case 'foldedCorner': {
      const fold = clamp((ss * a('adj', 16_667)) / 100_000, 0, ss);
      return {
        d: polygon([
          [0, 0],
          [w, 0],
          [w, h - fold],
          [w - fold, h],
          [0, h],
        ]),
        detail: `M${w - fold},${h}L${w - fold * 0.8},${h - fold * 0.8}L${w},${h - fold}`,
      };
    }
    case 'can':
    case 'flowChartMagneticDisk': {
      const ry =
        name === 'can'
          ? clamp((ss * a('adj', 25_000)) / 200_000, 0, h / 2)
          : h / 6;
      const rx = w / 2;
      return {
        d: `M0,${ry}A${rx},${ry} 0 0,1 ${w},${ry}V${h - ry}A${rx},${ry} 0 0,1 0,${h - ry}Z`,
        detail: `M0,${ry}A${rx},${ry} 0 0,0 ${w},${ry}`,
      };
    }
    case 'cube': {
      const depth = clamp((ss * a('adj', 25_000)) / 100_000, 0, ss);
      return {
        d: polygon([
          [0, depth],
          [depth, 0],
          [w, 0],
          [w, h - depth],
          [w - depth, h],
          [0, h],
        ]),
        detail: `M0,${depth}H${w - depth}L${w},0M${w - depth},${depth}V${h}`,
      };
    }
    case 'flowChartPredefinedProcess':
      return { d: box, detail: `M${w / 8},0V${h}M${(w * 7) / 8},0V${h}` };
    case 'flowChartInternalStorage':
      return { d: box, detail: `M${w / 8},0V${h}M0,${h / 8}H${w}` };
    case 'flowChartDocument':
    case 'flowChartMultidocument':
      return {
        d: `M0,0H${w}V${h * 0.8}C${w * 0.75},${h * 0.68} ${w * 0.25},${h * 1.05} 0,${h * 0.9}Z`,
      };
    case 'flowChartPunchedTape':
      return { d: wave(w, h, 10_000, false) };
    case 'flowChartDelay':
      return {
        d: `M0,0H${w / 2}A${w / 2},${h / 2} 0 0,1 ${w / 2},${h}H0Z`,
      };
    case 'flowChartDisplay':
      return {
        d: `M0,${h / 2}L${w / 6},0H${(w * 5) / 6}A${w / 6},${h / 2} 0 0,1 ${(w * 5) / 6},${h}H${w / 6}Z`,
      };
    case 'flowChartOnlineStorage':
      return {
        d: `M${w / 6},0H${w}A${w / 6},${h / 2} 0 0,0 ${w},${h}H${w / 6}A${w / 6},${h / 2} 0 0,1 ${w / 6},0Z`,
      };
    case 'flowChartCollate':
      return { d: `M0,0H${w}L0,${h}H${w}Z` };
    case 'wave':
      return { d: wave(w, h, a('adj1', 12_500), false) };
    case 'doubleWave':
      return { d: wave(w, h, a('adj1', 6_250), true) };
    case 'teardrop':
      return {
        d: `M0,${h / 2}A${w / 2},${h / 2} 0 0,1 ${w / 2},0H${w}V${h / 2}A${w / 2},${h / 2} 0 0,1 ${w / 2},${h}A${w / 2},${h / 2} 0 0,1 0,${h / 2}Z`,
      };
    case 'heart':
      return {
        d: `M${w / 2},${h / 4}C${w / 2},0 0,0 0,${h / 4}C0,${h / 2} ${w / 2},${(h * 3) / 4} ${w / 2},${h}C${w / 2},${(h * 3) / 4} ${w},${h / 2} ${w},${h / 4}C${w},0 ${w / 2},0 ${w / 2},${h / 4}Z`,
      };
    case 'lightningBolt':
      return {
        d: polygon(
          LIGHTNING.map(([x, y]) => [(x * w) / 21_600, (y * h) / 21_600])
        ),
      };
    case 'moon': {
      const inner = (w * clamp(a('adj', 50_000), 0, 87_500)) / 100_000;
      return {
        d: `M${w},0A${w},${h / 2} 0 0,0 ${w},${h}A${w - inner},${h / 2} 0 0,1 ${w},0Z`,
      };
    }
    case 'smileyFace':
      return {
        d: ellipse(w / 2, h / 2, w / 2, h / 2),
        detail: `${ellipse(w * 0.35, h * 0.38, w * 0.05, h * 0.05)}${ellipse(w * 0.65, h * 0.38, w * 0.05, h * 0.05)}M${w * 0.28},${h * 0.66}Q${w / 2},${h * 0.82} ${w * 0.72},${h * 0.66}`,
      };
    case 'cloud':
    case 'cloudCallout': {
      // Bumps around the ellipse filling the box.
      const bumps = 10;
      const points = Array.from({ length: bumps }, (_, index) =>
        onEllipse(w * 0.9, h * 0.86, (360 * index) / bumps - 90).map(
          (value, axis) => value + (axis ? h * 0.07 : w * 0.05)
        )
      );
      const radius = Math.max(w, h) / 7;
      return {
        d: `M${round(points[0][0])},${round(points[0][1])}${points
          .map((_, index) => {
            const next = points[(index + 1) % bumps];
            return `A${round(radius)},${round(radius)} 0 0,1 ${round(next[0])},${round(next[1])}`;
          })
          .join('')}Z`,
      };
    }
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout':
    case 'wedgeEllipseCallout':
      return {
        d: callout(
          w,
          h,
          w / 2 + (w * a('adj1', -20_833)) / 100_000,
          h / 2 + (h * a('adj2', 62_500)) / 100_000,
          name === 'wedgeRectCallout'
            ? 'rect'
            : name === 'wedgeRoundRectCallout'
              ? 'round'
              : 'ellipse'
        ),
      };
    case 'callout1':
    case 'callout2':
    case 'callout3':
    case 'borderCallout1':
    case 'borderCallout2':
    case 'borderCallout3':
    case 'accentCallout1':
    case 'accentCallout2':
    case 'accentCallout3':
    case 'accentBorderCallout1':
    case 'accentBorderCallout2':
    case 'accentBorderCallout3': {
      // A box and a leader line from it.
      const point = (
        y: string,
        x: string,
        fallbackY: number,
        fallbackX: number
      ) =>
        `${round((w * a(x, fallbackX)) / 100_000)},${round((h * a(y, fallbackY)) / 100_000)}`;
      const leader = `M${point('adj1', 'adj2', 18_750, -8_333)}L${point('adj3', 'adj4', 112_500, -38_333)}`;
      return { d: box, detail: leader };
    }
    case 'leftBracket':
    case 'rightBracket': {
      const y = clamp((ss * a('adj', 8_333)) / 100_000, 0, h / 2);
      const points = `M${w},0Q0,0 0,${y}V${h - y}Q0,${h} ${w},${h}`;
      return {
        d:
          name === 'leftBracket'
            ? points
            : `M0,0Q${w},0 ${w},${y}V${h - y}Q${w},${h} 0,${h}`,
        open: true,
      };
    }
    case 'bracketPair': {
      const r = clamp((ss * a('adj', 16_667)) / 100_000, 0, ss / 2);
      return {
        d: `M${r},0Q0,0 0,${r}V${h - r}Q0,${h} ${r},${h}M${w - r},0Q${w},0 ${w},${r}V${h - r}Q${w},${h} ${w - r},${h}`,
        open: true,
      };
    }
    case 'leftBrace':
    case 'rightBrace':
    case 'bracePair': {
      const y = clamp((ss * a('adj1', 8_333)) / 100_000, 0, h / 4);
      const middle = (h * a('adj2', 50_000)) / 100_000;
      const brace = (x0: number, x1: number, x2: number) =>
        `M${x2},0Q${x1},0 ${x1},${y}V${middle - y}Q${x1},${middle} ${x0},${middle}Q${x1},${middle} ${x1},${middle + y}V${h - y}Q${x1},${h} ${x2},${h}`;
      const d =
        name === 'leftBrace'
          ? brace(0, w / 2, w)
          : name === 'rightBrace'
            ? brace(w, w / 2, 0)
            : `${brace(0, w / 12, w / 6)}${brace(w, (w * 11) / 12, (w * 5) / 6)}`;
      return { d, open: true };
    }
    default: {
      // Arrows Macro does not draw point the same way, straight.
      const arrow = /Arrow/.exec(name ?? '');
      if (!arrow) return { d: box };
      const points = arrowRight(w, h, 50_000, 50_000);
      if (/Left|leftRight/.test(name ?? ''))
        return { d: polygon(turned(points, w, h, 'left')) };
      if (/Up/.test(name ?? ''))
        return {
          d: polygon(turned(arrowRight(h, w, 50_000, 50_000), w, h, 'up')),
        };
      if (/Down|uturn/i.test(name ?? ''))
        return {
          d: polygon(turned(arrowRight(h, w, 50_000, 50_000), w, h, 'down')),
        };
      return { d: polygon(points) };
    }
  }
}
