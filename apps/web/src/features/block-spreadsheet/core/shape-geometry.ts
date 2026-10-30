import { match as matchBranch } from 'ts-pattern';
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
  const calloutOrBracketOutline = (): ShapeOutline =>
    matchBranch(name)
      .with(
        'wedgeRectCallout',
        'wedgeRoundRectCallout',
        'wedgeEllipseCallout',
        (name): ShapeOutline => {
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
        }
      )
      .with(
        'callout1',
        'callout2',
        'callout3',
        'borderCallout1',
        'borderCallout2',
        'borderCallout3',
        'accentCallout1',
        'accentCallout2',
        'accentCallout3',
        'accentBorderCallout1',
        'accentBorderCallout2',
        'accentBorderCallout3',
        (): ShapeOutline => {
          {
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
        }
      )
      .with('leftBracket', 'rightBracket', (name): ShapeOutline => {
        {
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
      })
      .with('bracketPair', (): ShapeOutline => {
        {
          const r = clamp((ss * a('adj', 16_667)) / 100_000, 0, ss / 2);
          return {
            d: `M${r},0Q0,0 0,${r}V${h - r}Q0,${h} ${r},${h}M${w - r},0Q${w},0 ${w},${r}V${h - r}Q${w},${h} ${w - r},${h}`,
            open: true,
          };
        }
      })
      .with('leftBrace', 'rightBrace', 'bracePair', (name): ShapeOutline => {
        {
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
      })
      .otherwise((name): ShapeOutline => {
        {
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
              d: polygon(
                turned(arrowRight(h, w, 50_000, 50_000), w, h, 'down')
              ),
            };
          return { d: polygon(points) };
        }
      });
  const curvedOutline = (): ShapeOutline =>
    matchBranch(name)
      .with('flowChartDelay', (): ShapeOutline => {
        return {
          d: `M0,0H${w / 2}A${w / 2},${h / 2} 0 0,1 ${w / 2},${h}H0Z`,
        };
      })
      .with('flowChartDisplay', (): ShapeOutline => {
        return {
          d: `M0,${h / 2}L${w / 6},0H${(w * 5) / 6}A${w / 6},${h / 2} 0 0,1 ${(w * 5) / 6},${h}H${w / 6}Z`,
        };
      })
      .with('flowChartOnlineStorage', (): ShapeOutline => {
        return {
          d: `M${w / 6},0H${w}A${w / 6},${h / 2} 0 0,0 ${w},${h}H${w / 6}A${w / 6},${h / 2} 0 0,1 ${w / 6},0Z`,
        };
      })
      .with('flowChartCollate', (): ShapeOutline => {
        return { d: `M0,0H${w}L0,${h}H${w}Z` };
      })
      .with('wave', (): ShapeOutline => {
        return { d: wave(w, h, a('adj1', 12_500), false) };
      })
      .with('doubleWave', (): ShapeOutline => {
        return { d: wave(w, h, a('adj1', 6_250), true) };
      })
      .with('teardrop', (): ShapeOutline => {
        return {
          d: `M0,${h / 2}A${w / 2},${h / 2} 0 0,1 ${w / 2},0H${w}V${h / 2}A${w / 2},${h / 2} 0 0,1 ${w / 2},${h}A${w / 2},${h / 2} 0 0,1 0,${h / 2}Z`,
        };
      })
      .with('heart', (): ShapeOutline => {
        return {
          d: `M${w / 2},${h / 4}C${w / 2},0 0,0 0,${h / 4}C0,${h / 2} ${w / 2},${(h * 3) / 4} ${w / 2},${h}C${w / 2},${(h * 3) / 4} ${w},${h / 2} ${w},${h / 4}C${w},0 ${w / 2},0 ${w / 2},${h / 4}Z`,
        };
      })
      .with('lightningBolt', (): ShapeOutline => {
        return {
          d: polygon(
            LIGHTNING.map(([x, y]) => [(x * w) / 21_600, (y * h) / 21_600])
          ),
        };
      })
      .with('moon', (): ShapeOutline => {
        {
          const inner = (w * clamp(a('adj', 50_000), 0, 87_500)) / 100_000;
          return {
            d: `M${w},0A${w},${h / 2} 0 0,0 ${w},${h}A${w - inner},${h / 2} 0 0,1 ${w},0Z`,
          };
        }
      })
      .with('smileyFace', (): ShapeOutline => {
        return {
          d: ellipse(w / 2, h / 2, w / 2, h / 2),
          detail: `${ellipse(w * 0.35, h * 0.38, w * 0.05, h * 0.05)}${ellipse(w * 0.65, h * 0.38, w * 0.05, h * 0.05)}M${w * 0.28},${h * 0.66}Q${w / 2},${h * 0.82} ${w * 0.72},${h * 0.66}`,
        };
      })
      .with('cloud', 'cloudCallout', (): ShapeOutline => {
        {
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
      })
      .otherwise(calloutOrBracketOutline);
  const frameOrSolidOutline = (): ShapeOutline =>
    matchBranch(name)
      .with('donut', 'noSmoking', (name): ShapeOutline => {
        {
          const thickness = clamp((ss * a('adj', 18_750)) / 100_000, 0, ss / 2);
          return {
            d: `${ellipse(w / 2, h / 2, w / 2, h / 2)}${ellipse(w / 2, h / 2, w / 2 - thickness, h / 2 - thickness)}`,
            evenOdd: true,
            ...(name === 'noSmoking' && {
              detail: `M${w * 0.22},${h * 0.22}L${w * 0.78},${h * 0.78}`,
            }),
          };
        }
      })
      .with('frame', (): ShapeOutline => {
        {
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
      })
      .with('bevel', (): ShapeOutline => {
        {
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
      })
      .with('corner', (): ShapeOutline => {
        {
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
      })
      .with('plaque', (): ShapeOutline => {
        {
          const x = clamp((ss * a('adj', 16_667)) / 100_000, 0, ss / 2);
          return {
            d: `M0,${x}A${x},${x} 0 0,0 ${x},0H${w - x}A${x},${x} 0 0,0 ${w},${x}V${h - x}A${x},${x} 0 0,0 ${w - x},${h}H${x}A${x},${x} 0 0,0 0,${h - x}Z`,
          };
        }
      })
      .with('foldedCorner', (): ShapeOutline => {
        {
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
      })
      .with('can', 'flowChartMagneticDisk', (name): ShapeOutline => {
        {
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
      })
      .with('cube', (): ShapeOutline => {
        {
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
      })
      .with('flowChartPredefinedProcess', (): ShapeOutline => {
        return { d: box, detail: `M${w / 8},0V${h}M${(w * 7) / 8},0V${h}` };
      })
      .with('flowChartInternalStorage', (): ShapeOutline => {
        return { d: box, detail: `M${w / 8},0V${h}M0,${h / 8}H${w}` };
      })
      .with('flowChartDocument', 'flowChartMultidocument', (): ShapeOutline => {
        return {
          d: `M0,0H${w}V${h * 0.8}C${w * 0.75},${h * 0.68} ${w * 0.25},${h * 1.05} 0,${h * 0.9}Z`,
        };
      })
      .with('flowChartPunchedTape', (): ShapeOutline => {
        return { d: wave(w, h, 10_000, false) };
      })
      .otherwise(curvedOutline);
  const connectorOrArcOutline = (): ShapeOutline =>
    matchBranch(name)
      .with('chevron', (): ShapeOutline => {
        {
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
      })
      .with('homePlate', (): ShapeOutline => {
        {
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
      })
      .with(
        'rightArrowCallout',
        'leftArrowCallout',
        'upArrowCallout',
        'downArrowCallout',
        (name): ShapeOutline => {
          {
            // A box with an arrow out of one side.
            const vertical =
              name === 'upArrowCallout' || name === 'downArrowCallout';
            const [bw, bh] = vertical ? [h, w] : [w, h];
            const head = clamp(
              (Math.min(bw, bh) * a('adj3', 25_000)) / 100_000,
              0,
              bw
            );
            const body = clamp(
              (bw * a('adj4', 64_977)) / 100_000,
              0,
              bw - head
            );
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
        }
      )
      .with('line', 'straightConnector1', (): ShapeOutline => {
        return openPath([
          [0, 0],
          [w, h],
        ]);
      })
      .with('bentConnector2', (): ShapeOutline => {
        return openPath([
          [0, 0],
          [w, 0],
          [w, h],
        ]);
      })
      .with(
        'bentConnector3',
        'bentConnector4',
        'bentConnector5',
        (): ShapeOutline => {
          {
            const x = (w * a('adj1', 50_000)) / 100_000;
            return openPath([
              [0, 0],
              [x, 0],
              [x, h],
              [w, h],
            ]);
          }
        }
      )
      .with('curvedConnector2', (): ShapeOutline => {
        return {
          d: `M0,0C${w / 2},0 ${w},${h / 2} ${w},${h}`,
          open: true,
          start: { x: 0, y: 0, angle: Math.PI },
          end: { x: w, y: h, angle: Math.PI / 2 },
        };
      })
      .with(
        'curvedConnector3',
        'curvedConnector4',
        'curvedConnector5',
        (): ShapeOutline => {
          {
            const x = (w * a('adj1', 50_000)) / 100_000;
            return {
              d: `M0,0C${x},0 ${x},${h} ${w},${h}`,
              open: true,
              start: { x: 0, y: 0, angle: Math.PI },
              end: { x: w, y: h, angle: 0 },
            };
          }
        }
      )
      .with('arc', (): ShapeOutline => {
        {
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
            end: {
              x: arc.to[0],
              y: arc.to[1],
              angle: angle(arc.to, Math.PI / 2),
            },
          };
        }
      })
      .with('pie', 'chord', (name): ShapeOutline => {
        {
          const arc = arcPath(
            w,
            h,
            a('adj1', name === 'pie' ? 0 : 2_700_000) / 60_000,
            a('adj2', 16_200_000) / 60_000
          );
          return {
            d: `${arc.d}${name === 'pie' ? `L${w / 2},${h / 2}` : ''}Z`,
          };
        }
      })
      .with('pieWedge', (): ShapeOutline => {
        return { d: `M0,${h}A${w},${h} 0 0,1 ${w},0V${h}Z` };
      })
      .with('blockArc', (): ShapeOutline => {
        {
          const thickness = clamp(
            (ss * a('adj3', 25_000)) / 100_000,
            0,
            ss / 2
          );
          const [rx, ry] = [w / 2, h / 2];
          return {
            d: `M0,${ry}A${rx},${ry} 0 0,1 ${w},${ry}H${w - thickness}A${rx - thickness},${ry - thickness} 0 0,0 ${thickness},${ry}Z`,
          };
        }
      })
      .otherwise(frameOrSolidOutline);
  const arrowOutline = (): ShapeOutline =>
    matchBranch(name)
      .with('star8', (): ShapeOutline => {
        return { d: star(w, h, 8, a('adj', 38_250) / 50_000) };
      })
      .with('star10', (): ShapeOutline => {
        return { d: star(w, h, 10, a('adj', 42_533) / 50_000) };
      })
      .with('star12', 'irregularSeal1', (): ShapeOutline => {
        return { d: star(w, h, 12, a('adj', 37_500) / 50_000) };
      })
      .with('star16', 'irregularSeal2', 'sun', (): ShapeOutline => {
        return { d: star(w, h, 16, a('adj', 37_500) / 50_000) };
      })
      .with('star24', (): ShapeOutline => {
        return { d: star(w, h, 24, a('adj', 37_500) / 50_000) };
      })
      .with('star32', (): ShapeOutline => {
        return { d: star(w, h, 32, a('adj', 37_500) / 50_000) };
      })
      .with('rightArrow', 'stripedRightArrow', (): ShapeOutline => {
        return {
          d: polygon(arrowRight(w, h, a('adj1', 50_000), a('adj2', 50_000))),
        };
      })
      .with('leftArrow', (): ShapeOutline => {
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
      })
      .with('downArrow', 'upArrow', (name): ShapeOutline => {
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
      })
      .with('notchedRightArrow', (): ShapeOutline => {
        {
          const points = arrowRight(w, h, a('adj1', 50_000), a('adj2', 50_000));
          const notch = (w - points[1][0]) * ((h / 2 - points[0][1]) / (h / 2));
          return { d: polygon([...points, [notch, h / 2]]) };
        }
      })
      .with('leftRightArrow', (): ShapeOutline => {
        {
          const y1 =
            h / 2 - (h * clamp(a('adj1', 50_000), 0, 100_000)) / 200_000;
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
      })
      .with('upDownArrow', (): ShapeOutline => {
        {
          const x1 =
            w / 2 - (w * clamp(a('adj1', 50_000), 0, 100_000)) / 200_000;
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
      })
      .otherwise(connectorOrArcOutline);
  const starOrMathOutline = (): ShapeOutline =>
    matchBranch(name)
      .with('heptagon', (): ShapeOutline => {
        return { d: regular(w, h, 7) };
      })
      .with('decagon', (): ShapeOutline => {
        return { d: regular(w, h, 10, 0) };
      })
      .with('dodecagon', (): ShapeOutline => {
        return { d: regular(w, h, 12, 15) };
      })
      .with('octagon', (): ShapeOutline => {
        {
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
      })
      .with('plus', 'mathPlus', 'cross', (name): ShapeOutline => {
        {
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
      })
      .with('mathMinus', (): ShapeOutline => {
        return {
          d: polygon([
            [0, h * 0.38],
            [w, h * 0.38],
            [w, h * 0.62],
            [0, h * 0.62],
          ]),
        };
      })
      .with('mathEqual', (): ShapeOutline => {
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
      })
      .with('mathMultiply', (): ShapeOutline => {
        {
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
      })
      .with('star4', (): ShapeOutline => {
        return { d: star(w, h, 4, a('adj', 12_500) / 50_000) };
      })
      .with('star5', (): ShapeOutline => {
        return { d: star(w, h, 5, a('adj', 19_098) / 50_000) };
      })
      .with('star6', (): ShapeOutline => {
        return { d: star(w, h, 6, a('adj', 28_868) / 50_000) };
      })
      .with('star7', (): ShapeOutline => {
        return { d: star(w, h, 7, a('adj', 34_601) / 50_000) };
      })
      .otherwise(arrowOutline);
  const polygonOutline = (): ShapeOutline =>
    matchBranch(name)
      .with('flowChartOr', 'flowChartSummingJunction', (name): ShapeOutline => {
        {
          const r = Math.SQRT1_2 / 2;
          return {
            d: ellipse(w / 2, h / 2, w / 2, h / 2),
            detail:
              name === 'flowChartOr'
                ? `M${w / 2},0V${h}M0,${h / 2}H${w}`
                : `M${w * (0.5 - r)},${h * (0.5 - r)}L${w * (0.5 + r)},${h * (0.5 + r)}M${w * (0.5 + r)},${h * (0.5 - r)}L${w * (0.5 - r)},${h * (0.5 + r)}`,
          };
        }
      })
      .with(
        'triangle',
        'flowChartExtract',
        'isoscelesTriangle',
        (name): ShapeOutline => {
          {
            const x =
              name === 'flowChartExtract'
                ? w / 2
                : (w * a('adj', 50_000)) / 100_000;
            return {
              d: polygon([
                [0, h],
                [x, 0],
                [w, h],
              ]),
            };
          }
        }
      )
      .with('flowChartMerge', (): ShapeOutline => {
        return {
          d: polygon([
            [0, 0],
            [w, 0],
            [w / 2, h],
          ]),
        };
      })
      .with('rtTriangle', (): ShapeOutline => {
        return {
          d: polygon([
            [0, 0],
            [0, h],
            [w, h],
          ]),
        };
      })
      .with(
        'diamond',
        'flowChartDecision',
        'flowChartSort',
        (name): ShapeOutline => {
          return {
            d: polygon([
              [w / 2, 0],
              [w, h / 2],
              [w / 2, h],
              [0, h / 2],
            ]),
            ...(name === 'flowChartSort' && { detail: `M0,${h / 2}H${w}` }),
          };
        }
      )
      .with('parallelogram', 'flowChartInputOutput', (name): ShapeOutline => {
        {
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
      })
      .with('trapezoid', (): ShapeOutline => {
        {
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
      })
      .with('flowChartManualOperation', (): ShapeOutline => {
        return {
          d: polygon([
            [0, 0],
            [w, 0],
            [(w * 4) / 5, h],
            [w / 5, h],
          ]),
        };
      })
      .with('flowChartManualInput', (): ShapeOutline => {
        return {
          d: polygon([
            [0, h / 5],
            [w, 0],
            [w, h],
            [0, h],
          ]),
        };
      })
      .with('flowChartOffpageConnector', (): ShapeOutline => {
        return {
          d: polygon([
            [0, 0],
            [w, 0],
            [w, (h * 4) / 5],
            [w / 2, h],
            [0, (h * 4) / 5],
          ]),
        };
      })
      .with('pentagon', (): ShapeOutline => {
        return {
          d: polygon([
            [w / 2, 0],
            [w, h * 0.382],
            [w * 0.809, h],
            [w * 0.191, h],
            [0, h * 0.382],
          ]),
        };
      })
      .with('hexagon', 'flowChartPreparation', (name): ShapeOutline => {
        {
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
      })
      .otherwise(starOrMathOutline);
  return matchBranch(name)
    .with(
      undefined,
      'rect',
      'flowChartProcess',
      'actionButtonBlank',
      (): ShapeOutline => {
        return { d: box };
      }
    )
    .with('roundRect', (): ShapeOutline => {
      {
        const r = (ss * a('adj', 16_667)) / 100_000;
        return { d: roundedRect(w, h, [r, r, r, r]) };
      }
    })
    .with('round1Rect', (): ShapeOutline => {
      {
        const r = (ss * a('adj', 16_667)) / 100_000;
        return { d: roundedRect(w, h, [0, r, 0, 0]) };
      }
    })
    .with('round2SameRect', (): ShapeOutline => {
      {
        const top = (ss * a('adj1', 16_667)) / 100_000;
        const bottom = (ss * a('adj2', 0)) / 100_000;
        return { d: roundedRect(w, h, [top, top, bottom, bottom]) };
      }
    })
    .with('round2DiagRect', (): ShapeOutline => {
      {
        const first = (ss * a('adj1', 16_667)) / 100_000;
        const second = (ss * a('adj2', 0)) / 100_000;
        return { d: roundedRect(w, h, [first, second, first, second]) };
      }
    })
    .with('flowChartAlternateProcess', (): ShapeOutline => {
      return { d: roundedRect(w, h, Array(4).fill(ss / 6)) };
    })
    .with('flowChartTerminator', (): ShapeOutline => {
      return { d: roundedRect(w, h, Array(4).fill(ss / 2)) };
    })
    .with('snip1Rect', (): ShapeOutline => {
      {
        const size = (ss * a('adj', 16_667)) / 100_000;
        return { d: snippedRect(w, h, [0, size, 0, 0]) };
      }
    })
    .with('snip2SameRect', (): ShapeOutline => {
      {
        const top = (ss * a('adj1', 16_667)) / 100_000;
        const bottom = (ss * a('adj2', 0)) / 100_000;
        return { d: snippedRect(w, h, [top, top, bottom, bottom]) };
      }
    })
    .with('snip2DiagRect', (): ShapeOutline => {
      {
        const first = (ss * a('adj1', 0)) / 100_000;
        const second = (ss * a('adj2', 16_667)) / 100_000;
        return { d: snippedRect(w, h, [first, second, first, second]) };
      }
    })
    .with('snipRoundRect', 'flowChartPunchedCard', (name): ShapeOutline => {
      {
        const size =
          name === 'flowChartPunchedCard'
            ? ss / 5
            : (ss * a('adj2', 16_667)) / 100_000;
        return { d: snippedRect(w, h, [size, 0, 0, 0]) };
      }
    })
    .with(
      'ellipse',
      'flowChartConnector',
      'flowChartMagneticTape',
      (): ShapeOutline => {
        return { d: ellipse(w / 2, h / 2, w / 2, h / 2) };
      }
    )
    .otherwise(polygonOutline);
}
