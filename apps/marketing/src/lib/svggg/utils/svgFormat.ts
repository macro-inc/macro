/*
<path> ━━━━━┳━┳━┳━ <path>
<line> ━━━━━┫ ┃ ┃
<polyline> ━┫ ┃ ┃
<polygon> ━━┛ ┃ ┃
              ┃ ┃
<circle> ━━┳━━┛ ┃
<ellipse> ━┛    ┃
                ┃
<rect> ━━━━━━━━━┛
*/

export interface LineAttrs {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PolyAttrs {
  points: string;
}

export interface CircleAttrs {
  cx: number;
  cy: number;
  r: number;
}

export interface EllipseAttrs {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface RectAttrs {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
  ry?: number;
}

export interface Coord {
  x: number;
  y: number;
}

const KAPPA = 0.5522847498307936;

export function relativeToAbsolute(coords: Coord[]): Coord[] {
  if (coords.length === 0) return [];

  const result: Coord[] = [coords[0]];
  let curX = coords[0].x;
  let curY = coords[0].y;

  for (let i = 1; i < coords.length; i++) {
    curX += coords[i].x;
    curY += coords[i].y;
    result.push({ x: curX, y: curY });
  }

  return result;
}

export function lineToPath(line: LineAttrs): string {
  const { x1, y1, x2, y2 } = line;
  return `M${x1} ${y1} L${x2} ${y2}`;
}

export function getLineAttrs(el: SVGLineElement): LineAttrs {
  return {
    x1: parseFloat(el.getAttribute('x1') || '0'),
    y1: parseFloat(el.getAttribute('y1') || '0'),
    x2: parseFloat(el.getAttribute('x2') || '0'),
    y2: parseFloat(el.getAttribute('y2') || '0'),
  };
}

function parsePoints(points: string): Coord[] {
  const nums = points
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const coords: Coord[] = [];

  for (let i = 0; i < nums.length - 1; i += 2) {
    coords.push({ x: nums[i], y: nums[i + 1] });
  }

  return coords;
}

export function polylineToPath(polyline: PolyAttrs): string {
  const coords = parsePoints(polyline.points);
  if (coords.length === 0) return '';

  const [first, ...rest] = coords;
  const parts = [`M${first.x} ${first.y}`];

  for (const pt of rest) {
    parts.push(`L${pt.x} ${pt.y}`);
  }

  return parts.join(' ');
}

export function getPolylineAttrs(el: SVGPolylineElement): PolyAttrs {
  return {
    points: el.getAttribute('points') || '',
  };
}

export function polygonToPath(polygon: PolyAttrs): string {
  const polylinePath = polylineToPath(polygon);
  if (!polylinePath) return '';
  return `${polylinePath} Z`;
}

export function getPolygonAttrs(el: SVGPolygonElement): PolyAttrs {
  return {
    points: el.getAttribute('points') || '',
  };
}

export function circleToPath(circle: CircleAttrs): string {
  const { cx, cy, r } = circle;

  if (r <= 0) return '';

  const k = r * KAPPA;

  return [
    `M${cx + r} ${cy}`,
    `C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
    `C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}`,
    `C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
    `C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
    'Z',
  ].join(' ');
}

export function getCircleAttrs(el: SVGCircleElement): CircleAttrs {
  return {
    cx: parseFloat(el.getAttribute('cx') || '0'),
    cy: parseFloat(el.getAttribute('cy') || '0'),
    r: parseFloat(el.getAttribute('r') || '0'),
  };
}

export function ellipseToPath(ellipse: EllipseAttrs): string {
  const { cx, cy, rx, ry } = ellipse;

  if (rx <= 0 || ry <= 0) return '';

  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  return [
    `M${cx + rx} ${cy}`,
    `C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}`,
    `C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}`,
    `C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}`,
    `C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}`,
    'Z',
  ].join(' ');
}

export function getEllipseAttrs(el: SVGEllipseElement): EllipseAttrs {
  return {
    cx: parseFloat(el.getAttribute('cx') || '0'),
    cy: parseFloat(el.getAttribute('cy') || '0'),
    rx: parseFloat(el.getAttribute('rx') || '0'),
    ry: parseFloat(el.getAttribute('ry') || '0'),
  };
}

function _cornerBezier(
  startX: number,
  startY: number,
  cornerX: number,
  cornerY: number,
  endX: number,
  endY: number,
  rx: number,
  ry: number
): string {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  const cp1x =
    startX + (cornerX - startX === 0 ? 0 : Math.sign(cornerX - startX) * kx);
  const cp1y =
    startY + (cornerY - startY === 0 ? 0 : Math.sign(cornerY - startY) * ky);
  const cp2x =
    endX - (endX - cornerX === 0 ? 0 : Math.sign(endX - cornerX) * kx);
  const cp2y =
    endY - (endY - cornerY === 0 ? 0 : Math.sign(endY - cornerY) * ky);

  return `C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${endX} ${endY}`;
}

export function rectToPath(rect: RectAttrs): string {
  const { x, y, width, height } = rect;
  let { rx = 0, ry = 0 } = rect;

  if (width <= 0 || height <= 0) return '';

  if (rx > 0 && ry === 0) ry = rx;
  if (ry > 0 && rx === 0) rx = ry;

  rx = Math.min(rx, width / 2);
  ry = Math.min(ry, height / 2);

  if (rx === 0 && ry === 0) {
    return [
      `M${x} ${y}`,
      `L${x + width} ${y}`,
      `L${x + width} ${y + height}`,
      `L${x} ${y + height}`,
      'Z',
    ].join(' ');
  }

  const kx = rx * KAPPA;
  const ky = ry * KAPPA;

  const right = x + width;
  const bottom = y + height;

  return [
    `M${x + rx} ${y}`,
    `L${right - rx} ${y}`,
    `C${right - rx + kx} ${y} ${right} ${y + ry - ky} ${right} ${y + ry}`,
    `L${right} ${bottom - ry}`,
    `C${right} ${bottom - ry + ky} ${right - rx + kx} ${bottom} ${right - rx} ${bottom}`,
    `L${x + rx} ${bottom}`,
    `C${x + rx - kx} ${bottom} ${x} ${bottom - ry + ky} ${x} ${bottom - ry}`,
    `L${x} ${y + ry}`,
    `C${x} ${y + ry - ky} ${x + rx - kx} ${y} ${x + rx} ${y}`,
    'Z',
  ].join(' ');
}

export function getRectAttrs(el: SVGRectElement): RectAttrs {
  return {
    x: parseFloat(el.getAttribute('x') || '0'),
    y: parseFloat(el.getAttribute('y') || '0'),
    width: parseFloat(el.getAttribute('width') || '0'),
    height: parseFloat(el.getAttribute('height') || '0'),
    rx: parseFloat(el.getAttribute('rx') || '0'),
    ry: parseFloat(el.getAttribute('ry') || '0'),
  };
}

export function elementToPath(el: SVGElement): string | null {
  const tagName = el.tagName.toLowerCase();

  switch (tagName) {
    case 'line':
      return lineToPath(getLineAttrs(el as SVGLineElement));
    case 'polyline':
      return polylineToPath(getPolylineAttrs(el as SVGPolylineElement));
    case 'polygon':
      return polygonToPath(getPolygonAttrs(el as SVGPolygonElement));
    case 'circle':
      return circleToPath(getCircleAttrs(el as SVGCircleElement));
    case 'ellipse':
      return ellipseToPath(getEllipseAttrs(el as SVGEllipseElement));
    case 'rect':
      return rectToPath(getRectAttrs(el as SVGRectElement));
    case 'path':
      return el.getAttribute('d');
    default:
      return null;
  }
}
