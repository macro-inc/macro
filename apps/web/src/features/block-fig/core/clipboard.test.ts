import { describe, expect, it } from 'vitest';
import {
  decodeClipboard,
  encodeClipboard,
  fromBase64,
  pasteParent,
  toBase64,
} from './clipboard';

describe('base64', () => {
  it('round-trips bytes, large ones too', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
  });
});

describe('clipboard HTML', () => {
  const document = new TextEncoder().encode('fig-kiwi document');
  const images = new Uint8Array([80, 75, 3, 4]);
  const meta = {
    fileKey: 'doc-1',
    pasteID: 42,
    dataType: 'scene' as const,
    ids: ['1:2'],
  };

  it('writes Figma’s markers and reads them back', () => {
    const html = encodeClipboard({ meta, copied: { document, images } });
    expect(html).toContain('<!--(figmeta)');
    expect(html).toContain('<!--(figma)');
    expect(html).toContain('<!--(macroimages)');
    const read = decodeClipboard(html);
    expect(read?.meta).toEqual(meta);
    // (Compared as arrays: the encoder's bytes come from another realm.)
    expect([...(read?.copied.document ?? [])]).toEqual([...document]);
    expect([...(read?.copied.images ?? [])]).toEqual([...images]);
  });

  it('reads Figma’s own clipboard (no images)', () => {
    const html = `<meta charset='utf-8'><span data-metadata="<!--(figmeta)${btoa(
      '{"fileKey":"abc","pasteID":1,"dataType":"scene"}'
    )}(/figmeta)-->"></span><span data-buffer="<!--(figma)${toBase64(
      document
    )}(/figma)-->"></span>`;
    const read = decodeClipboard(html);
    expect(read?.meta?.fileKey).toBe('abc');
    expect(read?.copied.images).toHaveLength(0);
  });

  it('ignores other HTML', () => {
    expect(decodeClipboard('<p>hello</p>')).toBeUndefined();
  });
});

describe('pasteParent', () => {
  it('pastes into a selected frame', () => {
    expect(
      pasteParent([{ id: '1:2', parent: null, type: 'FRAME' }], '0:1', [])
    ).toBe('1:2');
  });

  it('pastes a copied frame beside itself', () => {
    expect(
      pasteParent([{ id: '1:2', parent: null, type: 'FRAME' }], '0:1', ['1:2'])
    ).toBe('0:1');
  });

  it('pastes next to a selected layer, or onto the page', () => {
    expect(
      pasteParent([{ id: '1:3', parent: '1:2', type: 'RECTANGLE' }], '0:1', [])
    ).toBe('1:2');
    expect(pasteParent([], '0:1', [])).toBe('0:1');
    expect(
      pasteParent(
        [{ id: 'I1:5;2:3', parent: '1:5', type: 'RECTANGLE' }],
        '0:1',
        []
      )
    ).toBe('0:1');
  });
});
