/**
 * Pictures: the geometry of cropping (where the whole image lies, crops
 * from dragged crop handles, centered aspect-ratio crops, and the
 * operations that commit a crop), PowerPoint's adjustment presets, and the
 * pixel math of those adjustments for gallery previews.
 */

import type {
  CropOutline,
  EditOp,
  PictureRecolor,
  ShapeOutline,
} from '@core/pptx-engine/types';
import type { Handle, Point } from './geometry';
import { swatchCss } from './palette';
import type { Rect } from './selection';

// ---- crop geometry ----------------------------------------------------------

/**
 * A crop being edited, in the picture's own unrotated coordinates: the
 * original frame spans `0..w` × `0..h`, and `image` is where the whole
 * image lies (it moves when panned). Rotation and flips apply about the
 * original frame's center.
 */
export interface CropState {
  frame: Rect;
  image: Rect;
}

export const NO_CROP: CropOutline = { left: 0, top: 0, right: 0, bottom: 0 };

/** The crop state of a picture `w`×`h` points with crop `crop`. */
export function cropState(w: number, h: number, crop: CropOutline): CropState {
  const fullW = w / Math.max(1e-6, 1 - crop.left - crop.right);
  const fullH = h / Math.max(1e-6, 1 - crop.top - crop.bottom);
  return {
    frame: { x: 0, y: 0, w, h },
    image: { x: -crop.left * fullW, y: -crop.top * fullH, w: fullW, h: fullH },
  };
}

/** The crop edges (fractions of the image) a state stands for. */
export function cropEdges(s: CropState): CropOutline {
  const { frame: f, image: i } = s;
  return {
    left: (f.x - i.x) / i.w,
    top: (f.y - i.y) / i.h,
    right: (i.x + i.w - (f.x + f.w)) / i.w,
    bottom: (i.y + i.h - (f.y + f.h)) / i.h,
  };
}

export interface CropDragOptions {
  /** Keep the frame's aspect ratio (Shift). */
  keepAspect?: boolean;
  /** Crop the opposite edge by as much (Ctrl/Alt). */
  symmetric?: boolean;
  /** Smallest frame side, in points. */
  minSize?: number;
}

/**
 * Drags crop handle `handle` of `start` by `d` (local points): the frame's
 * edges move, the image stays. Dragging outward past the image pads it.
 */
export function dragCropHandle(
  start: CropState,
  handle: Handle,
  d: Point,
  options: CropDragOptions = {}
): CropState {
  const min = options.minSize ?? 1;
  const symmetric = !!options.symmetric;
  const f = start.frame;
  // Which edge each axis drags: -1 the low one, 1 the high one, 0 neither.
  const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const grow = (side: number, delta: number) =>
    side * delta * (symmetric ? 2 : 1);
  let w = Math.max(min, f.w + grow(sx, d.x));
  let h = Math.max(min, f.h + grow(sy, d.y));
  if (options.keepAspect && f.w > 0 && f.h > 0) {
    const ratio = f.w / f.h;
    const byWidth = sy === 0 || (sx !== 0 && w / ratio > h);
    if (byWidth) h = w / ratio;
    else w = h * ratio;
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  // What stays put: the opposite edge, or the center.
  const place = (lo: number, size: number, next: number, side: number) =>
    symmetric || side === 0
      ? lo + (size - next) / 2
      : side < 0
        ? lo + size - next
        : lo;
  return {
    frame: { x: place(f.x, f.w, w, sx), y: place(f.y, f.h, h, sy), w, h },
    image: start.image,
  };
}

/** Moves the image under the frame by `d` (local points). */
export function panCrop(start: CropState, d: Point): CropState {
  return {
    frame: start.frame,
    image: { ...start.image, x: start.image.x + d.x, y: start.image.y + d.y },
  };
}

/**
 * Scales the image by dragging its corner `handle` by `d`, keeping its
 * aspect ratio and the opposite corner in place.
 */
export function scaleCropImage(
  start: CropState,
  handle: 'nw' | 'ne' | 'se' | 'sw',
  d: Point,
  minSize = 1
): CropState {
  const i = start.image;
  const west = handle.includes('w');
  const north = handle.includes('n');
  const w0 = i.w + (west ? -d.x : d.x);
  const h0 = i.h + (north ? -d.y : d.y);
  const scale = Math.max(minSize / Math.min(i.w, i.h), w0 / i.w, h0 / i.h);
  const w = i.w * scale;
  const h = i.h * scale;
  return {
    frame: start.frame,
    image: {
      x: west ? i.x + i.w - w : i.x,
      y: north ? i.y + i.h - h : i.y,
      w,
      h,
    },
  };
}

/** Whether two crop states differ visibly (more than `epsilon` points). */
export function cropChanged(a: CropState, b: CropState, epsilon = 0.01) {
  const keys = ['x', 'y', 'w', 'h'] as const;
  return keys.some(
    (k) =>
      Math.abs(a.frame[k] - b.frame[k]) > epsilon ||
      Math.abs(a.image[k] - b.image[k]) > epsilon
  );
}

/** The frame a picture's local coordinates are measured against. */
export interface PictureFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

/** Maps a point of the frame's local coordinates to slide space. */
export function localToSlide(frame: PictureFrame, p: Point): Point {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const lx = (p.x - frame.w / 2) * (frame.flipH ? -1 : 1);
  const ly = (p.y - frame.h / 2) * (frame.flipV ? -1 : 1);
  const r = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

/** Turns a slide-space movement into the frame's local coordinates. */
export function slideDeltaToLocal(frame: PictureFrame, d: Point): Point {
  const r = (-frame.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const x = d.x * cos - d.y * sin;
  const y = d.x * sin + d.y * cos;
  return { x: frame.flipH ? -x : x, y: frame.flipV ? -y : y };
}

/** The CSS/SVG transform from local coordinates to slide space. */
export function localTransform(frame: PictureFrame): string {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  return `translate(${cx} ${cy}) rotate(${frame.rotation}) scale(${frame.flipH ? -1 : 1} ${frame.flipV ? -1 : 1}) translate(${-frame.w / 2} ${-frame.h / 2})`;
}

/**
 * The batch that commits a crop as one undo step: the new crop edges (the
 * engine keeps the image where it was), and, when the image was moved or
 * scaled, the frame put where the crop shows it.
 */
export function cropOps(
  slide: number,
  shape: ShapeOutline,
  start: CropState,
  end: CropState
): EditOp[] {
  const edges = cropEdges(end);
  const ops: EditOp[] = [
    { op: 'cropPicture', slide, shape: shape.id, ...edges },
  ];
  const imageMoved =
    Math.abs(start.image.x - end.image.x) > 0.01 ||
    Math.abs(start.image.y - end.image.y) > 0.01 ||
    Math.abs(start.image.w - end.image.w) > 0.01 ||
    Math.abs(start.image.h - end.image.h) > 0.01;
  if (imageMoved) {
    const c = localToSlide(shape, {
      x: end.frame.x + end.frame.w / 2,
      y: end.frame.y + end.frame.h / 2,
    });
    ops.push({
      op: 'setTransform',
      slide,
      shape: shape.id,
      x: c.x - end.frame.w / 2,
      y: c.y - end.frame.h / 2,
      w: end.frame.w,
      h: end.frame.h,
    });
  }
  return ops;
}

/** An aspect ratio of Crop ▸ Aspect Ratio, as `width:height`. */
export interface AspectRatio {
  label: string;
  w: number;
  h: number;
}

export const ASPECT_RATIOS: { group: string; ratios: AspectRatio[] }[] = [
  { group: 'Square', ratios: [{ label: '1:1', w: 1, h: 1 }] },
  {
    group: 'Portrait',
    ratios: [
      { label: '2:3', w: 2, h: 3 },
      { label: '3:4', w: 3, h: 4 },
      { label: '3:5', w: 3, h: 5 },
      { label: '4:5', w: 4, h: 5 },
      { label: '9:16', w: 9, h: 16 },
    ],
  },
  {
    group: 'Landscape',
    ratios: [
      { label: '3:2', w: 3, h: 2 },
      { label: '4:3', w: 4, h: 3 },
      { label: '5:3', w: 5, h: 3 },
      { label: '5:4', w: 5, h: 4 },
      { label: '16:9', w: 16, h: 9 },
      { label: '16:10', w: 16, h: 10 },
    ],
  },
];

/**
 * The crop showing the largest centered `ratio` (width / height) part of
 * the whole image of a picture `w`×`h` points cropped by `crop`.
 */
export function aspectCrop(
  w: number,
  h: number,
  crop: CropOutline,
  ratio: number
): CropOutline {
  const { image } = cropState(w, h, crop);
  const fits = image.w / image.h > ratio;
  const vw = fits ? (image.h * ratio) / image.w : 1;
  const vh = fits ? 1 : image.w / ratio / image.h;
  const x = (1 - vw) / 2;
  const y = (1 - vh) / 2;
  return { left: x, top: y, right: x, bottom: y };
}

/**
 * The image a copied picture shows (`copyShapes` payload JSON): the part its
 * `a:blip` embeds, or the payload's first image part.
 */
export function pictureImagePart(
  payload: string
): { contentType: string; data: string } | undefined {
  let parsed: {
    shapes?: string[];
    rels?: { id: string; target: string }[];
    parts?: { name: string; contentType: string; data: string }[];
  };
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  const parts = parsed.parts ?? [];
  const embed = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(
    parsed.shapes?.[0] ?? ''
  )?.[1];
  const target = parsed.rels?.find((r) => r.id === embed)?.target;
  const part =
    parts.find((p) => p.name === target) ??
    parts.find((p) => p.contentType.startsWith('image/'));
  return part && { contentType: part.contentType, data: part.data };
}

// ---- adjustment presets -----------------------------------------------------

/** Brightness and contrast steps of the Corrections gallery. */
export const CORRECTION_STEPS = [-0.4, -0.2, 0, 0.2, 0.4];

/** A signed percent label: `+20%`, `-40%`, `0%`. */
export function signedPercent(v: number): string {
  const p = Math.round(v * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
}

/** The test id suffix of a correction preset: `b+20_c-40`. */
export function correctionKey(brightness: number, contrast: number): string {
  const s = (v: number) => {
    const p = Math.round(v * 100);
    return `${p > 0 ? '+' : ''}${p}`;
  };
  return `b${s(brightness)}_c${s(contrast)}`;
}

/** Transparency presets of the Transparency gallery (fractions). */
export const TRANSPARENCY_STEPS = [0, 0.15, 0.3, 0.5, 0.65, 0.8, 0.95];

export interface RecolorPreset {
  value: PictureRecolor;
  label: string;
}

const DARK_SLOTS: [string, string][] = [
  ['tx2', 'Text color 2'],
  ['accent1', 'Accent color 1'],
  ['accent2', 'Accent color 2'],
  ['accent3', 'Accent color 3'],
  ['accent4', 'Accent color 4'],
  ['accent5', 'Accent color 5'],
  ['accent6', 'Accent color 6'],
];

/** PowerPoint's Recolor gallery: seven presets a row. */
export const RECOLOR_ROWS: { label: string; presets: RecolorPreset[] }[] = [
  {
    label: 'Recolor',
    presets: [
      { value: 'none', label: 'No Recolor' },
      { value: 'grayscale', label: 'Grayscale' },
      { value: 'sepia', label: 'Sepia' },
      { value: 'washout', label: 'Washout' },
      { value: 'blackWhite25', label: 'Black and White: 25%' },
      { value: 'blackWhite', label: 'Black and White: 50%' },
      { value: 'blackWhite75', label: 'Black and White: 75%' },
    ],
  },
  {
    label: 'Dark variations',
    presets: DARK_SLOTS.map(([slot, name]) => ({
      value: `duotone:${slot}` as PictureRecolor,
      label: `${name} Dark`,
    })),
  },
  {
    label: 'Light variations',
    presets: DARK_SLOTS.map(([slot, name]) => ({
      value: `duotoneLight:${slot === 'tx2' ? 'bg2' : slot}` as PictureRecolor,
      label: `${slot === 'tx2' ? 'Background color 2' : name} Light`,
    })),
  },
];

/** A test-id-safe spelling of a recolor (`duotone:accent1` → `duotone-accent1`). */
export function recolorKey(recolor: PictureRecolor): string {
  return recolor.replace(/[:,]/g, '-');
}

/** The label PowerPoint gives a recolor. */
export function recolorLabel(recolor: PictureRecolor): string {
  for (const row of RECOLOR_ROWS)
    for (const p of row.presets) if (p.value === recolor) return p.label;
  return recolor.startsWith('duotone') ? 'Duotone' : recolor;
}

// ---- pixel math (previews) --------------------------------------------------

type Rgb = [number, number, number];

/** A recolor with its colors resolved (0..1 sRGB). */
export type ResolvedRecolor =
  | { kind: 'grayscale' }
  | { kind: 'washout' }
  | { kind: 'biLevel'; threshold: number }
  | { kind: 'duotone'; dark: Rgb; light: Rgb };

/** How a picture is adjusted, for drawing previews. */
export interface PictureLook {
  brightness: number;
  contrast: number;
  recolor: ResolvedRecolor | null;
  transparency: number;
}

const rgbOf = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;

/** DrawingML `shade`: darker, toward black in linear light. */
const shade = (c: Rgb, v: number): Rgb =>
  c.map((x) => toSrgb(toLinear(x) * v)) as Rgb;
/** DrawingML `tint`: lighter, toward white in linear light. */
const tint = (c: Rgb, v: number): Rgb =>
  c.map((x) => toSrgb(toLinear(x) * v + (1 - v))) as Rgb;

/** DrawingML `satMod`: scales the HSL saturation. */
function saturate(c: Rgb, factor: number): Rgb {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return c;
  const d = max - min;
  let s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  s = Math.min(1, s * factor);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** Resolves a recolor's colors against the theme (`[slot, #RRGGBB]`). */
export function resolveRecolor(
  recolor: PictureRecolor,
  themeColors: [string, string][]
): ResolvedRecolor | null {
  const color = (name: string): Rgb =>
    rgbOf(swatchCss(name.trim(), themeColors) ?? '#808080');
  if (recolor === 'none') return null;
  if (recolor === 'grayscale') return { kind: 'grayscale' };
  if (recolor === 'washout') return { kind: 'washout' };
  if (recolor === 'blackWhite') return { kind: 'biLevel', threshold: 0.5 };
  if (recolor === 'blackWhite25') return { kind: 'biLevel', threshold: 0.25 };
  if (recolor === 'blackWhite75') return { kind: 'biLevel', threshold: 0.75 };
  if (recolor === 'sepia')
    return {
      kind: 'duotone',
      dark: [0, 0, 0],
      light: saturate(tint(rgbOf('D9C3A5'), 0.5), 1.8),
    };
  const [kind, colors = ''] = recolor.split(':');
  if (kind === 'duotoneLight')
    return {
      kind: 'duotone',
      dark: [0, 0, 0],
      light: saturate(tint(color(colors), 0.45), 4),
    };
  const [dark, light] = colors.split(',');
  if (light !== undefined)
    return { kind: 'duotone', dark: color(dark), light: color(light) };
  return {
    kind: 'duotone',
    dark: saturate(shade(color(dark), 0.45), 1.35),
    light: [1, 1, 1],
  };
}

/** The look of a picture outline (its current adjustments). */
export function lookOf(
  picture: ShapeOutline['picture'],
  themeColors: [string, string][]
): PictureLook {
  return {
    brightness: picture?.brightness ?? 0,
    contrast: picture?.contrast ?? 0,
    recolor: resolveRecolor(picture?.recolor ?? 'none', themeColors),
    transparency: picture?.transparency ?? 0,
  };
}

/** `a:lum` as the renderer applies it to one channel. */
function lum(c: number, bright: number, contrast: number): number {
  const k = contrast >= 0 ? 1 / Math.max(0.001, 1 - contrast) : 1 + contrast;
  return Math.min(1, Math.max(0, (c + bright - 0.5) * k + 0.5));
}

/**
 * Applies a look to straight-alpha RGBA pixels in place, in the
 * renderer's order: brightness and contrast, recolor, transparency.
 */
export function adjustPixels(data: Uint8ClampedArray, look: PictureLook) {
  const { brightness, contrast, recolor, transparency } = look;
  const corrected = brightness !== 0 || contrast !== 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    if (corrected) {
      r = lum(r, brightness, contrast);
      g = lum(g, brightness, contrast);
      b = lum(b, brightness, contrast);
    }
    if (recolor) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      if (recolor.kind === 'grayscale') {
        r = g = b = y;
      } else if (recolor.kind === 'washout') {
        r = lum(r, 0.7, -0.7);
        g = lum(g, 0.7, -0.7);
        b = lum(b, 0.7, -0.7);
      } else if (recolor.kind === 'biLevel') {
        r = g = b = y >= recolor.threshold ? 1 : 0;
      } else {
        const { dark, light } = recolor;
        r = dark[0] + (light[0] - dark[0]) * y;
        g = dark[1] + (light[1] - dark[1]) * y;
        b = dark[2] + (light[2] - dark[2]) * y;
      }
    }
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
    if (transparency > 0)
      data[i + 3] = Math.round(data[i + 3] * (1 - transparency));
  }
}
