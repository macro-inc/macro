import { describe, expect, it } from 'vitest';
import { figThumbnail } from './thumbnail';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

/** A ZIP of stored entries, as Figma writes `.fig` files. */
function zip(entries: [string, Uint8Array][]): ArrayBuffer {
  const parts: number[] = [];
  const central: number[] = [];
  const u16 = (out: number[], v: number) => out.push(v & 255, v >> 8);
  const u32 = (out: number[], v: number) =>
    out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24);
  for (const [name, data] of entries) {
    const offset = parts.length;
    const nameBytes = [...new TextEncoder().encode(name)];
    u32(parts, 0x04034b50);
    for (const v of [20, 0, 0, 0, 0]) u16(parts, v);
    u32(parts, 0);
    u32(parts, data.length);
    u32(parts, data.length);
    u16(parts, nameBytes.length);
    u16(parts, 0);
    parts.push(...nameBytes, ...data);
    u32(central, 0x02014b50);
    for (const v of [20, 20, 0, 0, 0, 0]) u16(central, v);
    u32(central, 0);
    u32(central, data.length);
    u32(central, data.length);
    u16(central, nameBytes.length);
    for (const v of [0, 0, 0, 0]) u16(central, v);
    u32(central, 0);
    u32(central, offset);
    central.push(...nameBytes);
  }
  const at = parts.length;
  parts.push(...central);
  u32(parts, 0x06054b50);
  u32(parts, 0);
  u16(parts, entries.length);
  u16(parts, entries.length);
  u32(parts, central.length);
  u32(parts, at);
  u16(parts, 0);
  return new Uint8Array(parts).buffer;
}

function legacy(chunks: Uint8Array[]): ArrayBuffer {
  const out = [...new TextEncoder().encode('fig-kiwi'), 48, 0, 0, 0];
  for (const c of chunks) {
    out.push(c.length & 255, (c.length >> 8) & 255, 0, 0, ...c);
  }
  return new Uint8Array(out).buffer;
}

describe('figThumbnail', () => {
  it('reads the stored thumbnail of a ZIP-layout file', () => {
    const file = zip([
      ['canvas.fig', new Uint8Array([1, 2, 3])],
      ['thumbnail.png', png],
      ['meta.json', new TextEncoder().encode('{}')],
    ]);
    expect(figThumbnail(file)).toEqual(png);
  });

  it('reads the third chunk of a bare document', () => {
    const file = legacy([new Uint8Array([1]), new Uint8Array([2, 3]), png]);
    expect(figThumbnail(file)).toEqual(png);
  });

  it('finds nothing in files without one', () => {
    expect(figThumbnail(zip([['canvas.fig', new Uint8Array(30)]]))).toBeNull();
    expect(
      figThumbnail(legacy([new Uint8Array([1]), new Uint8Array([2])]))
    ).toBeNull();
    expect(figThumbnail(new Uint8Array(40).buffer)).toBeNull();
  });
});
