/**
 * A tiny raster painter for the challenge images: a speckled background,
 * filled shapes, arrows and blocky digits, encoded as metadata-free PNGs.
 */
import { encodePng } from './png.ts';
import type { Random } from './random.ts';

export const SHAPES = ['circle', 'square', 'triangle'] as const;
export type Shape = (typeof SHAPES)[number];

export const COLOR_NAMES = ['red', 'blue', 'green', 'orange'] as const;
export type Color = (typeof COLOR_NAMES)[number];
const COLORS: Record<Color, readonly number[]> = {
  red: [215, 38, 38],
  blue: [37, 84, 222],
  green: [28, 150, 58],
  orange: [235, 140, 20],
};
const INK = [40, 40, 48];

/** Whether a point, relative to the shape's centre, is inside it. */
const insideShape = (
  shape: Shape,
  radius: number,
  dx: number,
  dy: number
): boolean => {
  if (shape === 'circle') return dx * dx + dy * dy <= radius * radius;
  if (shape === 'square') {
    const half = radius * 0.85;
    return Math.abs(dx) <= half && Math.abs(dy) <= half;
  }

  // An upright triangle: apex at the top, base at the bottom.
  const top = -radius;
  const bottom = radius * 0.8;
  if (dy < top || dy > bottom) return false;
  const halfWidth = (radius * (dy - top)) / (bottom - top);
  return Math.abs(dx) <= halfWidth;
};

/** An arrow pointing up in its own frame: a shaft and a head. */
const insideUpArrow = (length: number, x: number, y: number): boolean => {
  const half = length / 2;
  const headHeight = length * 0.4;
  const headTop = -half;
  const headBottom = -half + headHeight;
  if (y >= headTop && y <= headBottom) {
    const halfWidth = ((y - headTop) / headHeight) * length * 0.32;
    return Math.abs(x) <= halfWidth;
  }
  return y > headBottom && y <= half && Math.abs(x) <= length * 0.09;
};

/**
 * 5×7 digit glyphs, one string per row. Only digits are drawn: the
 * transcription family's charset.
 */
const DIGITS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
};

/** Every mark is a predicate over image pixels plus a colour. */
type Mark = {
  covers: (x: number, y: number) => boolean;
  rgb: readonly number[];
};

export class Canvas {
  private readonly marks: Mark[] = [];

  constructor(
    readonly width: number,
    readonly height: number
  ) {}

  shape(shape: Shape, color: Color, x: number, y: number, radius: number) {
    this.marks.push({
      covers: (px, py) => insideShape(shape, radius, px - x, py - y),
      rgb: COLORS[color],
    });
  }

  /** An arrow centred at (x, y), turned `degrees` clockwise from up. */
  arrow(color: Color, x: number, y: number, length: number, degrees: number) {
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.marks.push({
      // Rotate the pixel back into the arrow's upright frame.
      covers: (px, py) => {
        const dx = px - x;
        const dy = py - y;
        return insideUpArrow(length, dx * cos + dy * sin, -dx * sin + dy * cos);
      },
      rgb: COLORS[color],
    });
  }

  /**
   * One digit with its top-left near (x, y), `scale` pixels per glyph cell,
   * sheared and turned slightly so it is not a clean template.
   */
  digit(
    digit: string,
    x: number,
    y: number,
    scale: number,
    shear: number,
    degrees: number
  ) {
    const rows = DIGITS[digit];
    if (rows === undefined) throw new Error('not a drawable digit');
    const angle = (degrees * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const centreX = x + (5 * scale) / 2;
    const centreY = y + (7 * scale) / 2;
    this.marks.push({
      covers: (px, py) => {
        // Undo the turn and the shear, then look the cell up.
        const dx = px - centreX;
        const dy = py - centreY;
        const ux = dx * cos + dy * sin;
        const uy = -dx * sin + dy * cos;
        const column = Math.floor((ux - shear * uy) / scale + 2.5);
        const row = Math.floor(uy / scale + 3.5);
        return rows[row]?.[column] === '1';
      },
      rgb: INK,
    });
  }

  /** A thin straight line, for clutter over text. */
  line(x1: number, y1: number, x2: number, y2: number, width: number) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    this.marks.push({
      covers: (px, py) => {
        const along = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / length;
        if (along < 0 || along > length) return false;
        const across =
          Math.abs((px - x1) * (y2 - y1) - (py - y1) * (x2 - x1)) / length;
        return across <= width / 2;
      },
      rgb: INK,
    });
  }

  /** Paints the marks in order over a faintly speckled background. */
  png(random: Random): Uint8Array {
    const pixels = new Uint8Array(this.width * this.height * 3);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const shade = 244 + Math.floor(random() * 8);
        let rgb: readonly number[] = [shade, shade, shade];
        for (const mark of this.marks) {
          if (mark.covers(x, y)) rgb = mark.rgb;
        }
        pixels.set(rgb, (y * this.width + x) * 3);
      }
    }
    return encodePng({ width: this.width, height: this.height, pixels });
  }
}
