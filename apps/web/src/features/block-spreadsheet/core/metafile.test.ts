import { describe, expect, it } from 'vitest';
import {
  type MetafileCanvas,
  metafileKind,
  metafilePreview,
  metafileSize,
  playEmf,
  playWmf,
  readBitmap,
} from './metafile';

/** A canvas that records what is drawn on it, rounded for reading. */
function recordingCanvas() {
  const calls: string[] = [];
  const round = (value: unknown) =>
    typeof value === 'number' ? Math.round(value * 10) / 10 : value;
  const record =
    (name: string) =>
    (...values: unknown[]) =>
      calls.push(`${name}(${values.map(round).join(',')})`);
  const canvas = {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    bezierCurveTo: record('bezierCurveTo'),
    ellipse: record('ellipse'),
    closePath: record('closePath'),
    rect: record('rect'),
    clip: record('clip'),
    fillRect: record('fillRect'),
    drawImage: record('drawImage'),
    setLineDash: () => {},
    measureText: (text: string) => ({ width: text.length * 10 }),
    fill(rule?: CanvasFillRule) {
      calls.push(`fill(${String(canvas.fillStyle)},${rule})`);
    },
    stroke() {
      calls.push(`stroke(${String(canvas.strokeStyle)},${canvas.lineWidth})`);
    },
    fillText(text: string, x: number, y: number) {
      calls.push(
        `fillText(${text},${round(x)},${round(y)},${canvas.font},${canvas.textAlign},${String(canvas.fillStyle)})`
      );
    },
    fillStyle: '' as MetafileCanvas['fillStyle'],
    strokeStyle: '' as MetafileCanvas['strokeStyle'],
    lineWidth: 1,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  } satisfies MetafileCanvas;
  return { canvas, calls };
}

/** Little-endian bytes of 32-bit and 16-bit values. */
function bytes(...parts: ([number, 'i32' | 'u32' | 'i16'] | Uint8Array)[]) {
  const chunks = parts.map((part) => {
    if (part instanceof Uint8Array) return part;
    const [value, type] = part;
    const chunk = new Uint8Array(type === 'i16' ? 2 : 4);
    const view = new DataView(chunk.buffer);
    if (type === 'i16') view.setInt16(0, value, true);
    else if (type === 'i32') view.setInt32(0, value, true);
    else view.setUint32(0, value, true);
    return chunk;
  });
  const result = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
const u32 = (value: number): [number, 'u32'] => [value, 'u32'];
const i32 = (value: number): [number, 'i32'] => [value, 'i32'];
const i16 = (value: number): [number, 'i16'] => [value, 'i16'];

/** An EMF record of a type and its payload. */
const record = (type: number, payload: Uint8Array) =>
  bytes(u32(type), u32(8 + payload.length), payload);

/**
 * An EMF of records, drawn on a device of 4 pixels a millimeter: its 25 by
 * 12.5 millimeter frame is 100 by 50 device pixels.
 */
function emf(...records: Uint8Array[]) {
  const body = bytes(...records, record(14, bytes(u32(0), u32(0), u32(20))));
  return bytes(
    u32(1),
    u32(108),
    ...[0, 0, 99, 49].map(i32),
    ...[0, 0, 2500, 1250].map(i32),
    u32(0x464d4520),
    u32(0x10000),
    u32(108 + body.length),
    u32(records.length + 2),
    i16(4),
    i16(0),
    u32(0),
    u32(0),
    u32(0),
    i32(1920),
    i32(1080),
    i32(480),
    i32(270),
    u32(0),
    u32(0),
    u32(0),
    i32(508_000),
    i32(286_000),
    body
  );
}

const utf16 = (text: string) =>
  bytes(...[...text].map((character) => i16(character.charCodeAt(0))));

describe('EMF metafiles', () => {
  const logo = emf(
    // A red brush and a 2-pixel blue pen.
    record(39, bytes(u32(1), u32(0), u32(0x000000ff), u32(0))),
    record(37, bytes(u32(1))),
    record(38, bytes(u32(2), u32(0), i32(2), i32(0), u32(0x00ff0000))),
    record(37, bytes(u32(2))),
    record(43, bytes(...[5, 5, 45, 45].map(i32))),
    // The stock null brush: an outline only.
    record(37, bytes(u32(0x80000005))),
    record(42, bytes(...[55, 5, 95, 45].map(i32))),
    // A 14-pixel bold Arial, centered, in white on a transparent background.
    record(
      82,
      bytes(
        u32(3),
        i32(-14),
        i32(0),
        i32(0),
        i32(0),
        i32(700),
        new Uint8Array(8),
        utf16('Arial'.padEnd(32, '\0'))
      )
    ),
    record(37, bytes(u32(3))),
    record(24, bytes(u32(0x00ffffff))),
    record(18, bytes(u32(1))),
    record(22, bytes(u32(6))),
    record(
      84,
      bytes(
        ...[0, 0, 0, 0].map(i32),
        u32(1),
        u32(0),
        u32(0),
        i32(25),
        i32(18),
        u32(2),
        u32(76),
        u32(0),
        ...[0, 0, 0, 0].map(i32),
        u32(0),
        utf16('OK')
      )
    ),
    // A triangle of 16-bit points.
    record(
      86,
      bytes(
        ...[0, 0, 0, 0].map(i32),
        u32(3),
        ...[10, 48, 20, 40, 30, 48].map(i16)
      )
    )
  );

  it('knows metafiles and their size', () => {
    expect(metafileKind(logo)).toBe('emf');
    expect(metafileKind(new Uint8Array(64))).toBeUndefined();
    // Its natural size is its frame at 96 dots per inch.
    const size = metafileSize(logo, 'emf');
    expect(size?.width).toBeCloseTo(94.49, 1);
    expect(size?.height).toBeCloseTo(47.24, 1);
  });

  it('draws shapes, text and polygons at the canvas size', async () => {
    const { canvas, calls } = recordingCanvas();
    // Twice the natural size.
    expect(await playEmf(logo, canvas, 200, 100)).toBe(true);
    expect(calls).toEqual([
      'beginPath()',
      'moveTo(10,10)',
      'lineTo(90,10)',
      'lineTo(90,90)',
      'lineTo(10,90)',
      'closePath()',
      'fill(#ff0000,evenodd)',
      'stroke(#0000ff,4)',
      'beginPath()',
      'moveTo(190,50)',
      'ellipse(150,50,40,40,0,0,6.3)',
      'stroke(#0000ff,4)',
      'fillText(OK,50,36,700 28px "Arial", sans-serif,center,#ffffff)',
      'beginPath()',
      'moveTo(20,96)',
      'lineTo(40,80)',
      'lineTo(60,96)',
      'closePath()',
      'stroke(#0000ff,4)',
    ]);
  });

  it('reads device-independent bitmaps', () => {
    // A 2 by 2, 24-bit bitmap stored bottom row first: blue, white over
    // red, green.
    const info = bytes(
      u32(40),
      i32(2),
      i32(2),
      i16(1),
      i16(24),
      ...Array(6).fill(u32(0))
    );
    const pixels = new Uint8Array([
      0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0,
    ]);
    const bitmap = readBitmap(bytes(info, pixels), 0, 40);
    if (!bitmap || bitmap instanceof Blob) throw new Error('Expected pixels');
    expect(bitmap.width).toBe(2);
    expect([...bitmap.rgba]).toEqual([
      0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255,
    ]);
  });

  it('draws nothing it cannot read, and needs a canvas for a picture', async () => {
    const { canvas, calls } = recordingCanvas();
    // An EMF+ file's records are comments the GDI records stand in for.
    const comments = emf(record(70, bytes(u32(8), u32(0x2b464d45), u32(0))));
    expect(await playEmf(comments, canvas, 10, 10)).toBe(false);
    expect(calls).toEqual([]);
    expect(await metafilePreview(logo)).toBeUndefined();
  });
});

describe('WMF metafiles', () => {
  const placeable = (
    left: number,
    top: number,
    right: number,
    bottom: number
  ) =>
    bytes(
      u32(0x9ac6cdd7),
      i16(0),
      ...[left, top, right, bottom].map(i16),
      i16(96),
      u32(0),
      i16(0)
    );
  const wmfRecord = (fn: number, ...words: number[]) =>
    bytes(u32(3 + words.length), i16(fn), ...words.map(i16));
  const wmf = (...records: Uint8Array[]) =>
    bytes(
      placeable(0, 0, 100, 50),
      i16(1),
      i16(9),
      i16(0x300),
      u32(0),
      i16(4),
      u32(0),
      i16(0),
      ...records,
      wmfRecord(0)
    );

  it('maps the window to the picture and draws its objects', async () => {
    const picture = wmf(
      wmfRecord(0x020b, 0, 0),
      wmfRecord(0x020c, 50, 100),
      // A green brush and a black pen take the lowest free slots, 0 and 1.
      wmfRecord(0x02fc, 0, 0x8000, 0, 0),
      wmfRecord(0x02fa, 0, 1, 0, 0, 0),
      wmfRecord(0x012d, 0),
      wmfRecord(0x012d, 1),
      wmfRecord(0x041b, 40, 30, 10, 10)
    );
    expect(metafileKind(picture)).toBe('wmf');
    expect(metafileSize(picture, 'wmf')).toEqual({ width: 100, height: 50 });
    const { canvas, calls } = recordingCanvas();
    expect(await playWmf(picture, canvas, 200, 100)).toBe(true);
    expect(calls).toEqual([
      'beginPath()',
      'moveTo(20,20)',
      'lineTo(60,20)',
      'lineTo(60,80)',
      'lineTo(20,80)',
      'closePath()',
      'fill(#008000,evenodd)',
      'stroke(#000000,2)',
    ]);
  });
});
