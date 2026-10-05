/**
 * EMF and WMF metafiles, which Office uses for logos and pasted drawings and
 * browsers cannot show. Macro plays their drawing records onto a canvas for
 * a picture to display, and keeps the metafile itself for export.
 */

/** The canvas calls metafiles make; a 2D canvas context provides them. */
export type MetafileCanvas = {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
    y: number
  ): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    start: number,
    end: number,
    counterclockwise?: boolean
  ): void;
  closePath(): void;
  rect(x: number, y: number, width: number, height: number): void;
  fill(rule?: CanvasFillRule): void;
  stroke(): void;
  clip(rule?: CanvasFillRule): void;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number
  ): void;
  measureText(text: string): { width: number };
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  setLineDash(segments: number[]): void;
};

/** Pixels in a 32-bit RGBA bitmap, as a metafile's device-independent bitmap reads. */
export type MetafileBitmap = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
};

export type MetafileImages = (
  bitmap: MetafileBitmap | Blob
) => Promise<CanvasImageSource | undefined>;

export type MetafileKind = 'emf' | 'wmf';

/** Whether bytes are an EMF or WMF metafile. */
export function metafileKind(bytes: Uint8Array): MetafileKind | undefined {
  if (bytes.length < 44) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) === 1 && view.getUint32(40, true) === 0x464d4520)
    return 'emf';
  if (view.getUint32(0, true) === 0x9ac6cdd7) return 'wmf';
  const type = view.getUint16(0, true);
  if ((type === 1 || type === 2) && view.getUint16(2, true) === 9) return 'wmf';
}

type Point = [number, number];
type Matrix = [number, number, number, number, number, number];

const identity = (): Matrix => [1, 0, 0, 1, 0, 0];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

type Pen = { style: number; width: number; color: string };
type Brush = { style: number; color: string };
type Font = {
  height: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  face: string;
  escapement: number;
};
type GdiObject =
  | { type: 'pen'; pen: Pen }
  | { type: 'brush'; brush: Brush }
  | { type: 'font'; font: Font }
  | { type: 'other' };

/** A device context's state, as SaveDC keeps it. */
type State = {
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: string;
  backgroundColor: string;
  opaqueBackground: boolean;
  fillRule: CanvasFillRule;
  textAlign: number;
  mapMode: number;
  windowOrigin: Point;
  windowExtent: Point;
  viewportOrigin: Point;
  viewportExtent: Point;
  world: Matrix;
  position: Point;
};

const BLACK_PEN: Pen = { style: 0, width: 0, color: '#000000' };
const WHITE_BRUSH: Brush = { style: 0, color: '#ffffff' };
const DEFAULT_FONT: Font = {
  height: -12,
  weight: 400,
  italic: false,
  underline: false,
  face: 'Arial',
  escapement: 0,
};

/** GDI's stock objects, by their index with the high bit cleared. */
function stockObject(index: number): GdiObject | undefined {
  const gray = ['#ffffff', '#c0c0c0', '#808080', '#404040', '#000000'];
  if (index <= 4)
    return { type: 'brush', brush: { style: 0, color: gray[index] } };
  if (index === 5)
    return { type: 'brush', brush: { style: 1, color: '#000000' } };
  if (index === 6)
    return { type: 'pen', pen: { style: 0, width: 0, color: '#ffffff' } };
  if (index === 7) return { type: 'pen', pen: BLACK_PEN };
  if (index === 8)
    return { type: 'pen', pen: { style: 5, width: 0, color: '#000000' } };
  if (index >= 10 && index <= 17) return { type: 'font', font: DEFAULT_FONT };
}

const colorref = (value: number) =>
  `#${[value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;

/**
 * A device-independent bitmap's pixels: 1, 4, 8, 16, 24 and 32-bit
 * uncompressed or bit-field bitmaps, or the JPEG or PNG some carry.
 */
export function readBitmap(
  bytes: Uint8Array,
  info: number,
  bits: number,
  bitsLength = bytes.length - bits
): MetafileBitmap | Blob | undefined {
  if (info < 0 || info + 16 > bytes.length) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(info, true);
  let width: number;
  let rawHeight: number;
  let depth: number;
  let compression = 0;
  let colorsUsed = 0;
  if (headerSize === 12) {
    width = view.getUint16(info + 4, true);
    rawHeight = view.getInt16(info + 6, true);
    depth = view.getUint16(info + 10, true);
  } else {
    if (info + 40 > bytes.length) return;
    width = view.getInt32(info + 4, true);
    rawHeight = view.getInt32(info + 8, true);
    depth = view.getUint16(info + 14, true);
    compression = view.getUint32(info + 16, true);
    colorsUsed = view.getUint32(info + 32, true);
  }
  // JPEG and PNG pictures are embedded whole.
  if (compression === 4 || compression === 5) {
    const end = Math.min(bytes.length, bits + bitsLength);
    return new Blob([bytes.slice(bits, end)], {
      type: compression === 4 ? 'image/jpeg' : 'image/png',
    });
  }
  const height = Math.abs(rawHeight);
  if (
    width <= 0 ||
    height <= 0 ||
    width > 8192 ||
    height > 8192 ||
    ![1, 4, 8, 16, 24, 32].includes(depth) ||
    (compression !== 0 && compression !== 3)
  )
    return;
  const paletteSize = depth <= 8 ? colorsUsed || 1 << depth : 0;
  const entry = headerSize === 12 ? 3 : 4;
  const palette: number[][] = [];
  for (let index = 0; index < paletteSize; index++) {
    const at = info + headerSize + index * entry;
    if (at + 3 > bytes.length) break;
    palette.push([bytes[at + 2], bytes[at + 1], bytes[at]]);
  }
  // Bit-field masks follow a 40-byte header, or are part of a longer one.
  let masks =
    depth === 16 ? [0x7c00, 0x03e0, 0x001f] : [0xff0000, 0xff00, 0xff];
  if (compression === 3) {
    const at = info + 40;
    if (at + 12 <= bytes.length)
      masks = [0, 4, 8].map((offset) => view.getUint32(at + offset, true));
  }
  const channel = (value: number, mask: number) => {
    if (!mask) return 0;
    let shift = 0;
    while (!((mask >>> shift) & 1)) shift++;
    const max = mask >>> shift;
    return Math.round((((value & mask) >>> shift) * 255) / max);
  };
  const stride = Math.ceil((width * depth) / 32) * 4;
  if (bits + stride * height > bytes.length) return;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const topDown = rawHeight < 0;
  for (let y = 0; y < height; y++) {
    const row = bits + (topDown ? y : height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (depth <= 8) {
        const perByte = 8 / depth;
        const byte = bytes[row + Math.floor(x / perByte)];
        const shift = 8 - depth * ((x % perByte) + 1);
        const index = (byte >> shift) & ((1 << depth) - 1);
        [r, g, b] = palette[index] ?? [0, 0, 0];
      } else if (depth === 16) {
        const value = view.getUint16(row + x * 2, true);
        [r, g, b] = masks.map((mask) => channel(value, mask));
      } else if (depth === 24) {
        b = bytes[row + x * 3];
        g = bytes[row + x * 3 + 1];
        r = bytes[row + x * 3 + 2];
      } else {
        const value = view.getUint32(row + x * 4, true);
        if (compression === 3)
          [r, g, b] = masks.map((mask) => channel(value, mask));
        else {
          b = value & 0xff;
          g = (value >> 8) & 0xff;
          r = (value >> 16) & 0xff;
        }
        a = 255;
      }
      rgba[out] = r;
      rgba[out + 1] = g;
      rgba[out + 2] = b;
      rgba[out + 3] = a;
    }
  }
  return { width, height, rgba };
}

/** The shared work of playing EMF and WMF records onto a canvas. */
class Player {
  state: State;
  saved: State[] = [];
  objects = new Map<number, GdiObject>();
  inPath = false;
  /** Whether anything was drawn, so a blank result can be told apart. */
  drew = false;

  constructor(
    readonly canvas: MetafileCanvas,
    /** Device units to the canvas's pixels. */
    readonly output: Matrix,
    readonly images: MetafileImages | undefined,
    /** Logical units map to the output directly, as a WMF's window does. */
    readonly fixedPage = false
  ) {
    this.state = {
      pen: BLACK_PEN,
      brush: WHITE_BRUSH,
      font: DEFAULT_FONT,
      textColor: '#000000',
      backgroundColor: '#ffffff',
      opaqueBackground: true,
      fillRule: 'evenodd',
      textAlign: 0,
      mapMode: 1,
      windowOrigin: [0, 0],
      windowExtent: [1, 1],
      viewportOrigin: [0, 0],
      viewportExtent: [1, 1],
      world: identity(),
      position: [0, 0],
    };
  }

  /** Logical units to the canvas, through the world, page and output transforms. */
  matrix(): Matrix {
    const s = this.state;
    if (this.fixedPage) return multiply(s.world, this.output);
    let page: Matrix = identity();
    if (s.mapMode === 7 || s.mapMode === 8) {
      let sx = s.viewportExtent[0] / (s.windowExtent[0] || 1);
      let sy = s.viewportExtent[1] / (s.windowExtent[1] || 1);
      if (s.mapMode === 7) {
        // Isotropic: the same scale both ways, the smaller one.
        const scale = Math.min(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx) * scale;
        sy = Math.sign(sy) * scale;
      }
      page = [
        sx,
        0,
        0,
        sy,
        s.viewportOrigin[0] - s.windowOrigin[0] * sx,
        s.viewportOrigin[1] - s.windowOrigin[1] * sy,
      ];
    } else if (s.mapMode !== 1) {
      // Metric and English modes, y up, at 96 dots per inch.
      const perInch: Record<number, number> = {
        2: 254,
        3: 2540,
        4: 100,
        5: 1000,
        6: 1440,
      };
      const scale = 96 / (perInch[s.mapMode] ?? 96);
      page = [
        scale,
        0,
        0,
        -scale,
        s.viewportOrigin[0] - s.windowOrigin[0] * scale,
        s.viewportOrigin[1] + s.windowOrigin[1] * scale,
      ];
    } else
      page = [
        1,
        0,
        0,
        1,
        s.viewportOrigin[0] - s.windowOrigin[0],
        s.viewportOrigin[1] - s.windowOrigin[1],
      ];
    return multiply(multiply(s.world, page), this.output);
  }

  point(x: number, y: number): Point {
    const m = this.matrix();
    return [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];
  }

  /** A length in logical units, in canvas pixels. */
  length(value: number): number {
    const m = this.matrix();
    return Math.abs(value) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  }

  select(object: GdiObject | undefined) {
    if (!object) return;
    if (object.type === 'pen') this.state.pen = object.pen;
    else if (object.type === 'brush') this.state.brush = object.brush;
    else if (object.type === 'font') this.state.font = object.font;
  }

  save() {
    this.saved.push({ ...this.state, world: [...this.state.world] as Matrix });
    this.canvas.save();
  }

  restore(relative: number) {
    const count = relative < 0 ? -relative : this.saved.length - relative + 1;
    for (let index = 0; index < count && this.saved.length; index++) {
      this.state = this.saved.pop()!;
      this.canvas.restore();
    }
  }

  /** Path points through the transforms, moving or drawing to each. */
  trace(points: Point[], close: boolean, continuing = false) {
    if (!points.length) return;
    const ctx = this.canvas;
    points.forEach(([x, y], index) => {
      const [px, py] = this.point(x, y);
      if (index === 0 && !continuing) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    if (close) ctx.closePath();
  }

  /**
   * Bézier curves through points in threes: from the first point, from
   * `start`, or on from the path's current point.
   */
  beziers(points: Point[], start: 'first' | 'current' | Point) {
    const ctx = this.canvas;
    let index = 0;
    if (start === 'first') {
      if (!points.length) return;
      ctx.moveTo(...this.point(...points[0]));
      index = 1;
    } else if (start !== 'current') ctx.moveTo(...this.point(...start));
    for (; index + 2 < points.length; index += 3) {
      const [x1, y1] = this.point(...points[index]);
      const [x2, y2] = this.point(...points[index + 1]);
      const [x, y] = this.point(...points[index + 2]);
      ctx.bezierCurveTo(x1, y1, x2, y2, x, y);
    }
  }

  applyPen(): boolean {
    const pen = this.state.pen;
    if ((pen.style & 0xf) === 5) return false;
    const ctx = this.canvas;
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = Math.max(1, this.length(pen.width || 1) || 1);
    const dashes: Record<number, number[]> = {
      1: [6, 3],
      2: [2, 2],
      3: [6, 3, 2, 3],
      4: [6, 3, 2, 3, 2, 3],
    };
    ctx.setLineDash(
      (dashes[pen.style & 0xf] ?? []).map((value) => value * ctx.lineWidth)
    );
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return true;
  }

  applyBrush(): boolean {
    const brush = this.state.brush;
    if (brush.style === 1) return false;
    this.canvas.fillStyle = brush.color;
    return true;
  }

  /** Fill and stroke the current path, as GDI shapes are drawn. */
  paint(fill = true, stroke = true) {
    if (this.inPath) return;
    const ctx = this.canvas;
    if (fill && this.applyBrush()) {
      ctx.fill(this.state.fillRule);
      this.drew = true;
    }
    if (stroke && this.applyPen()) {
      ctx.stroke();
      this.drew = true;
    }
  }

  begin() {
    if (!this.inPath) this.canvas.beginPath();
  }

  shape(draw: () => void, fill = true) {
    this.begin();
    draw();
    this.paint(fill, true);
  }

  rectangle(left: number, top: number, right: number, bottom: number) {
    this.shape(() =>
      this.trace(
        [
          [left, top],
          [right, top],
          [right, bottom],
          [left, bottom],
        ],
        true
      )
    );
  }

  ellipse(left: number, top: number, right: number, bottom: number) {
    this.shape(() => {
      const [x1, y1] = this.point(left, top);
      const [x2, y2] = this.point(right, bottom);
      this.canvas.moveTo(Math.max(x1, x2), (y1 + y2) / 2);
      this.canvas.ellipse(
        (x1 + x2) / 2,
        (y1 + y2) / 2,
        Math.abs(x2 - x1) / 2,
        Math.abs(y2 - y1) / 2,
        0,
        0,
        2 * Math.PI
      );
    });
  }

  roundRectangle(
    left: number,
    top: number,
    right: number,
    bottom: number,
    width: number,
    height: number
  ) {
    const [x1, y1] = this.point(Math.min(left, right), Math.min(top, bottom));
    const [x2, y2] = this.point(Math.max(left, right), Math.max(top, bottom));
    const rx = Math.min(Math.abs(x2 - x1) / 2, this.length(width) / 2);
    const ry = Math.min(Math.abs(y2 - y1) / 2, this.length(height) / 2);
    const [l, t] = [Math.min(x1, x2), Math.min(y1, y2)];
    const [r, b] = [Math.max(x1, x2), Math.max(y1, y2)];
    this.shape(() => {
      const ctx = this.canvas;
      ctx.moveTo(l + rx, t);
      ctx.lineTo(r - rx, t);
      ctx.ellipse(r - rx, t + ry, rx, ry, 0, -Math.PI / 2, 0);
      ctx.lineTo(r, b - ry);
      ctx.ellipse(r - rx, b - ry, rx, ry, 0, 0, Math.PI / 2);
      ctx.lineTo(l + rx, b);
      ctx.ellipse(l + rx, b - ry, rx, ry, 0, Math.PI / 2, Math.PI);
      ctx.lineTo(l, t + ry);
      ctx.ellipse(l + rx, t + ry, rx, ry, 0, Math.PI, (3 * Math.PI) / 2);
      ctx.closePath();
    });
  }

  /** An arc, pie or chord of the ellipse in the box, counterclockwise from start to end. */
  arc(
    kind: 'arc' | 'pie' | 'chord',
    box: [number, number, number, number],
    start: Point,
    end: Point
  ) {
    const [x1, y1] = this.point(box[0], box[1]);
    const [x2, y2] = this.point(box[2], box[3]);
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const [sx, sy] = this.point(...start);
    const [ex, ey] = this.point(...end);
    const from = Math.atan2(sy - cy, sx - cx);
    const to = Math.atan2(ey - cy, ex - cx);
    this.shape(() => {
      const ctx = this.canvas;
      if (kind === 'pie') ctx.moveTo(cx, cy);
      ctx.ellipse(
        cx,
        cy,
        Math.abs(x2 - x1) / 2,
        Math.abs(y2 - y1) / 2,
        0,
        from,
        to,
        true
      );
      if (kind !== 'arc') ctx.closePath();
    }, kind !== 'arc');
  }

  async bitmap(
    image: MetafileBitmap | Blob | undefined,
    destination: [number, number, number, number]
  ) {
    if (!image || !this.images) return;
    const source = await this.images(image);
    if (!source) return;
    const [x, y, width, height] = destination;
    const [px, py] = this.point(x, y);
    const [qx, qy] = this.point(x + width, y + height);
    this.canvas.drawImage(
      source,
      Math.min(px, qx),
      Math.min(py, qy),
      Math.abs(qx - px),
      Math.abs(qy - py)
    );
    this.drew = true;
  }

  text(value: string, x: number, y: number) {
    if (!value.trim()) return;
    const ctx = this.canvas;
    const font = this.state.font;
    const size = Math.max(1, this.length(Math.abs(font.height) || 12));
    ctx.font = `${font.italic ? 'italic ' : ''}${font.weight} ${size}px ${JSON.stringify(font.face || 'Arial')}, sans-serif`;
    ctx.fillStyle = this.state.textColor;
    const align = this.state.textAlign;
    ctx.textAlign = (align & 6) === 6 ? 'center' : align & 2 ? 'right' : 'left';
    ctx.textBaseline =
      (align & 24) === 24
        ? 'alphabetic'
        : (align & 24) === 8
          ? 'bottom'
          : 'top';
    let [px, py] = this.point(x, y);
    // Update-current-position alignment draws at the pen's position.
    if (align & 1) [px, py] = this.point(...this.state.position);
    // An opaque background mode paints behind the text first.
    if (this.state.opaqueBackground) {
      const width = ctx.measureText(value).width;
      const left =
        ctx.textAlign === 'center'
          ? px - width / 2
          : ctx.textAlign === 'right'
            ? px - width
            : px;
      const top =
        ctx.textBaseline === 'top'
          ? py
          : ctx.textBaseline === 'bottom'
            ? py - size * 1.2
            : py - size;
      ctx.fillStyle = this.state.backgroundColor;
      ctx.fillRect(left, top, width, size * 1.2);
      ctx.fillStyle = this.state.textColor;
    }
    ctx.fillText(value, px, py);
    this.drew = true;
  }
}

const reader = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    view,
    i32: (at: number) => (at + 4 <= bytes.length ? view.getInt32(at, true) : 0),
    u32: (at: number) =>
      at + 4 <= bytes.length ? view.getUint32(at, true) : 0,
    i16: (at: number) => (at + 2 <= bytes.length ? view.getInt16(at, true) : 0),
    u16: (at: number) =>
      at + 2 <= bytes.length ? view.getUint16(at, true) : 0,
    f32: (at: number) =>
      at + 4 <= bytes.length ? view.getFloat32(at, true) : 0,
  };
};

/** An EMF's frame in hundredths of a millimeter and its device bounds. */
export function emfSize(bytes: Uint8Array) {
  const { i32 } = reader(bytes);
  const bounds = [i32(8), i32(12), i32(16), i32(20)];
  const frame = [i32(24), i32(28), i32(32), i32(36)];
  const device = [i32(72), i32(76)];
  const millimeters = [i32(80), i32(84)];
  return { bounds, frame, device, millimeters };
}

function utf16(bytes: Uint8Array, at: number, count: number): string {
  let text = '';
  for (
    let index = 0;
    index < count && at + index * 2 + 1 < bytes.length;
    index++
  )
    text += String.fromCharCode(
      bytes[at + index * 2] | (bytes[at + index * 2 + 1] << 8)
    );
  return text;
}

function readLogFont(bytes: Uint8Array, at: number): Font {
  const { i32 } = reader(bytes);
  const face = utf16(bytes, at + 28, 32).replace(/\0[\s\S]*$/, '');
  return {
    height: i32(at),
    escapement: i32(at + 8),
    weight: Math.max(100, Math.min(900, i32(at + 16) || 400)),
    italic: bytes[at + 20] !== 0,
    underline: bytes[at + 21] !== 0,
    face: face || 'Arial',
  };
}

/** Play an EMF onto a canvas of `width` by `height` pixels. */
export async function playEmf(
  bytes: Uint8Array,
  canvas: MetafileCanvas,
  width: number,
  height: number,
  images?: MetafileImages
): Promise<boolean> {
  const { i32, u32, i16, f32 } = reader(bytes);
  // The picture's frame, in the reference device's pixels, fills the
  // canvas; its drawn bounds when the frame is not given.
  const { bounds, frame, device, millimeters } = emfSize(bytes);
  const perMillimeter = [
    device[0] / (millimeters[0] || 1),
    device[1] / (millimeters[1] || 1),
  ];
  const box =
    frame[2] > frame[0] && frame[3] > frame[1] && device[0] > 0 && device[1] > 0
      ? [
          (frame[0] / 100) * perMillimeter[0],
          (frame[1] / 100) * perMillimeter[1],
          ((frame[2] - frame[0]) / 100) * perMillimeter[0],
          ((frame[3] - frame[1]) / 100) * perMillimeter[1],
        ]
      : [
          bounds[0],
          bounds[1],
          Math.max(1, bounds[2] - bounds[0] + 1),
          Math.max(1, bounds[3] - bounds[1] + 1),
        ];
  const output: Matrix = [
    width / box[2],
    0,
    0,
    height / box[3],
    (-box[0] * width) / box[2],
    (-box[1] * height) / box[3],
  ];
  const player = new Player(canvas, output, images);
  const points32 = (at: number, count: number): Point[] =>
    Array.from({ length: count }, (_, index) => [
      i32(at + index * 8),
      i32(at + index * 8 + 4),
    ]);
  const points16 = (at: number, count: number): Point[] =>
    Array.from({ length: count }, (_, index) => [
      i16(at + index * 4),
      i16(at + index * 4 + 2),
    ]);
  let offset = 0;
  let records = 0;
  while (offset + 8 <= bytes.length && records++ < 1_000_000) {
    const type = u32(offset);
    const size = u32(offset + 4);
    if (size < 8 || offset + size > bytes.length) break;
    const at = offset + 8;
    const s = player.state;
    switch (type) {
      case 14: // EOF
        offset = bytes.length;
        continue;
      case 9: // SETWINDOWEXTEX
        s.windowExtent = [i32(at), i32(at + 4)];
        break;
      case 10: // SETWINDOWORGEX
        s.windowOrigin = [i32(at), i32(at + 4)];
        break;
      case 11: // SETVIEWPORTEXTEX
        s.viewportExtent = [i32(at), i32(at + 4)];
        break;
      case 12: // SETVIEWPORTORGEX
        s.viewportOrigin = [i32(at), i32(at + 4)];
        break;
      case 17: // SETMAPMODE
        s.mapMode = u32(at);
        break;
      case 35: // SETWORLDTRANSFORM
        s.world = [
          f32(at),
          f32(at + 4),
          f32(at + 8),
          f32(at + 12),
          f32(at + 16),
          f32(at + 20),
        ];
        break;
      case 36: {
        // MODIFYWORLDTRANSFORM
        const matrix: Matrix = [
          f32(at),
          f32(at + 4),
          f32(at + 8),
          f32(at + 12),
          f32(at + 16),
          f32(at + 20),
        ];
        const mode = u32(at + 24);
        if (mode === 1) s.world = identity();
        else if (mode === 2) s.world = multiply(matrix, s.world);
        else if (mode === 3) s.world = multiply(s.world, matrix);
        else if (mode === 4) s.world = matrix;
        break;
      }
      case 33: // SAVEDC
        player.save();
        break;
      case 34: // RESTOREDC
        player.restore(i32(at));
        break;
      case 24: // SETTEXTCOLOR
        s.textColor = colorref(u32(at));
        break;
      case 25: // SETBKCOLOR
        s.backgroundColor = colorref(u32(at));
        break;
      case 18: // SETBKMODE
        s.opaqueBackground = u32(at) === 2;
        break;
      case 19: // SETPOLYFILLMODE
        s.fillRule = u32(at) === 2 ? 'nonzero' : 'evenodd';
        break;
      case 22: // SETTEXTALIGN
        s.textAlign = u32(at);
        break;
      case 38: // CREATEPEN
        player.objects.set(u32(at), {
          type: 'pen',
          pen: {
            style: u32(at + 4),
            width: i32(at + 8),
            color: colorref(u32(at + 16)),
          },
        });
        break;
      case 95: // EXTCREATEPEN
        player.objects.set(u32(at), {
          type: 'pen',
          pen: {
            style: u32(at + 20),
            width: u32(at + 24),
            color: colorref(u32(at + 32)),
          },
        });
        break;
      case 39: // CREATEBRUSHINDIRECT
        player.objects.set(u32(at), {
          type: 'brush',
          brush: {
            style: u32(at + 4) === 1 ? 1 : 0,
            color: colorref(u32(at + 8)),
          },
        });
        break;
      case 93: // CREATEDIBPATTERNBRUSHPT
      case 94: // CREATEMONOBRUSH
        // Patterns are drawn in their average gray.
        player.objects.set(u32(at), {
          type: 'brush',
          brush: { style: 0, color: '#808080' },
        });
        break;
      case 82: // EXTCREATEFONTINDIRECTW
        player.objects.set(u32(at), {
          type: 'font',
          font: readLogFont(bytes, at + 4),
        });
        break;
      case 37: {
        // SELECTOBJECT
        const index = u32(at);
        player.select(
          index & 0x80000000
            ? stockObject(index & 0x7fffffff)
            : player.objects.get(index)
        );
        break;
      }
      case 40: // DELETEOBJECT
        player.objects.delete(u32(at));
        break;
      case 27: // MOVETOEX
        s.position = [i32(at), i32(at + 4)];
        if (player.inPath) {
          const [x, y] = player.point(...s.position);
          canvas.moveTo(x, y);
        }
        break;
      case 54: {
        // LINETO
        const to: Point = [i32(at), i32(at + 4)];
        player.shape(() => {
          if (!player.inPath) {
            const [x, y] = player.point(...s.position);
            canvas.moveTo(x, y);
          }
          const [x, y] = player.point(...to);
          canvas.lineTo(x, y);
        }, false);
        s.position = to;
        break;
      }
      case 43: // RECTANGLE
        player.rectangle(i32(at), i32(at + 4), i32(at + 8), i32(at + 12));
        break;
      case 44: // ROUNDRECT
        player.roundRectangle(
          i32(at),
          i32(at + 4),
          i32(at + 8),
          i32(at + 12),
          i32(at + 16),
          i32(at + 20)
        );
        break;
      case 42: // ELLIPSE
        player.ellipse(i32(at), i32(at + 4), i32(at + 8), i32(at + 12));
        break;
      case 45: // ARC
      case 46: // CHORD
      case 47: // PIE
        player.arc(
          type === 45 ? 'arc' : type === 46 ? 'chord' : 'pie',
          [i32(at), i32(at + 4), i32(at + 8), i32(at + 12)],
          [i32(at + 16), i32(at + 20)],
          [i32(at + 24), i32(at + 28)]
        );
        break;
      case 3: // POLYGON
      case 4: // POLYLINE
      case 86: // POLYGON16
      case 87: {
        // POLYLINE16
        const count = u32(at + 16);
        const points =
          type === 3 || type === 4
            ? points32(at + 20, count)
            : points16(at + 20, count);
        const closed = type === 3 || type === 86;
        player.shape(() => player.trace(points, closed), closed);
        break;
      }
      case 6: // POLYLINETO
      case 89: {
        // POLYLINETO16
        const count = u32(at + 16);
        const points =
          type === 6 ? points32(at + 20, count) : points16(at + 20, count);
        player.shape(() => {
          if (!player.inPath) {
            const [x, y] = player.point(...s.position);
            canvas.moveTo(x, y);
          }
          player.trace(points, false, true);
        }, false);
        if (points.length) s.position = points[points.length - 1];
        break;
      }
      case 2: // POLYBEZIER
      case 85: // POLYBEZIER16
      case 5: // POLYBEZIERTO
      case 88: {
        // POLYBEZIERTO16
        const count = u32(at + 16);
        const points =
          type === 2 || type === 5
            ? points32(at + 20, count)
            : points16(at + 20, count);
        const to = type === 5 || type === 88;
        player.shape(
          () =>
            player.beziers(
              points,
              !to ? 'first' : player.inPath ? 'current' : s.position
            ),
          false
        );
        if (points.length) s.position = points[points.length - 1];
        break;
      }
      case 7: // POLYPOLYLINE
      case 8: // POLYPOLYGON
      case 90: // POLYPOLYLINE16
      case 91: {
        // POLYPOLYGON16
        const groups = u32(at + 16);
        const total = u32(at + 20);
        const counts = Array.from({ length: groups }, (_, index) =>
          u32(at + 24 + index * 4)
        );
        const start = at + 24 + groups * 4;
        const all =
          type === 7 || type === 8
            ? points32(start, total)
            : points16(start, total);
        const closed = type === 8 || type === 91;
        player.shape(() => {
          let index = 0;
          for (const count of counts) {
            player.trace(all.slice(index, index + count), closed);
            index += count;
          }
        }, closed);
        break;
      }
      case 59: // BEGINPATH
        canvas.beginPath();
        player.inPath = true;
        break;
      case 60: // ENDPATH
        player.inPath = false;
        break;
      case 61: // CLOSEFIGURE
        canvas.closePath();
        break;
      case 62: // FILLPATH
        player.paint(true, false);
        break;
      case 63: // STROKEANDFILLPATH
        player.paint(true, true);
        break;
      case 64: // STROKEPATH
        player.paint(false, true);
        break;
      case 67: // SELECTCLIPPATH
        canvas.clip(s.fillRule);
        break;
      case 30: {
        // INTERSECTCLIPRECT
        const [x1, y1] = player.point(i32(at), i32(at + 4));
        const [x2, y2] = player.point(i32(at + 8), i32(at + 12));
        canvas.beginPath();
        canvas.rect(
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.abs(x2 - x1),
          Math.abs(y2 - y1)
        );
        canvas.clip();
        canvas.beginPath();
        break;
      }
      case 84: // EXTTEXTOUTW
      case 83: {
        // EXTTEXTOUTA
        const text = at + 28;
        const x = i32(text);
        const y = i32(text + 4);
        const count = u32(text + 8);
        const start = offset + u32(text + 12);
        const value =
          type === 84
            ? utf16(bytes, start, Math.min(count, 10_000))
            : new TextDecoder('windows-1252').decode(
                bytes.subarray(start, start + Math.min(count, 10_000))
              );
        player.text(value, x, y);
        break;
      }
      case 81: {
        // STRETCHDIBITS
        const destination: [number, number, number, number] = [
          i32(at + 16),
          i32(at + 20),
          i32(at + 64),
          i32(at + 68),
        ];
        const info = offset + u32(at + 40);
        const bits = offset + u32(at + 48);
        await player.bitmap(
          readBitmap(bytes, info, bits, u32(at + 52)),
          destination
        );
        break;
      }
      case 80: {
        // SETDIBITSTODEVICE
        const destination: [number, number, number, number] = [
          i32(at + 16),
          i32(at + 20),
          i32(at + 32),
          i32(at + 36),
        ];
        const info = offset + u32(at + 40);
        const bits = offset + u32(at + 48);
        await player.bitmap(
          readBitmap(bytes, info, bits, u32(at + 52)),
          destination
        );
        break;
      }
      case 76: // BITBLT
      case 77: {
        // STRETCHBLT
        const destination: [number, number, number, number] = [
          i32(at + 16),
          i32(at + 20),
          i32(at + 24),
          i32(at + 28),
        ];
        const infoOffset = u32(at + 76);
        if (infoOffset) {
          const info = offset + infoOffset;
          const bits = offset + u32(at + 84);
          await player.bitmap(
            readBitmap(bytes, info, bits, u32(at + 88)),
            destination
          );
        } else if (u32(at + 32) === 0x00f00021) {
          // PATCOPY: a rectangle of the brush.
          player.rectangle(
            destination[0],
            destination[1],
            destination[0] + destination[2],
            destination[1] + destination[3]
          );
        }
        break;
      }
      default:
        break;
    }
    offset += size;
  }
  return player.drew;
}

/** A WMF's placeable header, giving its bounds in units of `inch` per inch. */
export function wmfSize(bytes: Uint8Array) {
  const { u32, i16, u16 } = reader(bytes);
  if (u32(0) !== 0x9ac6cdd7) return;
  return {
    bounds: [i16(6), i16(8), i16(10), i16(12)],
    inch: u16(14) || 1440,
  };
}

/** Play a WMF onto a canvas of `width` by `height` pixels. */
export async function playWmf(
  bytes: Uint8Array,
  canvas: MetafileCanvas,
  width: number,
  height: number,
  images?: MetafileImages
): Promise<boolean> {
  const { u32, i16, u16 } = reader(bytes);
  const placeable = wmfSize(bytes);
  let offset = placeable ? 22 : 0;
  const headerWords = u16(offset + 2);
  offset += headerWords * 2;
  // The window first set, or the placeable bounds, fills the output.
  let windowBox = placeable
    ? [
        placeable.bounds[0],
        placeable.bounds[1],
        placeable.bounds[2] - placeable.bounds[0],
        placeable.bounds[3] - placeable.bounds[1],
      ]
    : undefined;
  if (!windowBox) {
    let scan = offset;
    let origin: Point = [0, 0];
    while (scan + 6 <= bytes.length) {
      const words = u32(scan);
      const fn = u16(scan + 4);
      if (words < 3) break;
      if (fn === 0x020b) origin = [i16(scan + 8), i16(scan + 6)];
      if (fn === 0x020c) {
        windowBox = [origin[0], origin[1], i16(scan + 8), i16(scan + 6)];
        break;
      }
      scan += words * 2;
    }
  }
  const [bx, by, bw, bh] = windowBox ?? [0, 0, width, height];
  const output: Matrix = [
    width / (bw || 1),
    0,
    0,
    height / (bh || 1),
    (-bx * width) / (bw || 1),
    (-by * height) / (bh || 1),
  ];
  const player = new Player(canvas, output, images, true);
  // WMF objects take the lowest free slot.
  const slot = () => {
    let index = 0;
    while (player.objects.has(index)) index++;
    return index;
  };
  const points = (at: number, count: number): Point[] =>
    Array.from({ length: count }, (_, index) => [
      i16(at + index * 4),
      i16(at + index * 4 + 2),
    ]);
  let records = 0;
  while (offset + 6 <= bytes.length && records++ < 1_000_000) {
    const words = u32(offset);
    const fn = u16(offset + 4);
    if (words < 3 || offset + words * 2 > bytes.length) break;
    const at = offset + 6;
    const s = player.state;
    if (fn === 0x0000) break;
    switch (fn) {
      case 0x020b: // SETWINDOWORG
        s.windowOrigin = [i16(at + 2), i16(at)];
        break;
      case 0x020c: // SETWINDOWEXT
        s.windowExtent = [i16(at + 2), i16(at)];
        break;
      case 0x020d: // SETVIEWPORTORG
        s.viewportOrigin = [i16(at + 2), i16(at)];
        break;
      case 0x020e: // SETVIEWPORTEXT
        s.viewportExtent = [i16(at + 2), i16(at)];
        break;
      case 0x0103: // SETMAPMODE
        break;
      case 0x001e: // SAVEDC
        player.save();
        break;
      case 0x0127: // RESTOREDC
        player.restore(i16(at));
        break;
      case 0x0209: // SETTEXTCOLOR
        s.textColor = colorref(u32(at));
        break;
      case 0x0201: // SETBKCOLOR
        s.backgroundColor = colorref(u32(at));
        break;
      case 0x0102: // SETBKMODE
        s.opaqueBackground = u16(at) === 2;
        break;
      case 0x0106: // SETPOLYFILLMODE
        s.fillRule = u16(at) === 2 ? 'nonzero' : 'evenodd';
        break;
      case 0x012e: // SETTEXTALIGN
        s.textAlign = u16(at);
        break;
      case 0x02fa: // CREATEPENINDIRECT
        player.objects.set(slot(), {
          type: 'pen',
          pen: {
            style: u16(at),
            width: i16(at + 2),
            color: colorref(u32(at + 6)),
          },
        });
        break;
      case 0x02fc: // CREATEBRUSHINDIRECT
        player.objects.set(slot(), {
          type: 'brush',
          brush: { style: u16(at) === 1 ? 1 : 0, color: colorref(u32(at + 2)) },
        });
        break;
      case 0x02fb: {
        // CREATEFONTINDIRECT
        const face = new TextDecoder('windows-1252')
          .decode(
            bytes.subarray(at + 18, Math.min(offset + words * 2, at + 50))
          )
          .replace(/\0[\s\S]*$/, '');
        player.objects.set(slot(), {
          type: 'font',
          font: {
            height: i16(at),
            escapement: i16(at + 4),
            weight: Math.max(100, Math.min(900, i16(at + 8) || 400)),
            italic: bytes[at + 10] !== 0,
            underline: bytes[at + 11] !== 0,
            face: face || 'Arial',
          },
        });
        break;
      }
      case 0x00f7: // CREATEPALETTE
      case 0x06ff: // CREATEREGION
        player.objects.set(slot(), { type: 'other' });
        break;
      case 0x01f9: // CREATEPATTERNBRUSH
      case 0x0142: // DIBCREATEPATTERNBRUSH
        player.objects.set(slot(), {
          type: 'brush',
          brush: { style: 0, color: '#808080' },
        });
        break;
      case 0x012d: // SELECTOBJECT
        player.select(player.objects.get(u16(at)));
        break;
      case 0x01f0: // DELETEOBJECT
        player.objects.delete(u16(at));
        break;
      case 0x0214: // MOVETO
        s.position = [i16(at + 2), i16(at)];
        break;
      case 0x0213: {
        // LINETO
        const to: Point = [i16(at + 2), i16(at)];
        player.shape(() => player.trace([s.position, to], false), false);
        s.position = to;
        break;
      }
      case 0x041b: // RECTANGLE
        player.rectangle(i16(at + 6), i16(at + 4), i16(at + 2), i16(at));
        break;
      case 0x061c: // ROUNDRECT
        player.roundRectangle(
          i16(at + 10),
          i16(at + 8),
          i16(at + 6),
          i16(at + 4),
          i16(at + 2),
          i16(at)
        );
        break;
      case 0x0418: // ELLIPSE
        player.ellipse(i16(at + 6), i16(at + 4), i16(at + 2), i16(at));
        break;
      case 0x0817: // ARC
      case 0x081a: // PIE
      case 0x0830: // CHORD
        player.arc(
          fn === 0x0817 ? 'arc' : fn === 0x081a ? 'pie' : 'chord',
          [i16(at + 14), i16(at + 12), i16(at + 10), i16(at + 8)],
          [i16(at + 6), i16(at + 4)],
          [i16(at + 2), i16(at)]
        );
        break;
      case 0x0324: // POLYGON
      case 0x0325: {
        // POLYLINE
        const closed = fn === 0x0324;
        const list = points(at + 2, i16(at));
        player.shape(() => player.trace(list, closed), closed);
        break;
      }
      case 0x0538: {
        // POLYPOLYGON
        const groups = u16(at);
        const counts = Array.from({ length: groups }, (_, index) =>
          u16(at + 2 + index * 2)
        );
        let start = at + 2 + groups * 2;
        player.shape(() => {
          for (const count of counts) {
            player.trace(points(start, count), true);
            start += count * 4;
          }
        });
        break;
      }
      case 0x0521: {
        // TEXTOUT
        const count = u16(at);
        const text = new TextDecoder('windows-1252').decode(
          bytes.subarray(at + 2, at + 2 + count)
        );
        const after = at + 2 + count + (count % 2);
        player.text(text, i16(after + 2), i16(after));
        break;
      }
      case 0x0a32: {
        // EXTTEXTOUT
        const y = i16(at);
        const x = i16(at + 2);
        const count = u16(at + 4);
        const options = u16(at + 6);
        const start = at + 8 + (options & 0x0006 ? 8 : 0);
        const text = new TextDecoder('windows-1252').decode(
          bytes.subarray(start, start + count)
        );
        player.text(text, x, y);
        break;
      }
      case 0x0416: {
        // INTERSECTCLIPRECT
        const [x1, y1] = player.point(i16(at + 6), i16(at + 4));
        const [x2, y2] = player.point(i16(at + 2), i16(at));
        canvas.beginPath();
        canvas.rect(
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.abs(x2 - x1),
          Math.abs(y2 - y1)
        );
        canvas.clip();
        canvas.beginPath();
        break;
      }
      case 0x0f43: {
        // STRETCHDIB
        const destination: [number, number, number, number] = [
          i16(at + 20),
          i16(at + 18),
          i16(at + 16),
          i16(at + 14),
        ];
        const info = at + 22;
        await player.bitmap(
          readBitmap(bytes, info, dibBits(bytes, info)),
          destination
        );
        break;
      }
      case 0x0b41: {
        // DIBSTRETCHBLT
        const destination: [number, number, number, number] = [
          i16(at + 18),
          i16(at + 16),
          i16(at + 14),
          i16(at + 12),
        ];
        const info = at + 20;
        if (info + 40 <= offset + words * 2)
          await player.bitmap(
            readBitmap(bytes, info, dibBits(bytes, info)),
            destination
          );
        break;
      }
      case 0x0940: {
        // DIBBITBLT
        const destination: [number, number, number, number] = [
          i16(at + 14),
          i16(at + 12),
          i16(at + 10),
          i16(at + 8),
        ];
        const info = at + 16;
        if (info + 40 <= offset + words * 2)
          await player.bitmap(
            readBitmap(bytes, info, dibBits(bytes, info)),
            destination
          );
        break;
      }
      default:
        break;
    }
    offset += words * 2;
  }
  return player.drew;
}

/** Where a DIB's pixels start: after its header, masks and palette. */
function dibBits(bytes: Uint8Array, info: number): number {
  const { u32, u16 } = reader(bytes);
  const header = u32(info);
  if (header === 12) {
    const depth = u16(info + 10);
    return info + 12 + (depth <= 8 ? (1 << depth) * 3 : 0);
  }
  const depth = u16(info + 14);
  const compression = u32(info + 16);
  const used = u32(info + 32);
  const palette = depth <= 8 ? (used || 1 << depth) * 4 : 0;
  const masks = compression === 3 && header === 40 ? 12 : 0;
  return info + header + masks + palette;
}

/** A metafile's natural size in pixels, at 96 dots per inch. */
export function metafileSize(
  bytes: Uint8Array,
  kind: MetafileKind
): { width: number; height: number } | undefined {
  if (kind === 'emf') {
    const { frame, bounds } = emfSize(bytes);
    const width = ((frame[2] - frame[0]) / 2540) * 96;
    const height = ((frame[3] - frame[1]) / 2540) * 96;
    if (width > 0 && height > 0) return { width, height };
    const deviceWidth = bounds[2] - bounds[0] + 1;
    const deviceHeight = bounds[3] - bounds[1] + 1;
    return deviceWidth > 0 && deviceHeight > 0
      ? { width: deviceWidth, height: deviceHeight }
      : undefined;
  }
  const placeable = wmfSize(bytes);
  if (!placeable) return { width: 320, height: 240 };
  const [left, top, right, bottom] = placeable.bounds;
  return {
    width: (Math.abs(right - left) / placeable.inch) * 96,
    height: (Math.abs(bottom - top) / placeable.inch) * 96,
  };
}

/** The longest side of a metafile's picture, in pixels. */
const MAX_PREVIEW_SIDE = 1600;

/**
 * A PNG of an EMF or WMF metafile, drawn at twice its natural size for
 * sharpness when zoomed, or undefined where there is no canvas to draw on
 * (outside browsers) or the metafile draws nothing Macro can show.
 */
export async function metafilePreview(
  bytes: Uint8Array
): Promise<Uint8Array | undefined> {
  const kind = metafileKind(bytes);
  if (!kind || typeof OffscreenCanvas === 'undefined') return;
  const size = metafileSize(bytes, kind);
  if (!size) return;
  const scale = Math.min(
    2,
    MAX_PREVIEW_SIDE / Math.max(size.width, size.height)
  );
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const surface = new OffscreenCanvas(width, height);
  const context = surface.getContext('2d');
  if (!context) return;
  const images: MetafileImages = async (bitmap) => {
    try {
      if (bitmap instanceof Blob) return await createImageBitmap(bitmap);
      return await createImageBitmap(
        new ImageData(bitmap.rgba, bitmap.width, bitmap.height)
      );
    } catch {
      return;
    }
  };
  try {
    const drew =
      kind === 'emf'
        ? await playEmf(bytes, context, width, height, images)
        : await playWmf(bytes, context, width, height, images);
    if (!drew) return;
    const blob = await surface.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return;
  }
}
